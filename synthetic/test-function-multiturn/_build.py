"""Build all 20 multi-turn conversations.

Each row has a hand-crafted scenario tailored to the workflow domain. We aim for:
 - 10-20 user turns
 - 8-15 distinct functions from the library
 - At least one Encik/Puan/Sir/Madam vocative
 - No forbidden tokens
 - All required params in tool calls
 - tool_call_id continuity
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


# ========= Conversation builders =========
def build_0():
    # workflow: reconciliation_flow (telco_b2b/enterprise_sales)
    msgs = []
    # T1 - user: NOC/billing ops opens, wants to start a recon run for SG accts
    msgs.append(usr(
        "Selamat pagi. Saya Faridah dari Billing Ops, nak initiate satu reconciliation run untuk dua enterprise account "
        "yang ada disputed charges minggu lepas — account `acc-ent-44102` dan `acc-ent-55193`. Tolong cover CRM, BILLING dan "
        "INVENTORY dulu, scope orders + charges + services. Time window dari 1 Mei sampai 20 Mei. Priority high sebab "
        "audit Maybank nak follow up esok."
    ))
    msgs.append(asst(
        "Selamat pagi Puan Faridah. Saya akan mulakan reconciliation run keutamaan tinggi dengan skop yang Puan berikan. "
        "Mohon tunggu sebentar.",
        [tc("call-rc-001", "initiate_reconciliation_run", {
            "requested_by": {"user_id": "faridah.bin@telco.my", "role": "billing_ops", "department": "B2B Billing Ops"},
            "scope": {
                "accounts": ["acc-ent-44102", "acc-ent-55193"],
                "systems": ["CRM", "BILLING", "INVENTORY"],
                "time_window": {"from": "2026-05-01T00:00:00+08:00", "to": "2026-05-20T23:59:59+08:00"},
                "entities": ["orders", "services", "charges"]
            },
            "ruleset": {"ruleset_id": "rs-b2b-strict-v3"},
            "schedule": {"mode": "immediate", "priority": "high"},
            "metadata": {"ticket": "AUD-MAYBANK-2026-118"}
        })]
    ))
    msgs.append(tool_resp("call-rc-001", "initiate_reconciliation_run", {
        "reconciliation_run_id": "rcn-2026-05-21-aa7f12",
        "status": "pending",
        "created_at": "2026-05-21T09:02:11+08:00",
        "scope_summary": {"accounts": 2, "systems": 3, "entities": 3},
        "priority": "high"
    }))

    # T2 - kickoff extract in parallel with status query
    msgs.append(usr(
        "Okay, run dah dapat ID. Boleh start snapshot semua tiga sistem sekali gus, dan refresh status — saya nak nampak "
        "progress real-time."
    ))
    msgs.append(asst(
        "Baik Puan, saya akan ambil snapshot daripada CRM, BILLING dan INVENTORY secara serentak dan semak status run. Mohon tunggu sebentar.",
        [
            tc("call-rc-002", "fetch_source_system_snapshots", {
                "reconciliation_run_id": "rcn-2026-05-21-aa7f12",
                "systems": ["CRM", "BILLING", "INVENTORY"],
                "batching": {"batch_size": 500, "max_concurrent_batches": 6},
                "snapshot_options": {"consistency_mode": "transactional_if_supported", "include_deleted": False}
            }),
            tc("call-rc-003", "get_reconciliation_run_status", {
                "reconciliation_run_id": "rcn-2026-05-21-aa7f12",
                "include_metrics": True,
                "include_logs": False
            })
        ]
    ))
    msgs.append(tool_resp("call-rc-002", "fetch_source_system_snapshots", {
        "reconciliation_run_id": "rcn-2026-05-21-aa7f12",
        "snapshots": [
            {"system": "CRM", "snapshot_id": "snp-crm-7a91", "record_count": 4821},
            {"system": "BILLING", "snapshot_id": "snp-bill-7a92", "record_count": 5193},
            {"system": "INVENTORY", "snapshot_id": "snp-inv-7a93", "record_count": 2104}
        ],
        "started_at": "2026-05-21T09:02:22+08:00"
    }))
    msgs.append(tool_resp("call-rc-003", "get_reconciliation_run_status", {
        "reconciliation_run_id": "rcn-2026-05-21-aa7f12",
        "status": "running",
        "progress_pct": 24.0,
        "metrics": {"records_processed": 2901, "discrepancies_so_far": 12},
        "as_of": "2026-05-21T09:02:25+08:00"
    }))

    # T3 - simulate before committing detection (sanity check)
    msgs.append(usr(
        "Sebelum saya teruskan, boleh simulate dulu? Saya nak preview impact kalau kita transition run ni ke priority "
        "`urgent` — takut blast radius dia terlalu besar pada CRM."
    ))
    msgs.append(asst(
        "Sudah tentu Puan. Saya akan jalankan simulasi tanpa mengubah keadaan sebenar untuk menilai impak transition tersebut.",
        [tc("call-rc-004", "simulate_reconciliation_run_changes", {
            "target_id": "rcn-2026-05-21-aa7f12",
            "proposed_change": {
                "kind": "patch",
                "patch": [{"op": "replace", "path": "/priority", "value": "urgent"}]
            },
            "context": {"as_of": "2026-05-21T09:03:00+08:00", "scenario": "peak_load"},
            "impact": {"estimate_cost": True, "estimate_traffic_impact": True, "estimate_blast_radius": True},
            "policy_checks": ["pol-b2b-recon-safety"],
            "request_context": {"actor_type": "user", "role": "operator", "tenant_id": "tenant-my-b2b"}
        })]
    ))
    msgs.append(tool_resp("call-rc-004", "simulate_reconciliation_run_changes", {
        "simulation_id": "sim-rcn-aa7f12-001",
        "diff": [{"path": "/priority", "from": "high", "to": "urgent"}],
        "policy_verdicts": [{"policy_id": "pol-b2b-recon-safety", "decision": "pass", "notes": "within rate caps"}],
        "impact_estimate": {
            "cpu_cost_delta_pct": 18.5,
            "crm_api_calls_per_min": 240,
            "blast_radius": {"affected_accounts": 2, "affected_orders_est": 86, "max_observed_latency_ms": 412}
        },
        "explain": "Urgent will preempt 1 in-flight medium-priority run; latency budget still within SLO."
    }))

    # T4 - kick off detection
    msgs.append(usr(
        "Bunyi okay. Tak nak transition, tinggalkan high. Sekarang teruskan detect discrepancies, full mode, partition by account ya."
    ))
    msgs.append(asst(
        "Baik Puan, saya akan jalankan pengesanan penuh dengan partition mengikut akaun.",
        [tc("call-rc-005", "detect_discrepancies", {
            "reconciliation_run_id": "rcn-2026-05-21-aa7f12",
            "entity_filters": {"entity_types": ["order", "service", "charge"], "accounts": ["acc-ent-44102", "acc-ent-55193"]},
            "detection_mode": "full",
            "parallelism": {"worker_count": 8, "partition_strategy": "by_account"}
        })]
    ))
    msgs.append(tool_resp("call-rc-005", "detect_discrepancies", {
        "reconciliation_run_id": "rcn-2026-05-21-aa7f12",
        "discrepancy_summary": {
            "total": 19,
            "by_severity": {"critical": 2, "high": 4, "medium": 9, "low": 4},
            "by_entity": {"order": 6, "service": 5, "charge": 8}
        },
        "completed_at": "2026-05-21T09:05:08+08:00"
    }))

    # T5 - list discrepancies + see the metrics dashboard
    msgs.append(usr(
        "Aiyo, 19 discrepancies. Boleh list yang critical and high punya sekali tunjuk run metrics, saya nak banding dengan baseline."
    ))
    msgs.append(asst(
        "Baik Puan, saya akan tarik senarai discrepancy keutamaan tinggi serta paparan metrik untuk run ini, secara serentak.",
        [
            tc("call-rc-006", "list_discrepancies", {
                "reconciliation_run_id": "rcn-2026-05-21-aa7f12",
                "filters": {"severity": ["critical", "high"], "status": ["open"]},
                "page": 1, "page_size": 50,
                "sort_by": "severity", "sort_direction": "desc",
                "include_samples": True
            }),
            tc("call-rc-007", "get_reconciliation_run_metrics", {
                "metrics": ["discrepancy_count", "mttr_minutes", "error_rate"],
                "time_window": {"from": "2026-05-01T00:00:00+08:00", "to": "2026-05-21T09:05:00+08:00", "timezone": "Asia/Kuala_Lumpur", "granularity": "day"}
            })
        ]
    ))
    msgs.append(tool_resp("call-rc-006", "list_discrepancies", {
        "discrepancies": [
            {"discrepancy_id": "dsc-1001", "entity_type": "charge", "severity": "critical", "account_id": "acc-ent-44102",
             "systems_involved": ["BILLING", "INVENTORY"], "summary": "Charge RM 12,400 in BILLING but no corresponding service in INVENTORY"},
            {"discrepancy_id": "dsc-1002", "entity_type": "order", "severity": "critical", "account_id": "acc-ent-55193",
             "systems_involved": ["CRM", "ORDER_MGMT"], "summary": "Order #ord-441 closed in CRM but still active in ORDER_MGMT"},
            {"discrepancy_id": "dsc-1011", "entity_type": "charge", "severity": "high", "account_id": "acc-ent-44102",
             "systems_involved": ["BILLING"], "summary": "Duplicate MPLS port charge RM 3,200"},
            {"discrepancy_id": "dsc-1014", "entity_type": "service", "severity": "high", "account_id": "acc-ent-55193",
             "systems_involved": ["INVENTORY", "ASSURANCE"], "summary": "SIP trunk inventory shows 4 channels, assurance reports 8"}
        ],
        "pagination": {"total_count": 6, "page": 1, "page_size": 50, "has_next_page": False}
    }))
    msgs.append(tool_resp("call-rc-007", "get_reconciliation_run_metrics", {
        "reconciliation_run_id": "rcn-2026-05-21-aa7f12",
        "metrics": [
            {"name": "records_processed", "value": 12118},
            {"name": "discrepancy_rate", "value": 0.00157, "baseline": 0.0012, "delta_pct": 30.8},
            {"name": "avg_resolution_age_hours", "value": 14.2, "baseline": 11.5}
        ]
    }))

    # T6 - drill into critical charge dsc-1001
    msgs.append(usr(
        "RM 12,400 charge tu yang paling risau. Boleh tunjuk discrepancy details, include raw payloads sekali, saya nak buat audit trail."
    ))
    msgs.append(asst(
        "Sudah tentu Puan. Saya akan dapatkan butiran penuh termasuk muatan asal daripada BILLING dan INVENTORY untuk discrepancy `dsc-1001`.",
        [tc("call-rc-008", "get_discrepancy_details", {
            "discrepancy_id": "dsc-1001",
            "include_history": True,
            "include_raw_payloads": True,
            "mask_sensitive_fields": True
        })]
    ))
    msgs.append(tool_resp("call-rc-008", "get_discrepancy_details", {
        "discrepancy_id": "dsc-1001",
        "entity_type": "charge",
        "severity": "critical",
        "account_id": "acc-ent-44102",
        "mismatch_fields": [
            {"field": "amount", "BILLING": {"value": 12400.00, "currency": "MYR"}, "INVENTORY": None},
            {"field": "service_id", "BILLING": "svc-mpls-port-9981", "INVENTORY": None}
        ],
        "raw_payloads": {
            "BILLING": {"charge_id": "chg-bm-77001", "service_id": "svc-mpls-port-9981", "amount": 12400.0,
                        "posted_at": "2026-05-12T03:11:09+08:00"},
            "INVENTORY": {"lookup": "svc-mpls-port-9981", "result": "not_found"}
        },
        "history": [
            {"at": "2026-05-21T09:05:08+08:00", "actor": "system", "action": "discrepancy_detected"}
        ]
    }))

    # T7 - propose remediation
    msgs.append(usr(
        "Ok jelas. Tolong propose reconciliation actions for all the open ones, max severity critical, treat BILLING as source of truth, "
        "no auto-resolve for critical."
    ))
    msgs.append(asst(
        "Baik Puan, saya akan jana cadangan tindakan dengan BILLING sebagai sumber kebenaran dan menghadkan auto-resolve.",
        [tc("call-rc-009", "propose_reconciliation_actions", {
            "reconciliation_run_id": "rcn-2026-05-21-aa7f12",
            "filters": {"max_severity": "critical"},
            "action_preferences": {
                "system_hierarchy": ["BILLING", "CRM", "INVENTORY", "ORDER_MGMT"],
                "allowed_operations": ["create_in_missing_system", "update_in_mismatched_system", "open_case_in_crm"],
                "auto_resolve_threshold": {"max_amount_delta": 50, "max_date_delta_days": 1, "allowed_severities": ["low"]}
            }
        })]
    ))
    msgs.append(tool_resp("call-rc-009", "propose_reconciliation_actions", {
        "proposals": [
            {"discrepancy_id": "dsc-1001", "action_id": "act-001", "action_type": "create_in_missing_system",
             "target_system": "INVENTORY", "summary": "Create service record svc-mpls-port-9981 in INVENTORY",
             "estimated_impact": {"records_changed": 1}, "auto_executable": False},
            {"discrepancy_id": "dsc-1002", "action_id": "act-002", "action_type": "update_in_mismatched_system",
             "target_system": "ORDER_MGMT", "summary": "Mark order ord-441 as completed in ORDER_MGMT", "auto_executable": False},
            {"discrepancy_id": "dsc-1011", "action_id": "act-003", "action_type": "close_charge_in_billing",
             "target_system": "BILLING", "summary": "Void duplicate MPLS port charge RM 3,200", "auto_executable": False},
            {"discrepancy_id": "dsc-1014", "action_id": "act-004", "action_type": "update_in_mismatched_system",
             "target_system": "INVENTORY", "summary": "Update SIP trunk channels from 4 to 8", "auto_executable": True}
        ]
    }))

    # T8 - request approval + dry-run apply in parallel
    msgs.append(usr(
        "Sebab ada critical-impact, kita perlu approval Encik Lim (sales ops director). Hantar request, dan in parallel "
        "buat dry-run execution dulu supaya kita nampak apa akan jadi sebelum commit."
    ))
    msgs.append(asst(
        "Baik Puan, saya akan minta kelulusan daripada pengarah operasi jualan dan menjalankan dry-run secara serentak.",
        [
            tc("call-rc-010", "request_reconciliation_run_approval", {
                "target_id": "rcn-2026-05-21-aa7f12",
                "change_summary": "Commit reconciliation actions for 4 critical/high discrepancies on acc-ent-44102 and acc-ent-55193 ahead of Maybank audit AUD-MAYBANK-2026-118.",
                "approvers": [{"stage": 1, "kind": "user", "id": "lim.weiqiang@telco.my", "min_required": 1}],
                "evidence_refs": ["dsc-1001", "dsc-1002", "dsc-1011", "dsc-1014"]
            }),
            tc("call-rc-011", "apply_reconciliation_actions", {
                "reconciliation_run_id": "rcn-2026-05-21-aa7f12",
                "actions": [
                    {"discrepancy_id": "dsc-1001", "action_id": "act-001"},
                    {"discrepancy_id": "dsc-1002", "action_id": "act-002"},
                    {"discrepancy_id": "dsc-1011", "action_id": "act-003"},
                    {"discrepancy_id": "dsc-1014", "action_id": "act-004"}
                ],
                "execution_mode": "dry_run",
                "transaction_grouping": {"group_by": "per_discrepancy", "rollback_on_failure": True}
            })
        ]
    ))
    msgs.append(tool_resp("call-rc-010", "request_reconciliation_run_approval", {
        "approval_request_id": "appr-rcn-aa7f12-001",
        "status": "pending",
        "approvers_notified": ["lim.weiqiang@telco.my"],
        "expires_at": "2026-05-21T17:00:00+08:00"
    }))
    msgs.append(tool_resp("call-rc-011", "apply_reconciliation_actions", {
        "execution_id": "exec-rcn-aa7f12-dry-001",
        "execution_mode": "dry_run",
        "results": [
            {"discrepancy_id": "dsc-1001", "action_id": "act-001", "status": "would_succeed", "impact": "1 record created"},
            {"discrepancy_id": "dsc-1002", "action_id": "act-002", "status": "would_succeed"},
            {"discrepancy_id": "dsc-1011", "action_id": "act-003", "status": "would_succeed", "impact": "RM 3,200 reversal"},
            {"discrepancy_id": "dsc-1014", "action_id": "act-004", "status": "would_succeed"}
        ],
        "no_failures": True
    }))

    # T9 - approval comes back, also add a collab comment
    msgs.append(usr(
        "Encik Lim baru reply approve via Teams. Boleh record his decision dalam sistem, dan add satu comment supaya ada audit trail."
    ))
    msgs.append(asst(
        "Baik Puan, saya akan rekod keputusan kelulusan dan tambah komen audit pada run ini secara serentak.",
        [
            tc("call-rc-012", "decide_reconciliation_run_approval", {
                "approval_request_id": "appr-rcn-aa7f12-001",
                "decision": "approve",
                "decided_by": {"user_id": "lim.weiqiang@telco.my", "role": "director", "channel": "teams"},
                "comments": "Approved given Maybank audit deadline; BILLING is authoritative."
            }),
            tc("call-rc-013", "add_reconciliation_run_comment", {
                "target_id": "rcn-2026-05-21-aa7f12",
                "body": {"format": "markdown", "text": "Director approval received via Teams; proceeding to commit. ref: appr-rcn-aa7f12-001."}
            })
        ]
    ))
    msgs.append(tool_resp("call-rc-012", "decide_reconciliation_run_approval", {
        "approval_request_id": "appr-rcn-aa7f12-001",
        "status": "approved",
        "decided_at": "2026-05-21T09:13:42+08:00",
        "decided_by": "lim.weiqiang@telco.my"
    }))
    msgs.append(tool_resp("call-rc-013", "add_reconciliation_run_comment", {
        "comment_id": "cmt-rcn-aa7f12-001",
        "posted_at": "2026-05-21T09:13:44+08:00"
    }))

    # T10 - commit execution
    msgs.append(usr(
        "Bagus. Sekarang commit dia, group per discrepancy, rollback on failure. Send completion email ke billing-ops@telco.my."
    ))
    msgs.append(asst(
        "Baik Puan, saya akan menjalankan commit dengan transactional grouping per discrepancy serta hantar notifikasi e-mel.",
        [tc("call-rc-014", "apply_reconciliation_actions", {
            "reconciliation_run_id": "rcn-2026-05-21-aa7f12",
            "actions": [
                {"discrepancy_id": "dsc-1001", "action_id": "act-001"},
                {"discrepancy_id": "dsc-1002", "action_id": "act-002"},
                {"discrepancy_id": "dsc-1011", "action_id": "act-003"},
                {"discrepancy_id": "dsc-1014", "action_id": "act-004"}
            ],
            "execution_mode": "commit",
            "transaction_grouping": {"group_by": "per_discrepancy", "rollback_on_failure": True},
            "notification": {"email": "billing-ops@telco.my", "on_status": ["completed", "failed", "partial"]}
        })]
    ))
    msgs.append(tool_resp("call-rc-014", "apply_reconciliation_actions", {
        "execution_id": "exec-rcn-aa7f12-cmt-001",
        "execution_mode": "commit",
        "results": [
            {"discrepancy_id": "dsc-1001", "action_id": "act-001", "status": "success", "operation_id": "op-9001"},
            {"discrepancy_id": "dsc-1002", "action_id": "act-002", "status": "success", "operation_id": "op-9002"},
            {"discrepancy_id": "dsc-1011", "action_id": "act-003", "status": "failed", "operation_id": "op-9003",
             "error_code": "BILLING_VOID_LOCK", "message": "Charge currently in invoice lock; cannot void"},
            {"discrepancy_id": "dsc-1014", "action_id": "act-004", "status": "success", "operation_id": "op-9004"}
        ],
        "completed_at": "2026-05-21T09:15:21+08:00"
    }))

    # T11 - retry failed op for dsc-1011
    msgs.append(usr(
        "Alamak, op-9003 gagal sebab invoice lock. Boleh retry sahaja yang failed, tunggu 5 saat backoff, max 2 retries?"
    ))
    msgs.append(asst(
        "Baik Puan, saya akan cuba semula operasi yang gagal sahaja dengan backoff 5000 ms dan maksimum 2 kali percubaan.",
        [tc("call-rc-015", "retry_failed_operations", {
            "reconciliation_run_id": "rcn-2026-05-21-aa7f12",
            "previous_execution_id": "exec-rcn-aa7f12-cmt-001",
            "retry_strategy": {"max_retries": 2, "backoff_ms": 5000, "retry_on_error_codes": ["BILLING_VOID_LOCK"]}
        })]
    ))
    msgs.append(tool_resp("call-rc-015", "retry_failed_operations", {
        "retry_execution_id": "exec-rcn-aa7f12-rty-001",
        "operations_retried": [{"operation_id": "op-9003", "attempt": 2, "status": "success"}],
        "completed_at": "2026-05-21T09:15:39+08:00"
    }))

    # T12 - pull audit history + export evidence
    msgs.append(usr(
        "Okay semua dah resolve. Saya nak audit history run ni dengan before/after diff, dan eksport CSV pergi S3 untuk Maybank. "
        "Bucket: `audit-export-my`, prefix `maybank-2026-05`."
    ))
    msgs.append(asst(
        "Baik Puan, saya akan dapatkan sejarah audit dengan beza sebelum dan selepas, serta eksport CSV ke S3 secara serentak.",
        [
            tc("call-rc-016", "get_reconciliation_run_audit_history", {
                "target_id": "rcn-2026-05-21-aa7f12",
                "time_window": {"from": "2026-05-21T08:00:00+08:00", "to": "2026-05-21T10:00:00+08:00", "timezone": "Asia/Kuala_Lumpur"},
                "include": {"before_after_diff": True, "request_payload": False, "evidence_links": True},
                "pagination": {"page": 1, "page_size": 100}
            }),
            tc("call-rc-017", "export_reconciliation_runs", {
                "filters": {"status": ["running", "closed"], "time_window": {"from": "2026-05-21T00:00:00+08:00", "to": "2026-05-21T23:59:59+08:00", "timezone": "Asia/Kuala_Lumpur"}},
                "format": {"type": "csv", "compression": "gzip", "csv_options": {"delimiter": ",", "header": True}},
                "destination": {"kind": "s3", "s3": {"bucket": "audit-export-my", "key_prefix": "maybank-2026-05", "region": "ap-southeast-5"}},
                "request_context": {"actor_type": "user", "role": "auditor", "actor_id": "faridah.bin@telco.my"}
            })
        ]
    ))
    msgs.append(tool_resp("call-rc-016", "get_reconciliation_run_audit_history", {
        "target_id": "rcn-2026-05-21-aa7f12",
        "entries": [
            {"at": "2026-05-21T09:02:11+08:00", "actor": "faridah.bin@telco.my", "action": "create_run"},
            {"at": "2026-05-21T09:05:08+08:00", "actor": "system", "action": "detect_complete", "metadata": {"discrepancies": 19}},
            {"at": "2026-05-21T09:13:42+08:00", "actor": "lim.weiqiang@telco.my", "action": "approval_decided", "diff": {"approval_status": {"from": "pending", "to": "approved"}}},
            {"at": "2026-05-21T09:15:39+08:00", "actor": "system", "action": "operations_committed", "metadata": {"success": 4, "retried": 1}}
        ],
        "pagination": {"page": 1, "page_size": 100, "total_count": 4}
    }))
    msgs.append(tool_resp("call-rc-017", "export_reconciliation_runs", {
        "export_job_id": "exp-job-991002",
        "estimated_rows": 1,
        "signed_url": "s3://audit-export-my/maybank-2026-05/exp-job-991002.csv.gz",
        "status": "succeeded"
    }))

    # T13 - close the run formally + generate the summary report
    msgs.append(usr(
        "Last step — close run ni normal closure, leave any remaining open as `mark_in_review`, then generate PDF summary report "
        "untuk attach ke audit ticket Maybank."
    ))
    msgs.append(asst(
        "Baik Puan, saya akan menutup run dengan penutupan biasa dan menjana laporan ringkasan PDF.",
        [
            tc("call-rc-018", "close_reconciliation_run", {
                "reconciliation_run_id": "rcn-2026-05-21-aa7f12",
                "closure_mode": "normal",
                "disposition_policy": {
                    "default_disposition": "mark_in_review",
                    "by_severity": [{"severity": "low", "disposition": "mark_ignored"}]
                },
                "export_options": {"formats": ["pdf_summary"], "destination": {"email_recipients": ["faridah.bin@telco.my"]}},
                "comment": "Maybank audit AUD-MAYBANK-2026-118 closure"
            }),
            tc("call-rc-019", "generate_reconciliation_run_report", {
                "target_id": "rcn-2026-05-21-aa7f12",
                "report_kind": "executive",
                "time_window": {"from": "2026-05-01T00:00:00+08:00", "to": "2026-05-21T09:18:00+08:00", "timezone": "Asia/Kuala_Lumpur"},
                "format": "pdf",
                "delivery": {"kind": "email", "recipients": ["faridah.bin@telco.my"]}
            })
        ]
    ))
    msgs.append(tool_resp("call-rc-018", "close_reconciliation_run", {
        "reconciliation_run_id": "rcn-2026-05-21-aa7f12",
        "status": "closed",
        "closed_at": "2026-05-21T09:18:02+08:00",
        "final_counts": {"resolved": 17, "in_review": 2, "ignored": 0}
    }))
    msgs.append(tool_resp("call-rc-019", "generate_reconciliation_run_report", {
        "report_id": "rpt-rcn-aa7f12-exec-001",
        "format": "pdf",
        "download_url": "https://reports.telco.my/r/rpt-rcn-aa7f12-exec-001.pdf",
        "generated_at": "2026-05-21T09:18:09+08:00"
    }))

    msgs.append(asst(
        "Run telah ditutup secara rasmi, Puan Faridah. Berikut ringkasan akhir:\n\n"
        "- **Run ID:** `rcn-2026-05-21-aa7f12` (status: closed)\n"
        "- **Discrepancies:** 19 jumlah — 17 telah diselesaikan, 2 ditanda *in_review* untuk semakan susulan\n"
        "- **Operasi commit:** 4 berjaya (termasuk satu retry untuk `op-9003`)\n"
        "- **Eksport audit:** `s3://audit-export-my/maybank-2026-05/exp-job-991002.csv.gz`\n"
        "- **Laporan eksekutif PDF:** [rpt-rcn-aa7f12-exec-001.pdf](https://reports.telco.my/r/rpt-rcn-aa7f12-exec-001.pdf) — sudah dihantar ke e-mel Puan.\n\n"
        "Adakah ada apa-apa lagi yang saya boleh bantu sebelum panggilan ditutup?"
    ))

    # T14 - close call
    msgs.append(usr("Itu sahaja, terima kasih banyak. Selamat pagi."))
    msgs.append(asst(
        "Sama-sama, Puan Faridah. Terima kasih atas kesabaran dan semoga sesi audit Maybank esok berjalan lancar. Selamat pagi."
    ))

    return {
        "conversation_id": "myl-fnlib-0",
        "workflow_name": "reconciliation_flow",
        "domain": "telco_b2b/enterprise_sales",
        "messages": msgs,
        "metadata": meta(
            14,
            ["initiate_reconciliation_run","fetch_source_system_snapshots","get_reconciliation_run_status",
             "simulate_reconciliation_run_changes","detect_discrepancies","list_discrepancies","get_reconciliation_run_metrics",
             "get_discrepancy_details","propose_reconciliation_actions","request_reconciliation_run_approval",
             "apply_reconciliation_actions","decide_reconciliation_run_approval","add_reconciliation_run_comment",
             "retry_failed_operations","get_reconciliation_run_audit_history","export_reconciliation_runs",
             "close_reconciliation_run","generate_reconciliation_run_report"],
            "Puan Faridah opens in Bahasa Malaysia; mixes English technical terms; agent stays formal in Bahasa with English for technical names.",
            [
                {"turn": 1, "intent": "Initiate reconciliation run for two enterprise accounts", "expected_functions": ["initiate_reconciliation_run"], "complexity": "moderate"},
                {"turn": 2, "intent": "Snapshot all three systems + status check", "expected_functions": ["fetch_source_system_snapshots","get_reconciliation_run_status"], "complexity": "moderate"},
                {"turn": 3, "intent": "Simulate priority change before commit", "expected_functions": ["simulate_reconciliation_run_changes"], "complexity": "complex"},
                {"turn": 4, "intent": "Run detection partitioned by account", "expected_functions": ["detect_discrepancies"], "complexity": "moderate"},
                {"turn": 5, "intent": "List high/critical discrepancies + metrics", "expected_functions": ["list_discrepancies","get_reconciliation_run_metrics"], "complexity": "moderate"},
                {"turn": 6, "intent": "Drill into critical charge discrepancy", "expected_functions": ["get_discrepancy_details"], "complexity": "moderate"},
                {"turn": 7, "intent": "Propose remediation actions with BILLING as truth", "expected_functions": ["propose_reconciliation_actions"], "complexity": "moderate"},
                {"turn": 8, "intent": "Request approval + dry-run apply in parallel", "expected_functions": ["request_reconciliation_run_approval","apply_reconciliation_actions"], "complexity": "complex"},
                {"turn": 9, "intent": "Record approval decision + comment", "expected_functions": ["decide_reconciliation_run_approval","add_reconciliation_run_comment"], "complexity": "simple"},
                {"turn": 10, "intent": "Commit actions with rollback policy", "expected_functions": ["apply_reconciliation_actions"], "complexity": "complex"},
                {"turn": 11, "intent": "Retry failed billing void operation", "expected_functions": ["retry_failed_operations"], "complexity": "moderate"},
                {"turn": 12, "intent": "Pull audit history + export CSV evidence to S3", "expected_functions": ["get_reconciliation_run_audit_history","export_reconciliation_runs"], "complexity": "moderate"},
                {"turn": 13, "intent": "Close run + generate PDF executive report", "expected_functions": ["close_reconciliation_run","generate_reconciliation_run_report"], "complexity": "moderate"},
                {"turn": 14, "intent": "Wrap up the call", "expected_functions": [], "complexity": "simple"}
            ]
        )
    }


if __name__ == "__main__":
    builders = {0: build_0}
    for i, b in builders.items():
        target = OUT_DIR / f"{i}.json"
        if target.exists():
            print(f"skip {i}")
            continue
        conv = b()
        with open(target, "w") as f:
            json.dump(conv, f, ensure_ascii=False, indent=2)
        ok, errs, info = validate(str(target), str(LIB_DIR / f"{i}.json"))
        print(f"[{i}] {'OK' if ok else 'FAIL'} - turns={info['user_turns']} fns={len(info['fns_used'])}")
        if not ok:
            for e in errs:
                print("  -", e)
