"""Scaffold-based builders for libraries 1..19.

Each builder constructs a conversation using:
 - A domain-specific opening (3-5 turns of actual workflow functions)
 - A shared "scaffold" of governance/audit/policy functions that exist in every library
   (just with different name prefixes: get_X_audit_history, request_X_approval, etc.)

We pass per-row prefixes + domain-specific scenario steps to a single shared builder.
"""
from __future__ import annotations
import json
import os
import sys
from pathlib import Path

BASE = Path("/home/husein/ssd3/SyntheticGen/synthetic")
LIB_DIR = BASE / "test-function"
OUT_DIR = BASE / "test-function-multiturn"
sys.path.insert(0, str(OUT_DIR))
from _validate import validate  # noqa


def js(d):
    return json.dumps(d, ensure_ascii=False)


def tc(cid, name, args):
    return {"id": cid, "type": "function", "function": {"name": name, "arguments": js(args)}}


def tool_resp(cid, name, content):
    return {"role": "tool", "tool_call_id": cid, "name": name, "content": js(content)}


def asst(content, calls=None):
    m = {"role": "assistant", "content": content}
    if calls:
        m["tool_calls"] = calls
    return m


def usr(content):
    return {"role": "user", "content": content}


def meta(num_turns, fns_used, lang_note, turn_details):
    return {
        "num_turns": num_turns,
        "functions_used": list(fns_used),
        "language_style": lang_note,
        "generated_at": "2026-05-21T09:00:00+08:00",
        "turn_details": turn_details,
    }


def write_and_validate(idx, conv):
    target = OUT_DIR / f"{idx}.json"
    with open(target, "w") as f:
        json.dump(conv, f, ensure_ascii=False, indent=2)
    ok, errs, info = validate(str(target), str(LIB_DIR / f"{idx}.json"))
    return ok, errs, info


# ----------------- Scaffold builder -----------------
# Given a target_id (the row's primary entity id), build the post-opening scaffold turns.
# Each scaffold turn = 1 user message + 1 assistant tool-call(s) + tool response(s).
#
# Each library has consistent naming prefixes (e.g. "deployment", "edge_deployment", "retention_case", ...)
# Pass a `pfx` to map e.g. "audit_history" -> "get_{pfx}_audit_history".


def scaffold_turns(pfx: str, target_id: str, target_kind: str, gender_addr: str,
                   start_cid: int = 100, use_metrics_enum: list[str] = None,
                   report_kind: str = "operational",
                   probe_kind: str = "http", probe_target: str = "https://api.telco.my/health",
                   metric_time_window: dict | None = None,
                   approver_id: str = "ops.lead@telco.my",
                   approvers_for_decide: bool = True):
    """Returns (messages, fns_used_list, num_user_turns).

    Generates 7 scaffold user turns covering:
      1. simulate -> check policy violations
      2. metrics + audit history (parallel)
      3. snapshot + tag + assign owner (parallel)
      4. request approval + decide approval
      5. link to related ticket + comment + upload attachment (parallel)
      6. health probe + retry policy (parallel)
      7. compare versions + generate report (parallel)
    """
    if use_metrics_enum is None:
        use_metrics_enum = ["count", "p95", "error_rate"]
    if metric_time_window is None:
        metric_time_window = {"from": "2026-05-20T00:00:00+08:00", "to": "2026-05-21T09:30:00+08:00", "timezone": "Asia/Kuala_Lumpur", "granularity": "hour"}

    msgs = []
    fns = []
    cid = start_cid
    addr = gender_addr  # "Puan" or "Encik" or "Sir" etc.

    # Turn S1: simulate proposed change + evaluate policy
    msgs.append(usr(
        f"Sebelum kita commit apa-apa, boleh simulate dulu — saya nak nampak impact kalau kita transition {target_kind} ni ke `in_progress`. "
        "Sekali run policy evaluation supaya tahu ada compliance violations ke tidak."
    ))
    msgs.append(asst(
        f"Baik {addr}, saya akan jalankan simulasi serta evaluasi polisi serentak untuk mengelakkan kesan tidak diingini.",
        [
            tc(f"call-sc-{cid}", f"simulate_{pfx}_changes", {
                "target_id": target_id,
                "proposed_change": {"kind": "lifecycle_transition", "transition_to": "in_progress"},
                "context": {"as_of": "2026-05-21T09:30:00+08:00", "scenario": "normal"},
                "impact": {"estimate_cost": True, "estimate_traffic_impact": True, "estimate_blast_radius": True},
                "policy_checks": ["pol-default-safety"],
                "request_context": {"actor_type": "user", "role": "operator"}
            }),
            tc(f"call-sc-{cid+1}", f"evaluate_{pfx}_policy", {
                "target_id": target_id,
                "policy_ids": ["pol-compliance-myr-2026", "pol-rate-limit-default"]
            })
        ]
    ))
    msgs.append(tool_resp(f"call-sc-{cid}", f"simulate_{pfx}_changes", {
        "simulation_id": f"sim-{target_id}-001",
        "diff": [{"path": "/lifecycle_state", "from": "draft", "to": "in_progress"}],
        "policy_verdicts": [{"policy_id": "pol-default-safety", "decision": "pass"}],
        "impact_estimate": {"cpu_cost_delta_pct": 4.1, "blast_radius": {"affected_entities": 3}},
        "explain": "Lifecycle change is reversible; no downstream consumers blocked."
    }))
    msgs.append(tool_resp(f"call-sc-{cid+1}", f"evaluate_{pfx}_policy", {
        "target_id": target_id,
        "verdicts": [
            {"policy_id": "pol-compliance-myr-2026", "decision": "pass", "rules_evaluated": 12},
            {"policy_id": "pol-rate-limit-default", "decision": "warn", "violations": [{"rule": "max_concurrent_changes", "current": 4, "limit": 5}]}
        ]
    }))
    fns += [f"simulate_{pfx}_changes", f"evaluate_{pfx}_policy"]
    cid += 2

    # Turn S2: metrics + audit history (parallel)
    msgs.append(usr(
        f"Tunjuk metrics 24 jam terakhir, dan pull audit history — bos saya nak tahu siapa edit apa sebelum panggilan ni."
    ))
    msgs.append(asst(
        f"Baik {addr}, kedua-dua perkara saya tarik serentak.",
        [
            tc(f"call-sc-{cid}", f"get_{pfx}_metrics", {
                "metrics": use_metrics_enum,
                "time_window": metric_time_window
            }),
            tc(f"call-sc-{cid+1}", f"get_{pfx}_audit_history", {
                "target_id": target_id,
                "time_window": metric_time_window,
                "include": {"before_after_diff": True, "evidence_links": True},
                "pagination": {"page": 1, "page_size": 50}
            })
        ]
    ))
    msgs.append(tool_resp(f"call-sc-{cid}", f"get_{pfx}_metrics", {
        "metrics": [
            {"name": use_metrics_enum[0], "value": 142},
            {"name": use_metrics_enum[1], "value": 218.7, "unit": "ms"},
            {"name": use_metrics_enum[2], "value": 0.014}
        ],
        "time_window": metric_time_window
    }))
    msgs.append(tool_resp(f"call-sc-{cid+1}", f"get_{pfx}_audit_history", {
        "target_id": target_id,
        "entries": [
            {"at": "2026-05-21T08:42:11+08:00", "actor": "system", "action": "auto_assess"},
            {"at": "2026-05-21T09:01:22+08:00", "actor": "ops.lead@telco.my", "action": "field_updated", "diff": {"priority": {"from": "normal", "to": "high"}}},
            {"at": "2026-05-21T09:14:00+08:00", "actor": "compliance.bot", "action": "policy_evaluated"}
        ],
        "pagination": {"page": 1, "page_size": 50, "total_count": 3}
    }))
    fns += [f"get_{pfx}_metrics", f"get_{pfx}_audit_history"]
    cid += 2

    # Turn S3: snapshot + tag + assign owner (parallel)
    msgs.append(usr(
        f"Bagus. Sebelum buat apa-apa drastic, snapshot dulu, tag dia dengan tag audit, dan assign saya sebagai owner."
    ))
    msgs.append(asst(
        f"Baik {addr}, saya akan ambil snapshot, tag dan tetapkan pemilik serentak.",
        [
            tc(f"call-sc-{cid}", f"create_{pfx}_snapshot", {
                "target_id": target_id,
                "label": "pre-commit-2026-05-21",
                "reason": "Snapshot before applying lifecycle transition"
            }),
            tc(f"call-sc-{cid+1}", f"tag_{pfx}s", {
                "target_ids": [target_id],
                "tags": [{"key": "audit", "value": "maybank-2026", "scope": "tenant"}, {"key": "owner_team", "value": "ops_my"}]
            }),
            tc(f"call-sc-{cid+2}", f"assign_{pfx}_owner", {
                "target_id": target_id,
                "assignments": [{"role": "owner", "principal": {"kind": "user", "id": approver_id}, "effective_at": "2026-05-21T09:35:00+08:00"}]
            })
        ]
    ))
    msgs.append(tool_resp(f"call-sc-{cid}", f"create_{pfx}_snapshot", {
        "snapshot_id": f"snap-{target_id}-001",
        "created_at": "2026-05-21T09:35:11+08:00",
        "size_bytes": 18412
    }))
    msgs.append(tool_resp(f"call-sc-{cid+1}", f"tag_{pfx}s", {
        "applied": [{"target_id": target_id, "tags_count": 2}],
        "skipped": []
    }))
    msgs.append(tool_resp(f"call-sc-{cid+2}", f"assign_{pfx}_owner", {
        "target_id": target_id,
        "assignments_recorded": 1,
        "current_owner": approver_id
    }))
    fns += [f"create_{pfx}_snapshot", f"tag_{pfx}s", f"assign_{pfx}_owner"]
    cid += 3

    # Turn S4: request approval + decide approval (two-step but in same turn we request; decide in next turn)
    msgs.append(usr(
        f"Encik Ramesh (Director) sudah brief, tolong hantar formal approval request, dan rekod decision dia — dia dah reply approve via email tadi."
    ))
    msgs.append(asst(
        f"Baik {addr}, saya akan hantar permohonan kelulusan dan terus rekod keputusan kelulusan secara serentak.",
        [
            tc(f"call-sc-{cid}", f"request_{pfx}_approval", {
                "target_id": target_id,
                "change_summary": f"Apply lifecycle transition to {target_kind} {target_id} after passing simulation and policy checks.",
                "approvers": [{"stage": 1, "kind": "user", "id": "ramesh.k@telco.my", "min_required": 1}],
                "urgency": "high"
            }),
            tc(f"call-sc-{cid+1}", f"decide_{pfx}_approval", {
                "approval_request_id": f"appr-{target_id}-001",
                "decision": "approve",
                "decided_by": {"user_id": "ramesh.k@telco.my", "kind": "user"},
                "comments": "Approved per email; proceed with commit."
            } if approvers_for_decide else {
                "approval_request_id": f"appr-{target_id}-001",
                "decision": "approve"
            })
        ]
    ))
    msgs.append(tool_resp(f"call-sc-{cid}", f"request_{pfx}_approval", {
        "approval_request_id": f"appr-{target_id}-001",
        "status": "pending",
        "approvers_notified": ["ramesh.k@telco.my"]
    }))
    msgs.append(tool_resp(f"call-sc-{cid+1}", f"decide_{pfx}_approval", {
        "approval_request_id": f"appr-{target_id}-001",
        "status": "approved",
        "decided_at": "2026-05-21T09:40:01+08:00"
    }))
    fns += [f"request_{pfx}_approval", f"decide_{pfx}_approval"]
    cid += 2

    # Turn S5: link + comment + attachment
    msgs.append(usr(
        f"Link {target_kind} ni ke ticket induk JIRA `OPS-441`, add satu comment summarising decision, dan upload screenshot approval email dia (pakai presigned URL)."
    ))
    msgs.append(asst(
        f"Baik {addr}, saya akan link, komen dan muat naik lampiran serentak.",
        [
            tc(f"call-sc-{cid}", f"link_{pfx}_to_related", {
                "source_id": target_id,
                "target": {"kind": "ticket", "id": "OPS-441"},
                "relation": "related_to"
            }),
            tc(f"call-sc-{cid+1}", f"add_{pfx}_comment", {
                "target_id": target_id,
                "body": {"format": "markdown", "text": "Director **Ramesh K.** approved via email at 09:40 MYT. Snapshot `snap-" + target_id + "-001` recorded; tags applied; linked to OPS-441."}
            }),
            tc(f"call-sc-{cid+2}", f"upload_{pfx}_attachment", {
                "target_id": target_id,
                "source": {
                    "kind": "presigned_url",
                    "filename": "ramesh-approval-email.pdf",
                    "content_type": "application/pdf",
                    "size_bytes": 188422,
                    "url": "https://uploads.telco.my/p/ramesh-approval-email.pdf"
                }
            })
        ]
    ))
    msgs.append(tool_resp(f"call-sc-{cid}", f"link_{pfx}_to_related", {
        "link_id": f"lnk-{target_id}-OPS-441",
        "relation": "related_to"
    }))
    msgs.append(tool_resp(f"call-sc-{cid+1}", f"add_{pfx}_comment", {
        "comment_id": f"cmt-{target_id}-002",
        "posted_at": "2026-05-21T09:41:09+08:00"
    }))
    msgs.append(tool_resp(f"call-sc-{cid+2}", f"upload_{pfx}_attachment", {
        "attachment_id": f"att-{target_id}-001",
        "stored_uri": f"s3://attach-my/{target_id}/ramesh-approval-email.pdf",
        "size_bytes": 188422
    }))
    fns += [f"link_{pfx}_to_related", f"add_{pfx}_comment", f"upload_{pfx}_attachment"]
    cid += 3

    # Turn S6: health probe + configure retry policy
    msgs.append(usr(
        f"Sekarang check health dulu — tolong fire satu HTTP probe ke endpoint kami, dan set up retry policy: max 3 attempts, exponential backoff, retry on 5xx."
    ))
    msgs.append(asst(
        f"Baik {addr}, saya akan jalankan probe HTTP dan konfigurasikan polisi cuba semula serentak.",
        [
            tc(f"call-sc-{cid}", f"check_{pfx}_health", {
                "target_id": target_id,
                "probes": [{
                    "name": "primary-http",
                    "kind": probe_kind,
                    "target": probe_target,
                    "timeout_ms": 5000,
                    "expected": {"status_codes": [200, 204], "max_latency_ms": 800}
                }]
            }),
            tc(f"call-sc-{cid+1}", f"configure_{pfx}_retry_policy", {
                "retry": {
                    "max_attempts": 3,
                    "initial_delay_ms": 500,
                    "max_delay_ms": 5000,
                    "multiplier": 2.0,
                    "jitter": "equal",
                    "retry_on": ["http_5xx", "timeout"],
                    "non_retryable_errors": ["auth_failed", "schema_validation"]
                }
            })
        ]
    ))
    msgs.append(tool_resp(f"call-sc-{cid}", f"check_{pfx}_health", {
        "target_id": target_id,
        "probe_results": [{"name": "primary-http", "status": "healthy", "latency_ms": 142, "status_code": 200}],
        "overall_status": "healthy",
        "checked_at": "2026-05-21T09:42:18+08:00"
    }))
    msgs.append(tool_resp(f"call-sc-{cid+1}", f"configure_{pfx}_retry_policy", {
        "policy_id": f"rp-{target_id}-001",
        "applied_at": "2026-05-21T09:42:20+08:00",
        "current": {"max_attempts": 3, "multiplier": 2.0}
    }))
    fns += [f"check_{pfx}_health", f"configure_{pfx}_retry_policy"]
    cid += 2

    # Turn S7: compare versions + generate report
    msgs.append(usr(
        f"Last thing — boleh banding versi live sekarang dengan snapshot yang baru kita ambil, dan generate satu operational report PDF email ke saya."
    ))
    msgs.append(asst(
        f"Baik {addr}, saya akan banding versi serta menjana laporan operasi.",
        [
            tc(f"call-sc-{cid}", f"compare_{pfx}_versions", {
                "target_id": target_id,
                "base": {"kind": "snapshot", "id": f"snap-{target_id}-001"},
                "compare_to": {"kind": "live"}
            }),
            tc(f"call-sc-{cid+1}", f"generate_{pfx}_report", {
                "report_kind": report_kind,
                "time_window": metric_time_window,
                "format": "pdf",
                "delivery": {"kind": "email", "recipients": [approver_id]}
            })
        ]
    ))
    msgs.append(tool_resp(f"call-sc-{cid}", f"compare_{pfx}_versions", {
        "target_id": target_id,
        "diff_summary": {"changed_fields": 4, "added": 1, "removed": 0},
        "diff": [
            {"path": "/lifecycle_state", "from": "draft", "to": "in_progress"},
            {"path": "/owner", "from": None, "to": approver_id},
            {"path": "/tags", "added": ["audit:maybank-2026"]}
        ]
    }))
    msgs.append(tool_resp(f"call-sc-{cid+1}", f"generate_{pfx}_report", {
        "report_id": f"rpt-{target_id}-ops-001",
        "format": "pdf",
        "delivery_status": "queued",
        "estimated_ready_at": "2026-05-21T09:45:00+08:00"
    }))
    fns += [f"compare_{pfx}_versions", f"generate_{pfx}_report"]
    cid += 2

    return msgs, fns, 7  # 7 scaffold user turns


# ----------------- Per-row builders -----------------

def build_1():
    """api_gateway_content_publishing"""
    pfx = "deployment"
    msgs = []
    fns = []

    # T1 — user is API publisher / platform engineer
    msgs.append(usr(
        "Hi, saya Mei Ling from platform engineering team Cyberjaya. Saya nak publish satu API baru, `MyPay Wallet Lookup v1`. "
        "Workspace `ws-mypay-prod`, slug `mypay-wallet-lookup`, initial version `1.0.0`, OpenAPI 3.1 spec attached on `s3://api-specs/mypay-lookup-v1.yaml`. "
        "Boleh start dengan create_api_definition?"
    ))
    msgs.append(asst(
        "Selamat pagi Puan Mei Ling, saya akan mendaftarkan definisi API tersebut dengan versi awal `1.0.0`. Mohon tunggu sebentar.",
        [tc("call-d-001", "create_api_definition", {
            "workspace_id": "ws-mypay-prod",
            "name": "MyPay Wallet Lookup",
            "slug": "mypay-wallet-lookup",
            "description": "Wallet balance and KYC status lookup for MyPay integrations.",
            "initial_version": {"version_id": "1.0.0", "spec_uri": "s3://api-specs/mypay-lookup-v1.yaml", "spec_format": "openapi_3_1"},
            "tags": ["fintech", "wallet", "payments"]
        })]
    ))
    msgs.append(tool_resp("call-d-001", "create_api_definition", {
        "api_id": "api-mypay-wallet-lookup",
        "api_version_id": "ver-1-0-0",
        "workspace_id": "ws-mypay-prod",
        "created_at": "2026-05-21T09:05:11+08:00",
        "status": "draft"
    }))
    fns += ["create_api_definition"]

    # T2 — check route availability then create bundle
    msgs.append(usr(
        "Sebelum buat content bundle, check availability route `/v1/wallet/{walletId}` untuk methods GET dan HEAD. Lepas tu create bundle."
    ))
    msgs.append(asst(
        "Baik Puan, saya akan semak ketersediaan laluan dan kemudian membina content bundle.",
        [tc("call-d-002", "check_route_availability", {
            "workspace_id": "ws-mypay-prod",
            "path": "/v1/wallet/{walletId}",
            "methods": ["GET", "HEAD"]
        })]
    ))
    msgs.append(tool_resp("call-d-002", "check_route_availability", {
        "available": True,
        "conflicts": []
    }))
    msgs.append(asst(
        "Laluan tersedia tanpa konflik. Saya akan teruskan dengan content bundle.",
        [tc("call-d-003", "create_content_bundle", {
            "workspace_id": "ws-mypay-prod",
            "api_id": "api-mypay-wallet-lookup",
            "api_version_id": "ver-1-0-0",
            "routes": [{
                "path": "/v1/wallet/{walletId}",
                "methods": ["GET", "HEAD"],
                "upstream": {"url": "https://upstream.mypay.my", "timeout_ms": 3000},
                "rate_limit": {"rps": 200, "burst": 400}
            }],
            "policies": [{"kind": "auth_jwt", "issuer": "https://auth.telco.my"}]
        })]
    ))
    msgs.append(tool_resp("call-d-003", "create_content_bundle", {
        "content_bundle_id": "bnd-mypay-lookup-001",
        "workspace_id": "ws-mypay-prod",
        "created_at": "2026-05-21T09:08:02+08:00",
        "status": "draft"
    }))
    fns += ["check_route_availability", "create_content_bundle"]

    # T3 — validate bundle
    msgs.append(usr("Validate bundle dulu, strict mode, semua linting rules on."))
    msgs.append(asst(
        "Baik Puan, validasi ketat akan dijalankan.",
        [tc("call-d-004", "validate_content_bundle", {
            "workspace_id": "ws-mypay-prod",
            "content_bundle_id": "bnd-mypay-lookup-001",
            "strict": True,
            "rules": ["openapi_lint", "policy_attached", "rate_limit_required"]
        })]
    ))
    msgs.append(tool_resp("call-d-004", "validate_content_bundle", {
        "content_bundle_id": "bnd-mypay-lookup-001",
        "valid": True,
        "warnings": [{"rule": "openapi_lint", "message": "Missing 4xx examples on /v1/wallet/{walletId}", "severity": "warn"}]
    }))
    fns += ["validate_content_bundle"]

    # T4 — create change request + plan deployment
    msgs.append(usr(
        "Bunyi okay. Create change request untuk push ke `staging` dan `prod-my`, judul `MyPay Wallet Lookup v1 GA`, plan deployment sekali."
    ))
    msgs.append(asst(
        "Baik Puan, saya akan cipta change request dan menjalankan perancangan deployment serentak.",
        [tc("call-d-005", "create_change_request", {
            "workspace_id": "ws-mypay-prod",
            "content_bundle_id": "bnd-mypay-lookup-001",
            "target_environments": ["staging", "prod-my"],
            "requested_by": "mei.ling@telco.my",
            "title": "MyPay Wallet Lookup v1 GA",
            "description": "GA release with rate limit 200 RPS."
        })]
    ))
    msgs.append(tool_resp("call-d-005", "create_change_request", {
        "change_request_id": "chg-mypay-1001",
        "status": "open",
        "target_environments": ["staging", "prod-my"]
    }))
    msgs.append(asst(
        "Saya akan teruskan dengan perancangan deployment.",
        [tc("call-d-006", "plan_deployment", {
            "change_request_id": "chg-mypay-1001",
            "strategy": {"kind": "canary", "canary_percentage": 10, "promotion_steps": [25, 50, 100]},
            "maintenance_window": {"start": "2026-05-21T15:00:00+08:00", "end": "2026-05-21T17:00:00+08:00"}
        })]
    ))
    msgs.append(tool_resp("call-d-006", "plan_deployment", {
        "deployment_id": "dpl-mypay-1001",
        "plan": {
            "steps": [
                {"step": 1, "env": "staging", "phase": "full", "estimated_minutes": 6},
                {"step": 2, "env": "prod-my", "phase": "canary_10", "estimated_minutes": 8},
                {"step": 3, "env": "prod-my", "phase": "canary_50", "estimated_minutes": 10},
                {"step": 4, "env": "prod-my", "phase": "full", "estimated_minutes": 12}
            ]
        }
    }))
    fns += ["create_change_request", "plan_deployment"]

    # T5 — execute + monitor
    msgs.append(usr("Execute deployment ID `dpl-mypay-1001`. After 10 seconds, get status please."))
    msgs.append(asst(
        "Baik Puan, saya akan menjalankan deployment dan memantau statusnya.",
        [tc("call-d-007", "execute_deployment", {"change_request_id": "chg-mypay-1001"})]
    ))
    msgs.append(tool_resp("call-d-007", "execute_deployment", {
        "deployment_id": "dpl-mypay-1001",
        "status": "running",
        "started_at": "2026-05-21T09:14:02+08:00"
    }))
    msgs.append(asst(
        "Mohon tunggu sebentar. Saya akan semak kemajuan deployment.",
        [tc("call-d-008", "get_deployment_status", {"deployment_id": "dpl-mypay-1001", "include_step_logs": True})]
    ))
    msgs.append(tool_resp("call-d-008", "get_deployment_status", {
        "deployment_id": "dpl-mypay-1001",
        "status": "running",
        "progress_pct": 35.0,
        "current_step": {"step": 2, "phase": "canary_10", "env": "prod-my"}
    }))
    fns += ["execute_deployment", "get_deployment_status"]

    # Scaffold turns (7 user turns)
    target_id = "dpl-mypay-1001"
    s_msgs, s_fns, s_turns = scaffold_turns(
        pfx="deployment", target_id=target_id, target_kind="deployment",
        gender_addr="Puan",
        start_cid=200,
        use_metrics_enum=["deployment_success_rate", "p95_latency_ms", "error_rate"],
        report_kind="operational",
        probe_kind="http",
        probe_target="https://api.telco.my/v1/wallet/health",
        approver_id="mei.ling@telco.my"
    )
    msgs += s_msgs
    fns += s_fns

    # Final closing turn (user 13 = 5 + 7 = 12 plus closing)
    msgs.append(usr("Itu sahaja. Bila prod-my dah full rollout, sila ping team channel. Terima kasih banyak."))
    msgs.append(asst(
        "Sama-sama, Puan Mei Ling. Saya akan memastikan pasukan dimaklumkan apabila rollout penuh ke `prod-my` selesai. Selamat hari."
    ))

    fns_dedup = list(dict.fromkeys(fns))
    num_user_turns = 5 + s_turns + 1  # 5 domain + 7 scaffold + 1 closing = 13
    return {
        "conversation_id": "myl-fnlib-1",
        "workflow_name": "api_gateway_content_publishing",
        "domain": "taas_deep/api_gateway_management",
        "messages": msgs,
        "metadata": meta(num_user_turns, fns_dedup,
                         "Puan Mei Ling (platform engineer) code-switches Bahasa/English; agent stays formal Bahasa.",
                         [{"turn": i+1, "intent": "see flow", "expected_functions": [], "complexity": "moderate"} for i in range(num_user_turns)])
    }


if __name__ == "__main__":
    builders = {1: build_1}
    for i, b in builders.items():
        target = OUT_DIR / f"{i}.json"
        if target.exists():
            print(f"skip {i}")
            continue
        conv = b()
        ok, errs, info = write_and_validate(i, conv)
        print(f"[{i}] {'OK' if ok else 'FAIL'} - turns={info['user_turns']} fns={len(info['fns_used'])}")
        if not ok:
            for e in errs:
                print("  -", e)
