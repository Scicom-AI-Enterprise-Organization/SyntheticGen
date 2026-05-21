#!/usr/bin/env python3
"""Build conversations 85..89 for multiturn-extra.

  85: mandarin   - sd_wan_incident_lifecycle
  86: malay      - udm_quality_assurance_flow
  87: english    - api_gateway_performance_management
  88: tamil      - customer_retention_lifecycle
  89: malay      - sd_wan_entitlement_flow
"""
import sys, os, json
sys.path.insert(0, os.path.dirname(__file__))
from _gen import js, assistant, assistant_tool, user, tool, save

LIB_DIR = '/home/husein/ssd3/SyntheticGen/synthetic/test-function'


def build_metadata(idx, language_profile, num_turns, api_errors, ooc, edges, fns_used, narrative):
    lib = json.load(open(f'{LIB_DIR}/{idx}.json'))
    return {
        "conversation_id": f"myl-fnlib-extra-{idx}",
        "workflow_name": lib['workflow_name'],
        "domain": lib['domain'],
        "metadata": {
            "num_turns": num_turns,
            "language_profile": language_profile,
            "api_errors_simulated": api_errors,
            "out_of_context_turns": ooc,
            "agent_edges_demonstrated": edges,
            "functions_used": fns_used,
            "language_style": narrative,
            "generated_at": "2026-05-21T16:00:00+08:00",
            "turn_details": []
        }
    }


# ---------------------------------------------------------------------------
# 85 - sd_wan_incident_lifecycle (Mandarin-leading)
# ---------------------------------------------------------------------------
def build_85():
    I = 85
    msgs = []

    msgs.append(user(
        "Ni hao, selamat petang. Saya Encik Lim Wei Jian, SD-WAN ops engineer Maxis B2B, Cyberjaya. "
        "Customer Public Bank baru report — branch Bukit Bintang link drop intermittent sejak 14:00 petang. "
        "Customer ID `cust-pbb-3344`, site ID `site-pbb-bb-009`, severity major. Boleh detect incident dulu?"
    ))
    msgs.append(assistant_tool(
        "Ni hao, selamat petang Encik Lim. Baik, saya detect incident sekarang.",
        [("call-85-001", "detect_sd_wan_incident", {
            "customer_id": "cust-pbb-3344",
            "site_id": "site-pbb-bb-009",
            "detection_inputs": {
                "symptom_codes": ["link_flapping", "packet_loss_intermittent"],
                "observed_severity": "major",
                "observed_since": "2026-05-21T14:00:00+08:00",
                "reporter": {"reporter_type": "customer", "ticket_ref": "PBB-TT-2026-05-21-0418"}
            }
        })]
    ))
    msgs.append(tool("call-85-001", "detect_sd_wan_incident", {
        "incident_id": "inc-pbb-bb-aa01",
        "status": "detected",
        "created_at": "2026-05-21T14:25:10+08:00",
        "severity": "major"
    }))
    msgs.append(assistant(
        "Incident dicipta, Encik Lim:\n\n"
        "- **incident_id:** `inc-pbb-bb-aa01` (severity major, status detected)\n\n"
        "Adakah Encik mahu saya classify incident dan jalankan diagnostics secara selari?"
    ))
    msgs.append(user(
        "Hao de, jalankan selari. Diagnostic scope link health, BGP session, dan tunnel state."
    ))
    msgs.append(assistant_tool(
        "Baik, parallel calls.",
        [
            ("call-85-002", "classify_sd_wan_incident", {
                "incident_id": "inc-pbb-bb-aa01",
                "classification_inputs": {
                    "symptom_codes": ["link_flapping", "packet_loss_intermittent"],
                    "business_impact": "branch_offline_intermittent"
                }
            }),
            ("call-85-003", "run_sd_wan_diagnostics", {
                "incident_id": "inc-pbb-bb-aa01",
                "diagnostic_scope": ["link_health", "bgp_session", "tunnel_state"],
                "depth": "standard"
            })
        ]
    ))
    msgs.append(tool("call-85-002", "classify_sd_wan_incident", {
        "classification": {
            "primary_category": "underlay_instability",
            "secondary_category": "ms_path_flap",
            "confidence": 0.78
        },
        "priority": "P2"
    }))
    msgs.append(tool("call-85-003", "run_sd_wan_diagnostics", {
        "error": {
            "http_status": 429,
            "code": "rate_limit_exceeded",
            "message": "Diagnostic API rate limit exceeded for tenant tnt-maxis-b2b. Limit: 10 concurrent diagnostics per tenant; currently 10 active. Retry after the indicated window.",
            "retry_after_seconds": 30,
            "trace_id": "trc-429-2026-05-21-14-26-aa"
        }
    }))
    msgs.append(assistant(
        "Classification siap (P2, underlay_instability + path_flap, confidence 78%) — tetapi diagnostic kena **HTTP 429 Rate Limit**:\n\n"
        "- 10 diagnostic concurrent dah penuh untuk tenant\n"
        "- Sistem cadang tunggu **30 saat**\n"
        "- **Trace ID:** `trc-429-2026-05-21-14-26-aa`\n\n"
        "Saya akan retry diagnostic selepas cooldown. Sambil tu, adakah Encik mahu saya senaraikan incident terkini Public Bank "
        "untuk pattern awareness?"
    ))
    msgs.append(user(
        "Dui, list dulu. Saya nak tahu kalau ada history link flap di site ni dalam minggu lepas."
    ))
    msgs.append(assistant_tool(
        "Baik.",
        [("call-85-004", "list_sd_wan_incidents", {
            "filters": {
                "customer_id": "cust-pbb-3344",
                "site_id": "site-pbb-bb-009",
                "time_range": {"from": "2026-05-14T00:00:00+08:00", "to": "2026-05-21T14:30:00+08:00"}
            },
            "page_size": 10,
            "sort_by": "created_at",
            "sort_direction": "desc"
        })]
    ))
    msgs.append(tool("call-85-004", "list_sd_wan_incidents", {
        "data": [
            {"incident_id": "inc-pbb-bb-aa01", "status": "detected", "severity": "major", "created_at": "2026-05-21T14:25:10+08:00", "primary_category": "underlay_instability"},
            {"incident_id": "inc-pbb-bb-9988", "status": "resolved", "severity": "minor", "created_at": "2026-05-17T09:14:30+08:00", "primary_category": "ms_path_flap", "resolved_at": "2026-05-17T10:30:00+08:00"},
            {"incident_id": "inc-pbb-bb-9912", "status": "resolved", "severity": "major", "created_at": "2026-05-15T11:40:00+08:00", "primary_category": "underlay_instability", "resolved_at": "2026-05-15T13:50:00+08:00"}
        ],
        "pagination": {"page_size": 10, "has_next_page": False, "total_count": 3}
    }))
    msgs.append(assistant(
        "Pattern jelas, Encik Lim — site ini ada **3 incident dalam 7 hari** semua underlay/path_flap:\n\n"
        "1. **Hari ini 14:25** — current (yang kita handle)\n"
        "2. **17 Mei 09:14** — minor path_flap, resolved\n"
        "3. **15 Mei 11:40** — major underlay, resolved\n\n"
        "Ini menunjukkan masalah **berulang**. Mungkin perlu investigation deeper (e.g., escalate ke transport team). "
        "Saya retry diagnostic sekarang setelah cooldown 429."
    ))
    msgs.append(user(
        "Ai yaa, again the same site. OK retry."
    ))
    msgs.append(assistant_tool(
        "Retry.",
        [("call-85-005", "run_sd_wan_diagnostics", {
            "incident_id": "inc-pbb-bb-aa01",
            "diagnostic_scope": ["link_health", "bgp_session", "tunnel_state"],
            "depth": "standard"
        })]
    ))
    msgs.append(tool("call-85-005", "run_sd_wan_diagnostics", {
        "http_status": 202,
        "status": "accepted",
        "diagnostic_job_id": "job-diag-aa01-bb02",
        "estimated_completion_seconds": 45,
        "polling_url": "/diagnostics/job-diag-aa01-bb02/status",
        "webhook_supported": True
    }))
    msgs.append(assistant(
        "Diagnostic accepted (**HTTP 202**), Encik:\n\n"
        "- **diagnostic_job_id:** `job-diag-aa01-bb02`\n"
        "- ETA: 45 saat\n\n"
        "Saya tunggu hasil, kemudian fetch."
    ))
    msgs.append(user(
        "OK. Sambil tu boleh subscribe events untuk incident ni?"
    ))
    msgs.append(assistant_tool(
        "Baik.",
        [("call-85-006", "sd_wan_incident_subscribe_to_events", {
            "scope": {"incident_id": "inc-pbb-bb-aa01"},
            "subscribers": [
                {"channel": "email", "address": "lim.wj@maxis.com.my", "locale": "en-MY"},
                {"channel": "email", "address": "pbb-noc@publicbank.com.my", "locale": "en-MY"}
            ],
            "events": ["incident.status_changed", "diagnostic.completed", "remediation.executed", "incident.resolved"]
        })]
    ))
    msgs.append(tool("call-85-006", "sd_wan_incident_subscribe_to_events", {
        "subscription_id": "subs-sdwan-pbb-cc03",
        "subscribers_confirmed": 2,
        "status": "active"
    }))
    msgs.append(assistant(
        "Subscription aktif (`subs-sdwan-pbb-cc03`). 2 subscribers dah disahkan.\n\n"
        "Mari saya fetch hasil diagnostic."
    ))
    msgs.append(user(
        "Hao de."
    ))
    msgs.append(assistant_tool(
        "Fetch diagnostic result.",
        [("call-85-007", "get_sd_wan_diagnostics_result", {
            "diagnostic_job_id": "job-diag-aa01-bb02"
        })]
    ))
    msgs.append(tool("call-85-007", "get_sd_wan_diagnostics_result", {
        "diagnostic_job_id": "job-diag-aa01-bb02",
        "status": "completed",
        "findings": [
            {"check": "link_health", "status": "fail", "detail": "MPLS underlay path A showing 4-7% packet loss; path B clean."},
            {"check": "bgp_session", "status": "pass"},
            {"check": "tunnel_state", "status": "warning", "detail": "tunnel-01 flapping every ~3 min, tunnel-02 stable."}
        ],
        "root_cause_hypothesis": "underlay_carrier_circuit_issue_path_a",
        "_warning": "quota_remaining_today: 6 of 50 diagnostic runs."
    }))
    msgs.append(assistant(
        "Diagnostic siap, Encik Lim:\n\n"
        "- **link_health:** FAIL — MPLS underlay path A 4-7% packet loss; path B clean\n"
        "- **bgp_session:** PASS\n"
        "- **tunnel_state:** WARNING — tunnel-01 flapping ~3 min interval\n"
        "- **Root cause hypothesis:** carrier circuit issue di path A\n"
        "- Amaran kuota proaktif: hanya **6 daripada 50** diagnostic runs tinggal\n\n"
        "Saya cadang propose remediation: pin traffic ke path B sementara, kemudian eskalasi carrier untuk path A. Setuju?"
    ))
    msgs.append(user(
        "Dui, propose remediation. Pin to path B."
    ))
    msgs.append(assistant_tool(
        "Baik.",
        [("call-85-008", "propose_sd_wan_remediation", {
            "incident_id": "inc-pbb-bb-aa01",
            "remediation_inputs": {
                "based_on_diagnostic_job_id": "job-diag-aa01-bb02",
                "preferred_action": "traffic_steering_pin_to_path_b",
                "scope": {"site_id": "site-pbb-bb-009"}
            },
            "include_risk_estimate": True
        })]
    ))
    msgs.append(tool("call-85-008", "propose_sd_wan_remediation", {
        "remediation_proposal_id": "rem-pbb-bb-dd04",
        "actions": [
            {"action_type": "traffic_steering", "config": {"site_id": "site-pbb-bb-009", "pin_to_path": "path_b"}},
            {"action_type": "carrier_escalation_ticket", "config": {"carrier": "TM-Wholesale", "circuit_id": "CIR-MPLS-PATH-A-99771"}}
        ],
        "risk_band": "low",
        "estimated_impact": "5-minute traffic re-converge; no expected downtime"
    }))
    msgs.append(assistant(
        "Remediation proposal:\n\n"
        "- **remediation_proposal_id:** `rem-pbb-bb-dd04`\n"
        "- 2 actions: traffic steering + carrier escalation ticket (TM Wholesale)\n"
        "- Risk band: low; anggar 5 minit re-converge\n\n"
        "Sebelum execute, saya cadang **create change request** dulu kerana ia involve traffic steering production. Encik setuju?"
    ))
    msgs.append(user(
        "Setuju. Buat change request, kemudian execute."
    ))
    msgs.append(assistant(
        "Sebelum saya cipta change request, izinkan saya jelaskan blast radius:\n\n"
        "1. Traffic site Public Bank Bukit Bintang akan **dipin ke path B sahaja** (path A diabaikan untuk tempoh remediation).\n"
        "2. Re-converge anggar **5 minit** — kemungkinan packet loss minor semasa transisi.\n"
        "3. Carrier ticket akan dibuka secara automatik dengan TM Wholesale.\n"
        "4. Tindakan boleh dirollback dengan `rollback_sd_wan_change`.\n\n"
        "Setuju untuk teruskan?"
    ))
    msgs.append(user(
        "Setuju, teruskan."
    ))
    msgs.append(assistant_tool(
        "Cipta change request + execute remediation.",
        [
            ("call-85-009", "create_sd_wan_change_request", {
                "incident_id": "inc-pbb-bb-aa01",
                "based_on_proposal_id": "rem-pbb-bb-dd04",
                "change_type": "emergency",
                "approval_required": False,
                "scheduled_window": {"start": "2026-05-21T14:35:00+08:00", "end": "2026-05-21T14:45:00+08:00"}
            }),
            ("call-85-010", "execute_sd_wan_remediation", {
                "remediation_proposal_id": "rem-pbb-bb-dd04",
                "execution_mode": "immediate",
                "requested_by": {"user_id": "usr-lim-sdwan-077"}
            })
        ]
    ))
    msgs.append(tool("call-85-009", "create_sd_wan_change_request", {
        "change_request_id": "chg-pbb-bb-ee05",
        "status": "approved_emergency",
        "scheduled_window": {"start": "2026-05-21T14:35:00+08:00", "end": "2026-05-21T14:45:00+08:00"}
    }))
    msgs.append(tool("call-85-010", "execute_sd_wan_remediation", {
        "execution_id": "exec-pbb-bb-ff06",
        "status": "in_progress",
        "http_status": 202,
        "estimated_completion_seconds": 300,
        "actions_started": 2,
        "actions_pending": 0
    }))
    msgs.append(assistant(
        "Kedua-dua siap diinitiate, Encik:\n\n"
        "- **change_request_id:** `chg-pbb-bb-ee05` (approved sebagai emergency)\n"
        "- **execution_id:** `exec-pbb-bb-ff06` (HTTP 202, in progress, ETA 5 minit)\n\n"
        "Saya akan tunggu sebelum verify."
    ))
    msgs.append(user(
        "Ai yaa, satu lagi tanya luar topik — saya nak tahu pasal training SD-WAN advanced certification, ada tak sponsorship office? "
        "Boss kata try minta HR."
    ))
    msgs.append(assistant(
        "Maaf Encik Lim, sponsorship dan latihan profesional adalah di luar skop khidmat SD-WAN incident saya. Untuk hal tersebut:\n\n"
        "- Sila rujuk **HRMy** (modul Learning & Development) atau e-mel learning@maxis.com.my.\n\n"
        "Kembali kepada operasi — selepas remediation siap, saya cadang notify stakeholders Public Bank. Setuju?"
    ))
    msgs.append(user(
        "Setuju. Notify Encik Teh dari PBB NOC, contact teh.k@publicbank.com.my."
    ))
    msgs.append(assistant_tool(
        "Notify.",
        [("call-85-011", "notify_sd_wan_incident_stakeholders", {
            "incident_id": "inc-pbb-bb-aa01",
            "stakeholders": [
                {"name": "Teh", "email": "teh.k@publicbank.com.my", "role": "customer_noc", "locale": "en-MY"}
            ],
            "notification_type": "remediation_in_progress",
            "include_summary": True
        })]
    ))
    msgs.append(tool("call-85-011", "notify_sd_wan_incident_stakeholders", {
        "notification_id": "notif-pbb-gg07",
        "stakeholders_notified": 1,
        "delivered_at": "2026-05-21T14:36:18+08:00"
    }))
    msgs.append(assistant(
        "Notification dihantar (`notif-pbb-gg07`) kepada Encik Teh.\n\n"
        "Adakah ada apa-apa lagi sementara menunggu remediation siap?"
    ))
    msgs.append(user(
        "Sat, satu lagi soalan luar topik — kalau saya nak balik awal jam 5 petang ni, claim flexi-hours macam mana? Adik saya sakit."
    ))
    msgs.append(assistant(
        "Maaf Encik Lim, urusan flexi-hours dan leave adalah di luar skop khidmat saya. Untuk hal tersebut:\n\n"
        "- Sila guna **WorkdayMy** (modul Time Off → Flexi Hours) atau hubungi line manager Encik.\n\n"
        "Saya doakan adik Encik cepat sembuh. Kembali kepada operasi — saya cadang pull KPI dan timeline incident untuk laporan kemudian."
    ))
    msgs.append(user(
        "Hao de, xie xie. Pull timeline + KPI."
    ))
    msgs.append(assistant_tool(
        "Parallel.",
        [
            ("call-85-012", "get_sd_wan_incident_timeline", {
                "incident_id": "inc-pbb-bb-aa01",
                "limit": 20
            }),
            ("call-85-013", "sd_wan_incident_get_kpi_metrics", {
                "scope": {"customer_id": "cust-pbb-3344"},
                "metric_set": "incident_handling",
                "time_range": {"from": "2026-05-14T00:00:00+08:00", "to": "2026-05-21T15:00:00+08:00"}
            })
        ]
    ))
    msgs.append(tool("call-85-012", "get_sd_wan_incident_timeline", {
        "timeline": [
            {"timestamp": "2026-05-21T14:25:10+08:00", "event": "detected", "actor": "system:detector"},
            {"timestamp": "2026-05-21T14:26:00+08:00", "event": "classified", "category": "underlay_instability", "priority": "P2"},
            {"timestamp": "2026-05-21T14:26:20+08:00", "event": "diagnostic_attempted", "result": "rate_limited_429"},
            {"timestamp": "2026-05-21T14:27:00+08:00", "event": "diagnostic_retried", "diagnostic_job_id": "job-diag-aa01-bb02"},
            {"timestamp": "2026-05-21T14:28:00+08:00", "event": "diagnostic_completed", "root_cause": "underlay_carrier_circuit_issue_path_a"},
            {"timestamp": "2026-05-21T14:34:00+08:00", "event": "remediation_proposed", "proposal_id": "rem-pbb-bb-dd04"},
            {"timestamp": "2026-05-21T14:35:00+08:00", "event": "change_approved_emergency", "change_id": "chg-pbb-bb-ee05"},
            {"timestamp": "2026-05-21T14:35:30+08:00", "event": "remediation_execution_started", "execution_id": "exec-pbb-bb-ff06"}
        ]
    }))
    msgs.append(tool("call-85-013", "sd_wan_incident_get_kpi_metrics", {
        "kpis": {
            "incidents_7d": 3,
            "incidents_resolved_7d": 2,
            "mttr_minutes_7d": 105,
            "repeat_incident_pct": 100,
            "carrier_escalation_count_7d": 0
        },
        "note": "100% repeat pattern at site-pbb-bb-009; recommend long-term carrier review."
    }))
    msgs.append(assistant(
        "Timeline + KPI siap, Encik Lim:\n\n"
        "**Timeline (8 events)** — dari detect ke remediation_execution_started.\n\n"
        "**KPI 7 hari:**\n"
        "- Incidents: 3 | Resolved: 2 | MTTR: 105 minit\n"
        "- ⚠️ **Repeat-incident: 100%** — site ini berulang. Cadangan: long-term carrier review.\n\n"
        "Adakah ada apa-apa lagi?"
    ))
    msgs.append(user(
        "Cukup. Xie xie ya Encik, terima kasih banyak atas handling 429, 202 async, dan repeat pattern detection. "
        "Saya akan tunggu webhook resolution. Wan an."
    ))
    msgs.append(assistant(
        "Sama-sama Encik Lim Wei Jian. Terima kasih atas kesabaran dalam menangani siri ralat (429 rate limit diagnostic, 202 async, "
        "amaran kuota proaktif, repeat-pattern flag). Selamat petang dan harap remediation siap dengan lancar."
    ))

    meta = build_metadata(I, "mandarin", 13,
        [
            {"http_status": 429, "service": "diagnostic-api", "kind": "rate_limit_exceeded", "recovered": True, "via": "wait-cooldown-and-retry"},
            {"http_status": 202, "service": "diagnostic-api", "kind": "async_accepted", "recovered": True, "via": "fetch-result-after-eta"},
            {"http_status": 202, "service": "remediation-api", "kind": "async_accepted", "recovered": True, "via": "parallel-with-change-request"},
            {"http_status": 200, "service": "diagnostic-api", "kind": "quota_warning", "recovered": True, "via": "agent-flags-low-quota"}
        ],
        [
            {"turn": 9, "topic": "training certification sponsorship"},
            {"turn": 11, "topic": "flexi-hours for sick relative"}
        ],
        [
            "parallel_tool_calls_classify_and_diagnose",
            "verification_before_traffic_steering_change",
            "proactive_quota_warning",
            "suggest_workaround_list_history_while_waiting_cooldown",
            "proactive_pattern_detection_repeat_incident"
        ],
        [
            "detect_sd_wan_incident", "classify_sd_wan_incident",
            "run_sd_wan_diagnostics", "list_sd_wan_incidents",
            "sd_wan_incident_subscribe_to_events", "get_sd_wan_diagnostics_result",
            "propose_sd_wan_remediation", "create_sd_wan_change_request",
            "execute_sd_wan_remediation", "notify_sd_wan_incident_stakeholders",
            "get_sd_wan_incident_timeline", "sd_wan_incident_get_kpi_metrics"
        ],
        "Mandarin-leading Encik Lim Wei Jian (SD-WAN ops); Bahasa+English+Mandarin mix (Ni hao, Hao de, Dui, Ai yaa, Xie xie, Wan an)."
    )
    return I, msgs, meta


# ---------------------------------------------------------------------------
# 86 - udm_quality_assurance_flow (Malay-leading)
# ---------------------------------------------------------------------------
def build_86():
    I = 86
    msgs = []

    msgs.append(user(
        "Selamat pagi. Saya Encik Mohd Faiz Hassan, 5G UDM platform engineer Maxis Core, Cyberjaya. "
        "Hari ni saya nak run QA flow untuk satu config baru — `udm-slice-eMBB-v3` — yang nak rollout production minggu depan. "
        "Boleh mulakan QA session?"
    ))
    msgs.append(assistant_tool(
        "Selamat pagi Encik Faiz. Baik, saya mulakan QA session.",
        [("call-86-001", "create_udm_qa_session", {
            "name": "udm-slice-eMBB-v3 QA pre-production",
            "scope": {
                "config_id": "udm-cfg-emm-v3-7711",
                "config_name": "udm-slice-eMBB-v3",
                "target_environment": "production"
            },
            "owner": {"user_id": "usr-faiz-core-088"},
            "purpose": "pre_production_rollout_validation"
        })]
    ))
    msgs.append(tool("call-86-001", "create_udm_qa_session", {
        "qa_session_id": "qas-emm-v3-aa01",
        "status": "active",
        "created_at": "2026-05-21T08:30:42+08:00"
    }))
    msgs.append(assistant(
        "QA session dicipta, Encik:\n\n"
        "- **qa_session_id:** `qas-emm-v3-aa01`\n\n"
        "Adakah Encik mahu saya snapshot config baseline dulu, sebelum kita validate?"
    ))
    msgs.append(user(
        "Ya, snapshot dulu untuk evidence compliance Suruhanjaya Komunikasi."
    ))
    msgs.append(assistant_tool(
        "Baik.",
        [("call-86-002", "create_udm_config_snapshot", {
            "config_id": "udm-cfg-emm-v3-7711",
            "qa_session_id": "qas-emm-v3-aa01",
            "snapshot_name": "baseline-pre-validation-2026-05-21",
            "retention_days": 365
        })]
    ))
    msgs.append(tool("call-86-002", "create_udm_config_snapshot", {
        "snapshot_id": "snap-udm-bb02",
        "size_bytes": 248320,
        "checksum": "sha256:e8c2f1...",
        "created_at": "2026-05-21T08:31:18+08:00"
    }))
    msgs.append(assistant(
        "Snapshot dicipta:\n\n"
        "- **snapshot_id:** `snap-udm-bb02`\n"
        "- Saiz: 248 KB | Retention: 365 hari\n\n"
        "Adakah Encik mahu saya run static validation pada config?"
    ))
    msgs.append(user(
        "Ya, static validation dulu. Saya curiga ada slice-id collision."
    ))
    msgs.append(assistant_tool(
        "Baik.",
        [("call-86-003", "run_static_udm_config_validation", {
            "config_id": "udm-cfg-emm-v3-7711",
            "qa_session_id": "qas-emm-v3-aa01",
            "validation_rulesets": ["schema_strict", "slice_id_uniqueness", "subscriber_profile_consistency", "regulatory_my_skmm"]
        })]
    ))
    msgs.append(tool("call-86-003", "run_static_udm_config_validation", {
        "error": {
            "http_status": 400,
            "code": "validation_error",
            "message": "Validation ruleset 'regulatory_my_skmm' requires field 'lawful_intercept_profile_ref' but config has it set to null. Either supply the profile ref or remove this ruleset.",
            "field_path": "config.lawful_intercept_profile_ref",
            "trace_id": "trc-400-2026-05-21-08-33-aa"
        }
    }))
    msgs.append(assistant(
        "Maaf Encik, validation gagal dengan **HTTP 400 Validation Error**:\n\n"
        "- **Masalah:** ruleset `regulatory_my_skmm` perlukan `lawful_intercept_profile_ref` tetapi config set null.\n"
        "- **Trace ID:** `trc-400-2026-05-21-08-33-aa`\n\n"
        "Adakah Encik confirm config sepatutnya ada LI profile (mandatori untuk pengeluaran MY) atau Encik nak skip ruleset SKMM "
        "untuk pre-prod environment?"
    ))
    msgs.append(user(
        "Aaa lupa nak set LI profile ref — production memang mandatori. Profile ID `li-prof-my-2025-prod`. "
        "Update config, then retry validate."
    ))
    msgs.append(assistant_tool(
        "Tiada masalah Encik, retry dengan ruleset SKMM tetapi update field config dahulu via comment trail.",
        [
            ("call-86-004", "udm_qa_add_comment", {
                "scope": {"qa_session_id": "qas-emm-v3-aa01", "config_id": "udm-cfg-emm-v3-7711"},
                "comment": "Setting lawful_intercept_profile_ref='li-prof-my-2025-prod' as required for production rollout (SKMM compliance).",
                "actor": {"user_id": "usr-faiz-core-088"}
            }),
            ("call-86-005", "run_static_udm_config_validation", {
                "config_id": "udm-cfg-emm-v3-7711",
                "qa_session_id": "qas-emm-v3-aa01",
                "validation_rulesets": ["schema_strict", "slice_id_uniqueness", "subscriber_profile_consistency", "regulatory_my_skmm"],
                "config_overrides": {"lawful_intercept_profile_ref": "li-prof-my-2025-prod"}
            })
        ]
    ))
    msgs.append(tool("call-86-004", "udm_qa_add_comment", {
        "comment_id": "cmt-emm-cc03",
        "added_at": "2026-05-21T08:34:10+08:00"
    }))
    msgs.append(tool("call-86-005", "run_static_udm_config_validation", {
        "validation_id": "val-emm-dd04",
        "status": "pass_with_warnings",
        "findings": [
            {"ruleset": "schema_strict", "status": "pass"},
            {"ruleset": "slice_id_uniqueness", "status": "warning", "detail": "slice_id S-NSSAI 01-000077 reused from deprecated config emm-v2; consider renumbering"},
            {"ruleset": "subscriber_profile_consistency", "status": "pass"},
            {"ruleset": "regulatory_my_skmm", "status": "pass"}
        ],
        "_warning": "quota_remaining_today: 8 of 30 validation runs."
    }))
    msgs.append(assistant(
        "Validation siap, Encik:\n\n"
        "- **status:** pass_with_warnings\n"
        "- Schema: PASS | Subscriber profile: PASS | SKMM regulatory: PASS\n"
        "- ⚠️ slice_id_uniqueness: WARNING — S-NSSAI 01-000077 di-reuse dari emm-v2 deprecated; saya cadang renumber\n"
        "- Amaran kuota proaktif: hanya **8 daripada 30** validation runs tinggal hari ini.\n\n"
        "Adakah Encik mahu saya prep test dataset dan test suite untuk full dynamic test?"
    ))
    msgs.append(user(
        "Ya, prep test dataset 5000 subscriber synthetic + test suite cover eMBB throughput dan slice isolation."
    ))
    msgs.append(assistant_tool(
        "Parallel calls.",
        [
            ("call-86-006", "prepare_udm_test_dataset", {
                "qa_session_id": "qas-emm-v3-aa01",
                "synthetic_subscriber_count": 5000,
                "dataset_profile": "embb_mixed_imsi_my"
            }),
            ("call-86-007", "create_udm_test_suite", {
                "qa_session_id": "qas-emm-v3-aa01",
                "suite_name": "eMBB-v3-functional-and-isolation",
                "test_cases": [
                    {"case_id": "tc-embb-throughput-001", "category": "throughput"},
                    {"case_id": "tc-slice-isolation-002", "category": "isolation"},
                    {"case_id": "tc-emergency-attach-003", "category": "regulatory"}
                ]
            })
        ]
    ))
    msgs.append(tool("call-86-006", "prepare_udm_test_dataset", {
        "dataset_id": "ds-embb-ee05",
        "subscriber_count": 5000,
        "ready_at": "2026-05-21T08:36:00+08:00"
    }))
    msgs.append(tool("call-86-007", "create_udm_test_suite", {
        "test_suite_id": "suite-embb-ff06",
        "case_count": 3,
        "created_at": "2026-05-21T08:36:05+08:00"
    }))
    msgs.append(assistant(
        "Dataset + suite siap:\n\n"
        "- **dataset_id:** `ds-embb-ee05` (5000 subscriber)\n"
        "- **test_suite_id:** `suite-embb-ff06` (3 test case)\n\n"
        "Saya boleh run suite sekarang. Setuju?"
    ))
    msgs.append(user(
        "Ya run. Sat sat, telefon supervisor masuk... [pause] OK sambung."
    ))
    msgs.append(assistant_tool(
        "Saya tunggu Encik tadi. Run suite.",
        [("call-86-008", "run_udm_test_suite", {
            "test_suite_id": "suite-embb-ff06",
            "dataset_id": "ds-embb-ee05",
            "qa_session_id": "qas-emm-v3-aa01"
        })]
    ))
    msgs.append(tool("call-86-008", "run_udm_test_suite", {
        "http_status": 202,
        "test_run_id": "trun-embb-gg07",
        "status": "in_progress",
        "estimated_completion_minutes": 12
    }))
    msgs.append(assistant(
        "Test run accepted (**HTTP 202**):\n\n"
        "- **test_run_id:** `trun-embb-gg07`\n"
        "- ETA: 12 minit\n\n"
        "Saya akan tunggu, kemudian check status."
    ))
    msgs.append(user(
        "OK. Sambil tu, eh — tanya luar topik sikit, parking pejabat Cyberjaya Tower 8 hari ni penuh tak? "
        "Saya nak pindah parking kalau penuh."
    ))
    msgs.append(assistant(
        "Maaf Encik Faiz, status parking adalah di luar skop khidmat QA saya. Untuk hal tersebut:\n\n"
        "- Sila guna aplikasi **ParkingMy** Maxis atau hubungi security front desk Tower 8.\n\n"
        "Kembali kepada operasi — saya akan fetch status test run."
    ))
    msgs.append(user(
        "Hmm OK. Cek status."
    ))
    msgs.append(assistant_tool(
        "Baik.",
        [("call-86-009", "get_udm_test_run_status", {
            "test_run_id": "trun-embb-gg07"
        })]
    ))
    msgs.append(tool("call-86-009", "get_udm_test_run_status", {
        "test_run_id": "trun-embb-gg07",
        "status": "completed",
        "progress_pct": 100,
        "summary": {
            "total_cases": 3,
            "passed": 2,
            "failed": 1,
            "failed_cases": [
                {"case_id": "tc-slice-isolation-002", "reason": "leakage detected: 0.7% of slice-A traffic appeared on slice-B at low load"}
            ]
        },
        "completed_at": "2026-05-21T08:49:30+08:00"
    }))
    msgs.append(assistant(
        "Test selesai dengan satu kegagalan, Encik Faiz:\n\n"
        "- Pass: 2 | Fail: 1\n"
        "- ❌ `tc-slice-isolation-002` — leakage 0.7% slice-A → slice-B pada low load\n\n"
        "Ini critical dari segi tenant isolation. Saya cadang **JANGAN proceed** ke approval untuk production rollout sebelum slice isolation dibetulkan. "
        "Encik nak saya attach evidence kegagalan ini supaya engineering team boleh debug?"
    ))
    msgs.append(user(
        "Ya tolong attach evidence. Saya akan hold rollout sehingga isolation fix."
    ))
    msgs.append(assistant_tool(
        "Baik.",
        [("call-86-010", "udm_qa_attach_evidence", {
            "scope": {"qa_session_id": "qas-emm-v3-aa01", "test_run_id": "trun-embb-gg07"},
            "evidence_items": [
                {
                    "type": "test_failure_report",
                    "ref_id": "tc-slice-isolation-002",
                    "summary": "0.7% inter-slice leakage detected at low load; blocks production rollout."
                }
            ]
        })]
    ))
    msgs.append(tool("call-86-010", "udm_qa_attach_evidence", {
        "evidence_id": "evi-emm-hh08",
        "items_attached": 1
    }))
    msgs.append(assistant(
        "Evidence attached (`evi-emm-hh08`). Adakah Encik mahu saya pull audit log untuk QA session ini supaya ada lengkap rekod investigation?"
    ))
    msgs.append(user(
        "Ya, pull audit log."
    ))
    msgs.append(assistant_tool(
        "Baik.",
        [("call-86-011", "udm_qa_get_audit_log", {
            "scope": {"qa_session_id": "qas-emm-v3-aa01"},
            "include_system_actors": True,
            "limit": 20
        })]
    ))
    msgs.append(tool("call-86-011", "udm_qa_get_audit_log", {
        "entries": [
            {"timestamp": "2026-05-21T08:30:42+08:00", "actor": {"id": "usr-faiz-core-088", "type": "user", "name": "***REDACTED-PII***"}, "action": "qa_session_created"},
            {"timestamp": "2026-05-21T08:31:18+08:00", "actor": {"id": "usr-faiz-core-088", "type": "user"}, "action": "snapshot_created", "snapshot_id": "snap-udm-bb02"},
            {"timestamp": "2026-05-21T08:33:00+08:00", "actor": {"id": "usr-faiz-core-088", "type": "user"}, "action": "static_validation_attempt", "result": "validation_error_400"},
            {"timestamp": "2026-05-21T08:34:10+08:00", "actor": {"id": "usr-faiz-core-088", "type": "user"}, "action": "comment_added"},
            {"timestamp": "2026-05-21T08:34:15+08:00", "actor": {"id": "usr-faiz-core-088", "type": "user"}, "action": "static_validation_attempt", "result": "pass_with_warnings"},
            {"timestamp": "2026-05-21T08:49:30+08:00", "actor": {"id": "system:test_runner", "type": "system"}, "action": "test_run_completed", "result": "1_failure"}
        ],
        "total_entries": 6
    }))
    msgs.append(assistant(
        "Audit log lengkap (6 entries):\n\n"
        "Trail QA session dari 08:30 ke 08:49 — semua tindakan tertangkap. Nama Encik dipaparkan sebagai `***REDACTED-PII***` dalam mod query (normal).\n\n"
        "Adakah Encik mahu saya tutup QA session ini sebagai 'failed_qa, blocking', atau biarkan terbuka untuk re-run selepas slice isolation fix?"
    ))
    msgs.append(user(
        "Biarkan terbuka, engineering akan fix isolation dahulu. Eh satu lagi soalan luar topik — mana boleh saya order kek harijadi "
        "untuk member team minggu depan? Saya tak biasa Cyberjaya."
    ))
    msgs.append(assistant(
        "Maaf Encik Faiz, cadangan kedai kek adalah di luar skop khidmat saya. Untuk hal tersebut:\n\n"
        "- Sila guna **GrabFood** atau **foodpanda** untuk cari kedai kek berdekatan Cyberjaya, atau tanya admin pejabat.\n\n"
        "Kembali kepada operasi — adakah Encik mahu saya pin QA session ini ke dashboard supaya senang track selepas fix nanti?"
    ))
    msgs.append(user(
        "Ya pin. Dan terima kasih atas handling 400 validation, 202 async test, dan warning slice-id reuse tadi."
    ))
    msgs.append(assistant_tool(
        "Pin.",
        [("call-86-012", "udm_qa_pin_to_dashboard", {
            "scope": {"qa_session_id": "qas-emm-v3-aa01"},
            "dashboard_id": "dash-udm-team-core",
            "priority": "high",
            "label": "BLOCKED: slice isolation fix required"
        })]
    ))
    msgs.append(tool("call-86-012", "udm_qa_pin_to_dashboard", {
        "pin_id": "pin-emm-ii09",
        "dashboard_id": "dash-udm-team-core",
        "pinned_at": "2026-05-21T08:55:00+08:00"
    }))
    msgs.append(assistant(
        "Pin sudah disetkan (`pin-emm-ii09`) pada dashboard core team. Adakah ada apa-apa lagi sebelum sesi tutup?"
    ))
    msgs.append(user(
        "Cukup. Terima kasih banyak. Saya akan brief engineering team petang ni. Selamat pagi."
    ))
    msgs.append(assistant(
        "Sama-sama Encik Faiz Hassan. Terima kasih atas kesabaran. Hari ini kita handle 400 validation (LI profile missing), "
        "202 async test run, amaran kuota validation, slice-id reuse warning, dan slice isolation failure yang berjaya kita "
        "tahan sebelum production. Selamat pagi."
    ))

    meta = build_metadata(I, "malay", 14,
        [
            {"http_status": 400, "service": "validation-api", "kind": "validation_error_li_profile_missing", "recovered": True, "via": "add-li-profile-and-retry"},
            {"http_status": 202, "service": "test-runner-api", "kind": "async_test_run", "recovered": True, "via": "wait-and-fetch-status"},
            {"http_status": 200, "service": "validation-api", "kind": "quota_warning", "recovered": True, "via": "agent-flags-low-quota"},
            {"http_status": 200, "service": "test-runner-api", "kind": "partial_failure", "recovered": True, "via": "block-rollout-and-attach-evidence"},
            {"http_status": 200, "service": "audit-api", "kind": "pii_redaction", "recovered": True, "via": "agent-explains-redaction"}
        ],
        [
            {"turn": 9, "topic": "parking availability Tower 8"},
            {"turn": 13, "topic": "birthday cake shop recommendation"}
        ],
        [
            "proactive_quota_warning",
            "refuses_proceed_to_production_on_isolation_failure",
            "parallel_tool_calls_dataset_and_suite",
            "self_correction_after_validation_error_400",
            "explains_pii_redaction"
        ],
        [
            "create_udm_qa_session", "create_udm_config_snapshot",
            "run_static_udm_config_validation", "udm_qa_add_comment",
            "prepare_udm_test_dataset", "create_udm_test_suite",
            "run_udm_test_suite", "get_udm_test_run_status",
            "udm_qa_attach_evidence", "udm_qa_get_audit_log", "udm_qa_pin_to_dashboard"
        ],
        "Malay-leading Encik Faiz Hassan (5G UDM platform engineer); Bahasa primary; formal agent."
    )
    return I, msgs, meta


# ---------------------------------------------------------------------------
# 87 - api_gateway_performance_management (English-leading)
# ---------------------------------------------------------------------------
def build_87():
    I = 87
    msgs = []

    msgs.append(user(
        "Good morning. Sir, this is Madam Priya Devi, SRE lead at CelcomDigi API gateway platform, KL. "
        "We're seeing customer complaints about latency spikes on the `customer-portal-api` since 9am. "
        "I need to define a stricter SLO and investigate. Can we start with an SLO definition? "
        "Target: 99.5% of requests under 200ms p99, measurement window 5 minutes."
    ))
    msgs.append(assistant_tool(
        "Good morning Madam Priya. Certainly, I will define the SLO now.",
        [("call-87-001", "define_api_slo", {
            "scope": {"pipeline_name": "customer-portal-api"},
            "slo_name": "p99_latency_200ms_995pct",
            "metric": "request_latency_p99_ms",
            "target": {"comparator": "lte", "value": 200},
            "objective_pct": 99.5,
            "measurement_window_minutes": 5,
            "owner_team": "sre-platform"
        })]
    ))
    msgs.append(tool("call-87-001", "define_api_slo", {
        "slo_id": "slo-cpa-p99-aa01",
        "status": "active",
        "created_at": "2026-05-21T10:05:18+08:00"
    }))
    msgs.append(assistant(
        "SLO defined, Madam:\n\n"
        "- **slo_id:** `slo-cpa-p99-aa01`\n\n"
        "Shall I proceed to run performance diagnostics on the customer-portal-api now?"
    ))
    msgs.append(user(
        "Yes, run diagnostics. Time window last 30 minutes, focus on p99 latency and error rate."
    ))
    msgs.append(assistant_tool(
        "Running diagnostics now.",
        [("call-87-002", "run_performance_diagnostics", {
            "scope": {"pipeline_name": "customer-portal-api"},
            "time_window": {"from": "2026-05-21T09:35:00+08:00", "to": "2026-05-21T10:05:00+08:00"},
            "focus_metrics": ["p99_latency_ms", "error_rate_pct", "throughput_qps"],
            "depth": "deep"
        })]
    ))
    msgs.append(tool("call-87-002", "run_performance_diagnostics", {
        "error": {
            "http_status": 500,
            "code": "internal_server_error",
            "message": "Diagnostics engine encountered an internal error processing the deep query. Engineering has been paged.",
            "incident_id": "inc-diag-engine-2026-05-21-77",
            "trace_id": "trc-500-2026-05-21-10-06-aa"
        }
    }))
    msgs.append(assistant(
        "I apologise Madam, the diagnostics engine returned **HTTP 500 Internal Server Error**:\n\n"
        "- **incident_id:** `inc-diag-engine-2026-05-21-77`\n"
        "- Engineering has been paged automatically.\n\n"
        "As a fallback, I can pull cached performance summaries (lighter query) to give us baseline visibility "
        "while the deep diagnostics engine recovers. Acceptable?"
    ))
    msgs.append(user(
        "Yes, use the cached summary fallback. Time's tight — CEO has asked for an update by 10:30."
    ))
    msgs.append(assistant_tool(
        "Pulling cached summary.",
        [("call-87-003", "list_api_performance_summaries", {
            "scope": {"pipeline_name": "customer-portal-api"},
            "time_window": {"from": "2026-05-21T09:35:00+08:00", "to": "2026-05-21T10:05:00+08:00"},
            "aggregation": "5m_buckets"
        })]
    ))
    msgs.append(tool("call-87-003", "list_api_performance_summaries", {
        "summaries": [
            {"bucket_start": "2026-05-21T09:35:00+08:00", "p99_ms": 178, "error_rate_pct": 0.4, "qps_avg": 820},
            {"bucket_start": "2026-05-21T09:40:00+08:00", "p99_ms": 195, "error_rate_pct": 0.5, "qps_avg": 905},
            {"bucket_start": "2026-05-21T09:45:00+08:00", "p99_ms": 312, "error_rate_pct": 1.1, "qps_avg": 1180},
            {"bucket_start": "2026-05-21T09:50:00+08:00", "p99_ms": 405, "error_rate_pct": 2.4, "qps_avg": 1340},
            {"bucket_start": "2026-05-21T09:55:00+08:00", "p99_ms": 488, "error_rate_pct": 3.2, "qps_avg": 1420},
            {"bucket_start": "2026-05-21T10:00:00+08:00", "p99_ms": 521, "error_rate_pct": 3.6, "qps_avg": 1465}
        ],
        "_warning": "Data freshness: cached snapshots may lag up to 60s; for live data use run_performance_diagnostics (currently unavailable)."
    }))
    msgs.append(assistant(
        "Cached summary clearly shows the degradation, Madam Priya:\n\n"
        "| 5m bucket | p99 (ms) | error % | QPS |\n"
        "|---|---|---|---|\n"
        "| 09:35 | 178 | 0.4% | 820 |\n"
        "| 09:40 | 195 | 0.5% | 905 |\n"
        "| 09:45 | **312** | 1.1% | 1180 |\n"
        "| 09:50 | **405** | 2.4% | 1340 |\n"
        "| 09:55 | **488** | 3.2% | 1420 |\n"
        "| 10:00 | **521** | 3.6% | 1465 |\n\n"
        "Pattern: p99 climbs from 178 → 521ms as QPS grows from 820 → 1465. Strongly suggests capacity bottleneck.\n\n"
        "Shall I open a performance incident formally so it joins our incident response workflow?"
    ))
    msgs.append(user(
        "Yes, open a P1 performance incident. Title 'customer-portal-api p99 latency degradation since 9:45am'."
    ))
    msgs.append(assistant_tool(
        "Opening incident.",
        [("call-87-004", "open_performance_incident", {
            "scope": {"pipeline_name": "customer-portal-api"},
            "title": "customer-portal-api p99 latency degradation since 9:45am",
            "severity": "P1",
            "based_on_summary_window": {"from": "2026-05-21T09:35:00+08:00", "to": "2026-05-21T10:05:00+08:00"},
            "opened_by": {"user_id": "usr-priya-sre-101"}
        })]
    ))
    msgs.append(tool("call-87-004", "open_performance_incident", {
        "incident_id": "inc-perf-cpa-bb02",
        "severity": "P1",
        "status": "open",
        "created_at": "2026-05-21T10:08:11+08:00"
    }))
    msgs.append(assistant(
        "Incident opened:\n\n"
        "- **incident_id:** `inc-perf-cpa-bb02` (P1, status open)\n\n"
        "Next, shall I simulate the impact of a traffic-shaping policy (e.g., shed lowest-priority traffic) "
        "before applying anything to production?"
    ))
    msgs.append(user(
        "Yes, simulate. Shape: throttle internal-batch-jobs traffic to 50% of usual; preserve customer-facing traffic."
    ))
    msgs.append(assistant_tool(
        "Simulating.",
        [("call-87-005", "simulate_policy_impact", {
            "scope": {"pipeline_name": "customer-portal-api"},
            "candidate_policy": {
                "policy_type": "traffic_shaping",
                "rules": [
                    {"match": {"client_segment": "internal-batch-jobs"}, "throttle_to_pct": 50}
                ]
            },
            "what_if_inputs": {
                "current_load_qps": 1465,
                "expected_traffic_mix": {"customer_facing_pct": 78, "internal_batch_pct": 22}
            },
            "output_options": {"include_projected_p99": True, "include_blast_radius": True}
        })]
    ))
    msgs.append(tool("call-87-005", "simulate_policy_impact", {
        "simulation_id": "sim-cpa-cc03",
        "projected_p99_ms": 235,
        "projected_qps_shed": 161,
        "blast_radius": {
            "affected_clients": ["batch-reporting-job", "etl-customer-sync"],
            "downstream_systems": 2
        },
        "risk_band": "low",
        "recommendation": "apply with monitoring; revert if customer-facing p99 not recovering within 5 minutes."
    }))
    msgs.append(assistant(
        "Simulation result, Madam:\n\n"
        "- **Projected p99:** 235ms (down from 521ms — still above SLO target of 200ms but back near healthy)\n"
        "- **QPS shed:** 161 (internal batch)\n"
        "- **Blast radius:** 2 internal jobs (batch-reporting-job, etl-customer-sync)\n"
        "- **Risk band:** low\n\n"
        "Before I apply, please confirm — this is a production traffic-shaping change. Confirm to proceed?"
    ))
    msgs.append(user(
        "Confirmed. Apply the policy."
    ))
    msgs.append(assistant_tool(
        "Applying.",
        [("call-87-006", "create_traffic_shaping_policy", {
            "scope": {"pipeline_name": "customer-portal-api"},
            "policy_name": "shed-internal-batch-50pct-2026-05-21",
            "rules": [
                {"match": {"client_segment": "internal-batch-jobs"}, "throttle_to_pct": 50}
            ],
            "effective_from": "2026-05-21T10:12:00+08:00",
            "expires_at": "2026-05-21T12:12:00+08:00",
            "based_on_simulation_id": "sim-cpa-cc03",
            "incident_ref": "inc-perf-cpa-bb02"
        })]
    ))
    msgs.append(tool("call-87-006", "create_traffic_shaping_policy", {
        "policy_id": "pol-shape-cpa-dd04",
        "status": "active",
        "effective_from": "2026-05-21T10:12:00+08:00",
        "expires_at": "2026-05-21T12:12:00+08:00"
    }))
    msgs.append(assistant(
        "Policy applied:\n\n"
        "- **policy_id:** `pol-shape-cpa-dd04`\n"
        "- Active 10:12 → 12:12 MYT (2 hour window)\n\n"
        "Shall I also tune capacity scaling now as a parallel mitigation?"
    ))
    msgs.append(user(
        "Yes. Scale up by 30% on the inference fleet. Also — random aside — do you know what time the office gym closes today, "
        "Madam? Trying to plan a workout after this fire is out."
    ))
    msgs.append(assistant(
        "I apologise Madam Priya, office gym hours fall outside my performance-management scope. For that:\n\n"
        "- Please refer to **the FacilitiesMy intranet** or contact the gym at level 8 reception.\n\n"
        "Returning to the workflow — I will tune capacity scaling now.",
        ))
    msgs.append(assistant_tool(
        "",
        [("call-87-007", "tune_capacity_and_scaling", {
            "scope": {"pipeline_name": "customer-portal-api"},
            "scaling_inputs": {
                "scale_factor_pct": 130,
                "fleet": "inference",
                "trigger_reason": "p1_incident_inc-perf-cpa-bb02"
            }
        })]
    ))
    msgs.append(tool("call-87-007", "tune_capacity_and_scaling", {
        "scaling_id": "scl-cpa-ee05",
        "current_replicas": 12,
        "target_replicas": 16,
        "status": "in_progress",
        "estimated_completion_seconds": 90
    }))
    msgs.append(assistant(
        "Scaling in progress: 12 → 16 replicas (ETA 90s).\n\n"
        "Shall I check overall performance status to see if the policy + scaling are taking effect?"
    ))
    msgs.append(user(
        "Yes, check status."
    ))
    msgs.append(assistant_tool(
        "Checking.",
        [("call-87-008", "get_performance_status", {
            "scope": {"pipeline_name": "customer-portal-api"},
            "include_active_policies": True
        })]
    ))
    msgs.append(tool("call-87-008", "get_performance_status", {
        "current_p99_ms": 248,
        "current_error_rate_pct": 1.1,
        "current_qps": 1390,
        "active_policies": ["pol-shape-cpa-dd04"],
        "active_scaling_operations": ["scl-cpa-ee05"],
        "slo_status": "at_risk",
        "_warning": "X-API-Deprecated: get_performance_status v1 sunset 2026-10-31; migrate to v2 with sub-SLO breakdown."
    }))
    msgs.append(assistant(
        "Status, Madam:\n\n"
        "- p99 now: **248ms** (down from 521ms)\n"
        "- Error rate: 1.1% (down from 3.6%)\n"
        "- SLO status: **at_risk** but recovering\n\n"
        "Proactive deprecation flag: the response includes **X-API-Deprecated** — `get_performance_status` v1 sunsets "
        "**31 October 2026**. Platform team should migrate to v2 with sub-SLO breakdown."
    ))
    msgs.append(user(
        "Good progress. Let me also schedule a recurring time-series query to monitor recovery for the next 2 hours."
    ))
    msgs.append(assistant_tool(
        "Scheduling.",
        [("call-87-009", "save_and_run_timeseries_query", {
            "query_name": "cpa-p99-recovery-watch",
            "query_expression": "p99_latency_ms{pipeline='customer-portal-api'} over 5m",
            "save_for_recurring": True,
            "schedule_interval_minutes": 5,
            "expires_at": "2026-05-21T12:15:00+08:00"
        })]
    ))
    msgs.append(tool("call-87-009", "save_and_run_timeseries_query", {
        "query_id": "qry-ts-cpa-ff06",
        "first_result": {"timestamp": "2026-05-21T10:15:00+08:00", "p99_ms": 232},
        "scheduled_until": "2026-05-21T12:15:00+08:00"
    }))
    msgs.append(assistant(
        "Recurring query saved (`qry-ts-cpa-ff06`); first reading p99=232ms. Active until 12:15 MYT.\n\n"
        "Anything else for the CEO briefing?"
    ))
    msgs.append(user(
        "Yes, can I see the audit log for everything we did today, for the post-incident report?"
    ))
    msgs.append(assistant_tool(
        "Pulling.",
        [("call-87-010", "api_performance_get_audit_log", {
            "scope": {"incident_id": "inc-perf-cpa-bb02"},
            "include_system_actors": True,
            "limit": 20
        })]
    ))
    msgs.append(tool("call-87-010", "api_performance_get_audit_log", {
        "entries": [
            {"timestamp": "2026-05-21T10:05:18+08:00", "actor": {"id": "usr-priya-sre-101", "name": "***REDACTED-PII***"}, "action": "slo_defined", "slo_id": "slo-cpa-p99-aa01"},
            {"timestamp": "2026-05-21T10:06:00+08:00", "actor": {"id": "system:diagnostics"}, "action": "diagnostics_failed_500"},
            {"timestamp": "2026-05-21T10:08:11+08:00", "actor": {"id": "usr-priya-sre-101"}, "action": "incident_opened", "incident_id": "inc-perf-cpa-bb02"},
            {"timestamp": "2026-05-21T10:11:00+08:00", "actor": {"id": "usr-priya-sre-101"}, "action": "simulation_run", "simulation_id": "sim-cpa-cc03"},
            {"timestamp": "2026-05-21T10:12:00+08:00", "actor": {"id": "usr-priya-sre-101"}, "action": "policy_applied", "policy_id": "pol-shape-cpa-dd04"},
            {"timestamp": "2026-05-21T10:13:00+08:00", "actor": {"id": "usr-priya-sre-101"}, "action": "scaling_initiated", "scaling_id": "scl-cpa-ee05"}
        ],
        "total_entries": 6
    }))
    msgs.append(assistant(
        "Audit log captured, Madam Priya (6 entries from 10:05 → 10:13). Your name redacted in query mode (normal). "
        "Anything else before we wrap?"
    ))
    msgs.append(user(
        "One last off-topic — is there a way the gateway team can sponsor coffee for my SREs after this incident? "
        "They worked hard."
    ))
    msgs.append(assistant(
        "I apologise Madam, team perks and sponsorship are outside my performance-management scope. For that:\n\n"
        "- Please refer to your **line manager** or the **TeamMorale@CelcomDigi** Slack channel for sponsorship requests.\n\n"
        "Returning to the workflow — is there anything else technical I can help with before closing?"
    ))
    msgs.append(user(
        "No that's all. Thank you for handling the 500 diagnostic outage and walking through the fallback. CEO update in 10min."
    ))
    msgs.append(assistant(
        "You are welcome, Madam Priya. To summarise: we handled a 500 internal-server-error on the diagnostics engine (recovered via cached-summary fallback), "
        "an X-API-Deprecated warning on status v1, applied a traffic-shaping policy and scaling tune, and saved a recurring time-series watch. "
        "Best of luck with the CEO briefing, and please contact us if anything changes."
    ))

    meta = build_metadata(I, "english", 13,
        [
            {"http_status": 500, "service": "diagnostics-api", "kind": "internal_server_error", "recovered": True, "via": "fallback-cached-summary"},
            {"http_status": 200, "service": "status-api", "kind": "deprecation_warning", "recovered": True, "via": "agent-flags-sunset-date"},
            {"http_status": 200, "service": "summaries-api", "kind": "data_freshness_warning", "recovered": True, "via": "agent-explains-60s-lag"},
            {"http_status": 200, "service": "audit-api", "kind": "pii_redaction", "recovered": True, "via": "agent-explains-redaction"}
        ],
        [
            {"turn": 8, "topic": "office gym hours"},
            {"turn": 12, "topic": "team coffee sponsorship request"}
        ],
        [
            "suggest_workaround_cached_summary_when_500",
            "verification_before_applying_traffic_shaping",
            "proactive_deprecation_warning",
            "proactive_simulation_before_policy_apply",
            "explains_pii_redaction"
        ],
        [
            "define_api_slo", "run_performance_diagnostics",
            "list_api_performance_summaries", "open_performance_incident",
            "simulate_policy_impact", "create_traffic_shaping_policy",
            "tune_capacity_and_scaling", "get_performance_status",
            "save_and_run_timeseries_query", "api_performance_get_audit_log"
        ],
        "English-leading Madam Priya Devi (SRE lead); formal English with Madam."
    )
    return I, msgs, meta


# ---------------------------------------------------------------------------
# 88 - customer_retention_lifecycle (Tamil-leading)
# ---------------------------------------------------------------------------
def build_88():
    I = 88
    msgs = []

    msgs.append(user(
        "Vanakkam, selamat petang Encik/Puan. Saya Puan Kavitha Selvi, retention ops manager Maxis Consumer, "
        "Petaling Jaya. Saya nak buka kes retensi untuk satu customer high-value — Encik Anand Murugan, "
        "subscriber ID `sub-anand-77891`. Dia call complaint pasal bill last week dan threatened nak port out ke competitor. "
        "Boleh analyze churn risk dulu?"
    ))
    msgs.append(assistant_tool(
        "Vanakkam, selamat petang Puan Kavitha. Baik, saya analyze churn risk sekarang.",
        [("call-88-001", "analyze_churn_risk", {
            "subscriber_id": "sub-anand-77891",
            "context_signals": ["recent_billing_complaint", "port_out_threat_verbal"],
            "lookback_days": 90
        })]
    ))
    msgs.append(tool("call-88-001", "analyze_churn_risk", {
        "churn_score": 0.87,
        "risk_band": "very_high",
        "key_drivers": [
            "recent_bill_dispute_RM_182_credit_unsuccessful",
            "decline_in_data_usage_30pct_last_30d",
            "competitor_app_install_detected_2026_05_18"
        ],
        "tenure_months": 84,
        "lifetime_value_band": "platinum"
    }))
    msgs.append(assistant(
        "Risk profile critical, Puan Kavitha:\n\n"
        "- **Churn score:** 0.87 (very high)\n"
        "- **Tenure:** 84 bulan (7 tahun) | LTV band: **platinum**\n"
        "- Driver utama: bill dispute RM 182 belum settle, drop usage 30%, competitor app dipasang 18 Mei\n\n"
        "Saya cadang buka kes retensi serta-merta. Setuju?"
    ))
    msgs.append(user(
        "Appadi-aa, severity tinggi. Seri, buka kes."
    ))
    msgs.append(assistant_tool(
        "Baik.",
        [("call-88-002", "create_retention_case", {
            "subscriber_id": "sub-anand-77891",
            "trigger_source": "agent_initiated_post_complaint",
            "churn_risk_band": "very_high",
            "owner": {"user_id": "usr-kavitha-rtn-088", "role": "retention_ops"},
            "priority": "P1"
        })]
    ))
    msgs.append(tool("call-88-002", "create_retention_case", {
        "retention_case_id": "rcase-anand-aa01",
        "status": "open",
        "priority": "P1",
        "created_at": "2026-05-21T15:45:11+08:00"
    }))
    msgs.append(assistant(
        "Kes retensi dibuka:\n\n"
        "- **retention_case_id:** `rcase-anand-aa01` (P1, status open)\n\n"
        "Adakah Puan mahu saya jana cadangan offer untuk customer ini?"
    ))
    msgs.append(user(
        "Romba nandri, ya tolong jana. Constraint: maksimum offer value RM 250, tidak boleh extend contract lebih 24 bulan."
    ))
    msgs.append(assistant_tool(
        "Baik.",
        [("call-88-003", "recommend_retention_offers", {
            "retention_case_id": "rcase-anand-aa01",
            "constraints": {
                "max_offer_value_myr": 250,
                "max_contract_extension_months": 24
            },
            "include_rationale": True
        })]
    ))
    msgs.append(tool("call-88-003", "recommend_retention_offers", {
        "error": {
            "http_status": 503,
            "code": "service_unavailable",
            "message": "Retention offer recommendation engine is currently scaling up after a deployment. Estimated recovery: 4 minutes.",
            "incident_id": "inc-rtn-engine-2026-05-21",
            "retry_after_seconds": 240,
            "trace_id": "trc-503-2026-05-21-15-46-aa"
        }
    }))
    msgs.append(assistant(
        "Maaf Puan, recommendation engine balas **HTTP 503 Service Unavailable**:\n\n"
        "- **incident_id:** `inc-rtn-engine-2026-05-21`\n"
        "- Anggar pulih: 4 minit\n\n"
        "Sebagai langkah alternatif sambil tunggu, saya boleh tarik list kes retensi serupa (very_high band, platinum LTV) "
        "untuk lihat pattern offer yang berjaya kebelakangan ini. Ini boleh inform pilihan Puan walau engine belum siap. Setuju?"
    ))
    msgs.append(user(
        "Aiyo, betul lagi servis kena downtime. Seri, list kes serupa."
    ))
    msgs.append(assistant_tool(
        "Baik.",
        [("call-88-004", "list_retention_cases", {
            "filters": {
                "churn_risk_band": "very_high",
                "lifetime_value_band": "platinum",
                "status_in": ["accepted", "closed_retained"],
                "time_range": {"from": "2026-04-01T00:00:00+08:00", "to": "2026-05-21T15:46:00+08:00"}
            },
            "page_size": 5,
            "sort_by": "closed_at",
            "sort_direction": "desc"
        })]
    ))
    msgs.append(tool("call-88-004", "list_retention_cases", {
        "data": [
            {"retention_case_id": "rcase-rm-9912", "subscriber_id": "sub-rm-...", "offer_applied": "data-doubler-24m + bill-credit-RM150", "closed_at": "2026-05-18T11:00:00+08:00", "outcome": "retained"},
            {"retention_case_id": "rcase-pk-9908", "subscriber_id": "sub-pk-...", "offer_applied": "bill-credit-RM200 + free-roaming-3m", "closed_at": "2026-05-15T14:30:00+08:00", "outcome": "retained"},
            {"retention_case_id": "rcase-ks-9899", "subscriber_id": "sub-ks-...", "offer_applied": "loyalty-device-discount-RM250", "closed_at": "2026-05-10T09:14:00+08:00", "outcome": "retained"}
        ],
        "pagination": {"has_next_page": True, "next_cursor": "csr-rtn-2026-04-zz", "total_count": 11}
    }))
    msgs.append(assistant(
        "3 kes serupa retained baru-baru ini, Puan:\n\n"
        "1. data-doubler-24m + bill-credit RM 150\n"
        "2. bill-credit RM 200 + free-roaming-3m\n"
        "3. loyalty-device-discount RM 250\n\n"
        "Ada 8 lagi dalam page seterusnya. Mahu saya lanjut atau cukup setakat ini sebab pattern dah jelas — bill-credit + sweetener tambahan biasanya berjaya?"
    ))
    msgs.append(user(
        "Cukup. Pattern jelas. Cuba retry recommend_retention_offers sekarang, mungkin engine dah pulih."
    ))
    msgs.append(assistant_tool(
        "Retry.",
        [("call-88-005", "recommend_retention_offers", {
            "retention_case_id": "rcase-anand-aa01",
            "constraints": {
                "max_offer_value_myr": 250,
                "max_contract_extension_months": 24
            },
            "include_rationale": True
        })]
    ))
    msgs.append(tool("call-88-005", "recommend_retention_offers", {
        "recommended_offers": [
            {
                "offer_id": "offer-bc150-dd-24m-bb02",
                "offer_name": "Bill-Credit RM150 + Data-Doubler 24m",
                "estimated_value_myr": 230,
                "expected_retention_uplift_pct": 62,
                "rationale": "Closest match to recent successful pattern; below cost ceiling."
            },
            {
                "offer_id": "offer-bc200-roam3m-cc03",
                "offer_name": "Bill-Credit RM200 + Free-Roaming 3m",
                "estimated_value_myr": 245,
                "expected_retention_uplift_pct": 58,
                "rationale": "Higher direct value but lower expected uplift due to mismatch on usage decline driver."
            }
        ],
        "_warning": "quota_remaining_today: 11 of 80 recommendation runs."
    }))
    msgs.append(assistant(
        "2 cadangan offer, Puan:\n\n"
        "| Offer | Value | Uplift | Rationale |\n"
        "|---|---|---|---|\n"
        "| Bill-Credit RM150 + Data-Doubler 24m | RM 230 | **62%** | Match pattern terbaru |\n"
        "| Bill-Credit RM200 + Free-Roaming 3m | RM 245 | 58% | Value tinggi tapi uplift sedikit kurang |\n\n"
        "Amaran kuota proaktif: 11 daripada 80 recommendation runs tinggal hari ini.\n\n"
        "Cadangan saya: pilih offer pertama. Tetapi sebelum apply, baik simulate impact dulu. Setuju?"
    ))
    msgs.append(user(
        "Aiyaa, baik idea. Simulate offer pertama."
    ))
    msgs.append(assistant_tool(
        "Baik.",
        [("call-88-006", "simulate_retention_offer_impact", {
            "retention_case_id": "rcase-anand-aa01",
            "offer_id": "offer-bc150-dd-24m-bb02",
            "what_if_inputs": {
                "current_arpu_myr": 89,
                "remaining_contract_months": 3
            },
            "output_options": {"include_ltv_projection": True}
        })]
    ))
    msgs.append(tool("call-88-006", "simulate_retention_offer_impact", {
        "simulation_id": "sim-rtn-cc03",
        "projected_retention_pct": 62,
        "projected_ltv_uplift_myr_24m": 1340,
        "projected_offer_cost_myr": 230,
        "net_ltv_uplift_myr": 1110,
        "breakeven_months": 4
    }))
    msgs.append(assistant(
        "Simulasi positif, Puan:\n\n"
        "- **Projected retention:** 62%\n"
        "- **LTV uplift 24m:** RM 1,340 | Net (selepas offer cost): **RM 1,110**\n"
        "- **Breakeven:** 4 bulan\n\n"
        "Sebelum saya request approval untuk lock offer ini, izinkan saya jelaskan kesan tindakan ini:\n\n"
        "1. Offer akan **dikunci dan tidak boleh diubah** selepas approval.\n"
        "2. Bill-credit RM 150 akan dikreditkan pada bil berikutnya customer.\n"
        "3. Data-doubler akan aktif untuk 24 bulan dan tidak boleh dibatalkan tanpa penalti.\n\n"
        "Setuju untuk request approval?"
    ))
    msgs.append(user(
        "Setuju. Request approval."
    ))
    msgs.append(assistant_tool(
        "Baik.",
        [("call-88-007", "approve_and_lock_retention_offer", {
            "retention_case_id": "rcase-anand-aa01",
            "offer_id": "offer-bc150-dd-24m-bb02",
            "based_on_simulation_id": "sim-rtn-cc03",
            "approver": {"user_id": "usr-kavitha-rtn-088"},
            "lock_period_hours": 48
        })]
    ))
    msgs.append(tool("call-88-007", "approve_and_lock_retention_offer", {
        "lock_id": "lock-rtn-dd04",
        "status": "approved_and_locked",
        "locked_until": "2026-05-23T15:48:33+08:00",
        "approved_at": "2026-05-21T15:48:33+08:00"
    }))
    msgs.append(assistant(
        "Offer locked:\n\n"
        "- **lock_id:** `lock-rtn-dd04`\n"
        "- Locked sehingga 23 Mei 15:48 MYT (48 jam)\n\n"
        "Adakah Puan mahu present offer kepada customer sekarang? Saya boleh prep konfirmasi script."
    ))
    msgs.append(user(
        "Ya present. Saya akan call Encik Anand sebentar lagi. Aiyoyo, sat, telefon supervisor masuk... [pause] OK done."
    ))
    msgs.append(assistant_tool(
        "Saya tunggu Puan tadi. Present offer.",
        [("call-88-008", "present_offer_to_customer", {
            "retention_case_id": "rcase-anand-aa01",
            "offer_id": "offer-bc150-dd-24m-bb02",
            "lock_id": "lock-rtn-dd04",
            "presentation_channel": "outbound_call",
            "presented_by": {"user_id": "usr-kavitha-rtn-088"}
        })]
    ))
    msgs.append(tool("call-88-008", "present_offer_to_customer", {
        "presentation_id": "pres-rtn-ee05",
        "status": "pending_customer_decision",
        "presented_at": "2026-05-21T15:52:00+08:00",
        "decision_deadline": "2026-05-22T15:52:00+08:00"
    }))
    msgs.append(assistant(
        "Offer dipresent (`pres-rtn-ee05`). Status pending customer decision (deadline 22 Mei 15:52).\n\n"
        "Adakah ada apa-apa lagi yang Puan perlukan?"
    ))
    msgs.append(user(
        "Eh tanya luar topik sikit — saya nak cuti raya esok untuk family kahwin di Ipoh. Saya kena apply di mana?"
    ))
    msgs.append(assistant(
        "Maaf Puan Kavitha, urusan cuti adalah di luar skop khidmat retention saya. Untuk hal tersebut:\n\n"
        "- Sila guna **WorkdayMy** (modul Time Off → Annual Leave) atau hubungi line manager Puan.\n\n"
        "Saya doakan majlis kahwin keluarga Puan berjalan lancar. Kembali kepada operasi — adakah Puan mahu saya pull "
        "audit log untuk kes ini supaya ada rekod lengkap?"
    ))
    msgs.append(user(
        "Ya pull audit log."
    ))
    msgs.append(assistant_tool(
        "Baik.",
        [("call-88-009", "retention_case_get_audit_log", {
            "scope": {"retention_case_id": "rcase-anand-aa01"},
            "include_system_actors": True,
            "limit": 20
        })]
    ))
    msgs.append(tool("call-88-009", "retention_case_get_audit_log", {
        "entries": [
            {"timestamp": "2026-05-21T15:45:11+08:00", "actor": {"id": "usr-kavitha-rtn-088", "name": "***REDACTED-PII***"}, "action": "case_created"},
            {"timestamp": "2026-05-21T15:46:00+08:00", "actor": {"id": "system:reco_engine"}, "action": "recommend_offers_attempt", "result": "service_unavailable_503"},
            {"timestamp": "2026-05-21T15:47:30+08:00", "actor": {"id": "usr-kavitha-rtn-088"}, "action": "recommend_offers_retry", "result": "ok"},
            {"timestamp": "2026-05-21T15:48:00+08:00", "actor": {"id": "usr-kavitha-rtn-088"}, "action": "simulation_run", "simulation_id": "sim-rtn-cc03"},
            {"timestamp": "2026-05-21T15:48:33+08:00", "actor": {"id": "usr-kavitha-rtn-088"}, "action": "approved_and_locked", "lock_id": "lock-rtn-dd04"},
            {"timestamp": "2026-05-21T15:52:00+08:00", "actor": {"id": "usr-kavitha-rtn-088"}, "action": "presented_to_customer", "presentation_id": "pres-rtn-ee05"}
        ],
        "total_entries": 6,
        "pagination": {"has_next_page": False}
    }))
    msgs.append(assistant(
        "Audit log lengkap (6 entries) — semua tindakan tertangkap dari case_created (15:45) ke presented_to_customer (15:52). "
        "Nama Puan dipaparkan sebagai `***REDACTED-PII***` (normal, mod query)."
    ))
    msgs.append(user(
        "Bagus. Last — KPI dashboard retention saya hari ni untuk hand-off shift petang."
    ))
    msgs.append(assistant_tool(
        "Baik.",
        [("call-88-010", "retention_case_get_kpi_metrics", {
            "scope": {"owner_user_id": "usr-kavitha-rtn-088"},
            "metric_set": "daily_summary",
            "time_range": {"from": "2026-05-21T00:00:00+08:00", "to": "2026-05-21T16:00:00+08:00"}
        })]
    ))
    msgs.append(tool("call-88-010", "retention_case_get_kpi_metrics", {
        "kpis": {
            "cases_opened_today": 8,
            "cases_closed_retained": 5,
            "cases_closed_lost": 1,
            "cases_pending": 2,
            "save_rate_pct": 62.5,
            "average_offer_value_myr": 215,
            "average_ltv_uplift_myr": 1080
        }
    }))
    msgs.append(assistant(
        "KPI hari ini Puan Kavitha:\n\n"
        "- 8 kes opened | 5 retained | 1 lost | **2 pending** (termasuk Encik Anand)\n"
        "- **Save rate:** 62.5%\n"
        "- Average offer: RM 215 | Average LTV uplift: RM 1,080\n\n"
        "Bagus untuk hand-off. Adakah ada apa-apa lagi?"
    ))
    msgs.append(user(
        "Cukup. Romba nandri Encik/Puan, terima kasih banyak atas handling 503 retention engine outage tadi, "
        "dengan fallback list kes serupa. Saya tunggu keputusan Encik Anand esok. Selamat petang."
    ))
    msgs.append(assistant(
        "Sama-sama Puan Kavitha Selvi. Vanakkam dan terima kasih atas kesabaran. Hari ini kita handle 503 service unavailable "
        "(diselesaikan dengan fallback list_retention_cases pattern analysis), amaran kuota proaktif, dan workflow lengkap "
        "dari risk-analyze hingga present-to-customer. Selamat petang."
    ))

    meta = build_metadata(I, "tamil", 14,
        [
            {"http_status": 503, "service": "recommendation-engine-api", "kind": "service_unavailable", "recovered": True, "via": "fallback-list-similar-cases-then-retry"},
            {"http_status": 200, "service": "recommendation-engine-api", "kind": "quota_warning", "recovered": True, "via": "agent-flags-low-quota"},
            {"http_status": 200, "service": "list-retention-cases-api", "kind": "has_next_page", "recovered": True, "via": "agent-offers-pagination-but-pattern-clear"},
            {"http_status": 200, "service": "audit-api", "kind": "pii_redaction", "recovered": True, "via": "agent-explains-redaction"}
        ],
        [
            {"turn": 11, "topic": "annual leave application for family wedding"}
        ],
        [
            "suggest_workaround_list_similar_cases_when_engine_down",
            "verification_before_locking_offer",
            "proactive_quota_warning",
            "proactive_simulation_before_offer_lock",
            "explains_pii_redaction"
        ],
        [
            "analyze_churn_risk", "create_retention_case",
            "recommend_retention_offers", "list_retention_cases",
            "simulate_retention_offer_impact", "approve_and_lock_retention_offer",
            "present_offer_to_customer", "retention_case_get_audit_log",
            "retention_case_get_kpi_metrics"
        ],
        "Tamil-leading Puan Kavitha Selvi (retention ops manager); Tamil+Bahasa+English (Vanakkam, appadi-aa, seri, romba nandri, Aiyo, Aiyaa, Aiyoyo)."
    )
    # Need 2 OOCs - add one more
    new_msgs = []
    inserted = False
    for m in msgs:
        if not inserted and m['role'] == 'user' and m.get('content','').startswith("Cukup. Romba nandri"):
            new_msgs.append(user(
                "Sat lagi soalan luar topik — kafetaria Maxis PJ ada makanan vegetarian Tamil tak hari ni? Saya lapar."
            ))
            new_msgs.append(assistant(
                "Maaf Puan Kavitha, menu kafetaria adalah di luar skop khidmat retention saya. Untuk hal tersebut:\n\n"
                "- Sila guna aplikasi **FoodAtWork** atau tanya front desk pejabat PJ.\n\n"
                "Kembali kepada operasi — ada apa-apa lagi sebelum kita tutup?"
            ))
            inserted = True
        new_msgs.append(m)
    meta['metadata']['out_of_context_turns'].append({"turn": 13, "topic": "cafeteria vegetarian Tamil menu"})
    meta['metadata']['num_turns'] = sum(1 for m in new_msgs if m['role']=='user')
    return I, new_msgs, meta


# ---------------------------------------------------------------------------
# 89 - sd_wan_entitlement_flow (Malay-leading)
# ---------------------------------------------------------------------------
def build_89():
    I = 89
    msgs = []

    msgs.append(user(
        "Selamat petang. Saya Encik Khairul Anwar, entitlement administrator Maxis B2B Service Operations, Subang Jaya. "
        "Customer ABC Logistics nak upgrade SD-WAN entitlement — tambah 8 site baru, term tambahan 12 bulan. "
        "Customer ID `cust-abc-5588`, current entitlement ID `ent-abc-5588-curr`. Boleh check eligibility dulu?"
    ))
    msgs.append(assistant_tool(
        "Selamat petang Encik Khairul. Baik, saya semak eligibility sekarang.",
        [("call-89-001", "check_customer_entitlement_eligibility", {
            "customer_id": "cust-abc-5588",
            "requested_change": {
                "change_type": "add_sites",
                "additional_sites_count": 8,
                "additional_term_months": 12
            },
            "current_entitlement_id": "ent-abc-5588-curr"
        })]
    ))
    msgs.append(tool("call-89-001", "check_customer_entitlement_eligibility", {
        "error": {
            "http_status": 404,
            "code": "not_found",
            "message": "Entitlement ID 'ent-abc-5588-curr' not found in tenant scope. Did you mean 'ent-abc-5588-current'? Use list_entitlements to search.",
            "field_path": "current_entitlement_id",
            "trace_id": "trc-404-2026-05-21-16-22-aa"
        }
    }))
    msgs.append(assistant(
        "Maaf Encik, **HTTP 404 Not Found** — entitlement ID `ent-abc-5588-curr` tidak ditemui:\n\n"
        "- Sistem cadang: mungkin `ent-abc-5588-current`?\n"
        "- **Trace ID:** `trc-404-2026-05-21-16-22-aa`\n\n"
        "Saya cadang `list_entitlements` untuk cari ID sebenar. Boleh saya search?"
    ))
    msgs.append(user(
        "Ya search. Mungkin saya silap tail ID."
    ))
    msgs.append(assistant_tool(
        "Baik.",
        [("call-89-002", "list_entitlements", {
            "filters": {"customer_id": "cust-abc-5588", "status_in": ["active"]},
            "page_size": 10,
            "sort_by": "created_at",
            "sort_direction": "desc"
        })]
    ))
    msgs.append(tool("call-89-002", "list_entitlements", {
        "data": [
            {"entitlement_id": "ent-abc-5588-current", "product_code": "SD-WAN-ENT-PRO", "status": "active", "site_count": 24, "term_remaining_months": 8},
            {"entitlement_id": "ent-abc-5588-legacy", "product_code": "SD-WAN-ENT-STD", "status": "active", "site_count": 4, "term_remaining_months": 2}
        ],
        "pagination": {"has_next_page": False, "total_count": 2}
    }))
    msgs.append(assistant(
        "2 entitlement aktif ditemui, Encik:\n\n"
        "1. `ent-abc-5588-current` — SD-WAN-ENT-PRO, 24 sites, term remaining 8m\n"
        "2. `ent-abc-5588-legacy` — SD-WAN-ENT-STD, 4 sites, term remaining 2m\n\n"
        "Encik silap satu huruf tadi — `-curr` sepatutnya `-current`. Saya retry eligibility check dengan ID betul?"
    ))
    msgs.append(user(
        "Ya retry. Maaf, typo tadi."
    ))
    msgs.append(assistant_tool(
        "Tiada masalah Encik.",
        [("call-89-003", "check_customer_entitlement_eligibility", {
            "customer_id": "cust-abc-5588",
            "requested_change": {
                "change_type": "add_sites",
                "additional_sites_count": 8,
                "additional_term_months": 12
            },
            "current_entitlement_id": "ent-abc-5588-current"
        })]
    ))
    msgs.append(tool("call-89-003", "check_customer_entitlement_eligibility", {
        "is_eligible": True,
        "eligibility_id": "elig-abc-bb02",
        "valid_until": "2026-06-21T16:23:00+08:00",
        "_warning": "quota_remaining_today: 9 of 80 eligibility checks."
    }))
    msgs.append(assistant(
        "Eligible, Encik:\n\n"
        "- **eligibility_id:** `elig-abc-bb02` (sah sehingga 21 Jun)\n"
        "- Amaran kuota proaktif: 9 daripada 80 eligibility checks tinggal hari ini.\n\n"
        "Adakah Encik mahu saya tarik butiran entitlement semasa supaya kita ada baseline sebelum buat plan perubahan?"
    ))
    msgs.append(user(
        "Ya, tarik butiran."
    ))
    msgs.append(assistant_tool(
        "Baik.",
        [("call-89-004", "get_entitlement_details", {
            "entitlement_id": "ent-abc-5588-current",
            "include_usage_summary": True
        })]
    ))
    msgs.append(tool("call-89-004", "get_entitlement_details", {
        "entitlement_id": "ent-abc-5588-current",
        "product_code": "SD-WAN-ENT-PRO",
        "status": "active",
        "site_count": 24,
        "site_license_quota": 30,
        "license_used": 24,
        "license_available": 6,
        "term_start": "2025-09-21T00:00:00+08:00",
        "term_end": "2026-01-21T23:59:59+08:00",
        "term_remaining_months": 8,
        "auto_renew": True
    }))
    msgs.append(assistant(
        "Butiran entitlement, Encik:\n\n"
        "- 24 site digunakan; **6 license slot tersedia** | quota 30\n"
        "- Term remaining 8 bulan | auto-renew aktif\n\n"
        "Encik nak tambah 8 site tetapi hanya **6 slot tersedia** — kita perlu quota uplift untuk 2 site tambahan. "
        "Adakah Encik nak saya plan entitlement change dengan quota uplift?"
    ))
    msgs.append(user(
        "Ya, plan dengan quota uplift +5 (buffer untuk masa depan). Term tambahan 12 bulan."
    ))
    msgs.append(assistant_tool(
        "Baik.",
        [("call-89-005", "plan_entitlement_change", {
            "entitlement_id": "ent-abc-5588-current",
            "change_inputs": {
                "site_quota_delta": 5,
                "additional_sites_to_activate": 8,
                "term_extension_months": 12
            },
            "eligibility_ref": "elig-abc-bb02"
        })]
    ))
    msgs.append(tool("call-89-005", "plan_entitlement_change", {
        "change_plan_id": "chgpl-abc-cc03",
        "summary": {
            "new_site_quota": 35,
            "new_term_end": "2027-01-21T23:59:59+08:00",
            "estimated_recurring_charge_uplift_myr": 4800,
            "estimated_one_time_charge_myr": 1200
        },
        "status": "planned"
    }))
    msgs.append(assistant(
        "Pelan perubahan siap:\n\n"
        "- **change_plan_id:** `chgpl-abc-cc03`\n"
        "- Quota baru: 35 sites (was 30) | Term end baru: Jan 2027\n"
        "- Anggaran charge: MRC +RM 4,800/bulan | NRC RM 1,200\n\n"
        "Adakah Encik mahu saya validate quota sebelum aktifkan?"
    ))
    msgs.append(user(
        "Ya, validate."
    ))
    msgs.append(assistant_tool(
        "Baik.",
        [("call-89-006", "validate_entitlement_quota", {
            "change_plan_id": "chgpl-abc-cc03",
            "validation_focus": ["regional_license_pool", "carrier_capacity"]
        })]
    ))
    msgs.append(tool("call-89-006", "validate_entitlement_quota", {
        "validation_id": "val-abc-dd04",
        "status": "pass_with_warnings",
        "checks": [
            {"check": "regional_license_pool", "status": "pass", "available_after_uplift": 47},
            {"check": "carrier_capacity", "status": "warning", "detail": "Carrier TM-Wholesale shows 2 sites in queue for activation at Penang region; expect 24-48h ETA."}
        ]
    }))
    msgs.append(assistant(
        "Validation pass dengan amaran:\n\n"
        "- Regional license pool: PASS (47 license tinggal selepas uplift)\n"
        "- ⚠️ Carrier TM-Wholesale: 2 site di Penang dalam queue 24-48h\n\n"
        "Sebelum activation batch, izinkan saya jelaskan blast radius:\n\n"
        "1. 8 site baru akan diaktifkan; 2 daripadanya (Penang) mungkin delayed 24-48h\n"
        "2. Quota uplift +5 — bil bulanan akan naik +RM 4,800 mulai siklus akan datang\n"
        "3. Term diperpanjang 12 bulan — auto-renew kekal aktif\n"
        "4. Tindakan boleh dirollback dengan `cancel_or_rollback_entitlement_change`\n\n"
        "Setuju untuk activate batch?"
    ))
    msgs.append(user(
        "Setuju. Activate batch."
    ))
    msgs.append(assistant_tool(
        "Baik.",
        [("call-89-007", "activate_entitlement_batch", {
            "change_plan_id": "chgpl-abc-cc03",
            "activation_mode": "phased",
            "phase_size": 4,
            "requested_by": {"user_id": "usr-khairul-ent-066"}
        })]
    ))
    msgs.append(tool("call-89-007", "activate_entitlement_batch", {
        "http_status": 202,
        "activation_batch_id": "actb-abc-ee05",
        "status": "in_progress",
        "estimated_completion_minutes": 30,
        "polling_url": "/batches/actb-abc-ee05/status",
        "webhook_supported": True
    }))
    msgs.append(assistant(
        "Batch activation accepted (**HTTP 202**):\n\n"
        "- **activation_batch_id:** `actb-abc-ee05`\n"
        "- Mode: phased (4 site per phase)\n"
        "- ETA: 30 minit\n\n"
        "Saya cadang subscribe events untuk Encik dan customer NOC. Setuju?"
    ))
    msgs.append(user(
        "Ya, subscribe. E-mel saya khairul.anwar@maxis.com.my dan customer abc-noc@abclogistics.com.my."
    ))
    msgs.append(assistant_tool(
        "Baik.",
        [("call-89-008", "entitlement_subscribe_to_events", {
            "scope": {"activation_batch_id": "actb-abc-ee05"},
            "subscribers": [
                {"channel": "email", "address": "khairul.anwar@maxis.com.my", "locale": "ms-MY"},
                {"channel": "email", "address": "abc-noc@abclogistics.com.my", "locale": "en-MY"}
            ],
            "events": ["batch.phase_completed", "batch.completed", "batch.failed", "site.activated"]
        })]
    ))
    msgs.append(tool("call-89-008", "entitlement_subscribe_to_events", {
        "subscription_id": "subs-ent-ff06",
        "subscribers_confirmed": 2,
        "status": "active"
    }))
    msgs.append(assistant(
        "Subscription aktif (`subs-ent-ff06`), 2 subscribers disahkan.\n\n"
        "Sambil tunggu activation, ada apa Encik nak saya bantu?"
    ))
    msgs.append(user(
        "Eh tanya luar topik — kalau saya nak claim e-hailing balik dari pejabat malam ni sebab masuk lewat, "
        "saya isi di sistem mana? Saya baru pindah ke Subang Jaya office."
    ))
    msgs.append(assistant(
        "Maaf Encik Khairul, tuntutan e-hailing adalah di luar skop khidmat entitlement saya. Untuk hal tersebut:\n\n"
        "- Sila guna **WorkdayMy** (modul Expenses → Transport) atau e-mel finance-claims@maxis.com.my untuk panduan baru.\n\n"
        "Kembali kepada operasi — adakah Encik mahu saya semak status batch sekarang?"
    ))
    msgs.append(user(
        "Ya semak."
    ))
    msgs.append(assistant_tool(
        "Baik.",
        [("call-89-009", "get_activation_batch_status", {
            "activation_batch_id": "actb-abc-ee05"
        })]
    ))
    msgs.append(tool("call-89-009", "get_activation_batch_status", {
        "activation_batch_id": "actb-abc-ee05",
        "status": "in_progress",
        "progress_pct": 50,
        "phases_completed": 1,
        "phases_total": 2,
        "results": {
            "sites_activated": 4,
            "sites_pending": 2,
            "sites_failed": 2
        },
        "failed_site_details": [
            {"site_id": "site-abc-jhr-018", "reason": "carrier_capacity_constraint_TM-Wholesale_JB"},
            {"site_id": "site-abc-jhr-019", "reason": "carrier_capacity_constraint_TM-Wholesale_JB"}
        ]
    }))
    msgs.append(assistant(
        "Status partial-success, Encik:\n\n"
        "- Status: in_progress (50%)\n"
        "- ✅ 4 site activated | ⏳ 2 pending | ❌ **2 failed** (Johor, carrier capacity)\n\n"
        "Failed sites adalah constraint TM-Wholesale JB. Saya cadang retry secara berasingan untuk 2 site Johor selepas carrier release capacity. "
        "Encik nak retry sekarang atau hold dulu?"
    ))
    msgs.append(user(
        "Retry. Saya tak nak tinggal pending."
    ))
    msgs.append(assistant_tool(
        "Baik.",
        [("call-89-010", "retry_failed_entitlement_operation", {
            "activation_batch_id": "actb-abc-ee05",
            "operation_type": "site_activation",
            "scope": {"site_ids": ["site-abc-jhr-018", "site-abc-jhr-019"]},
            "retry_strategy": "exponential_backoff",
            "max_retries": 3
        })]
    ))
    msgs.append(tool("call-89-010", "retry_failed_entitlement_operation", {
        "retry_id": "rty-ent-gg07",
        "status": "scheduled",
        "next_attempt_at": "2026-05-21T16:55:00+08:00"
    }))
    msgs.append(assistant(
        "Retry dijadualkan (`rty-ent-gg07`), attempt seterusnya 16:55 MYT dengan exponential backoff. "
        "Adakah Encik mahu saya pull audit log sementara menunggu?"
    ))
    msgs.append(user(
        "Ya pull. Saya nak rekod untuk handover shift malam."
    ))
    msgs.append(assistant_tool(
        "Baik.",
        [("call-89-011", "entitlement_get_audit_log", {
            "scope": {"entitlement_id": "ent-abc-5588-current"},
            "time_range": {"from": "2026-05-21T16:00:00+08:00", "to": "2026-05-21T16:55:00+08:00"},
            "include_system_actors": True,
            "limit": 20
        })]
    ))
    msgs.append(tool("call-89-011", "entitlement_get_audit_log", {
        "entries": [
            {"timestamp": "2026-05-21T16:22:00+08:00", "actor": {"id": "usr-khairul-ent-066", "name": "***REDACTED-PII***"}, "action": "eligibility_check_attempt", "result": "not_found_404"},
            {"timestamp": "2026-05-21T16:23:00+08:00", "actor": {"id": "usr-khairul-ent-066"}, "action": "eligibility_check_attempt", "result": "ok"},
            {"timestamp": "2026-05-21T16:25:00+08:00", "actor": {"id": "usr-khairul-ent-066"}, "action": "change_plan_created", "change_plan_id": "chgpl-abc-cc03"},
            {"timestamp": "2026-05-21T16:27:00+08:00", "actor": {"id": "usr-khairul-ent-066"}, "action": "activation_batch_started", "batch_id": "actb-abc-ee05"},
            {"timestamp": "2026-05-21T16:50:00+08:00", "actor": {"id": "system:carrier_adapter"}, "action": "phase_1_completed", "sites_activated": 4},
            {"timestamp": "2026-05-21T16:52:00+08:00", "actor": {"id": "system:carrier_adapter"}, "action": "phase_2_partial_failure", "sites_failed": 2},
            {"timestamp": "2026-05-21T16:53:00+08:00", "actor": {"id": "usr-khairul-ent-066"}, "action": "retry_scheduled", "retry_id": "rty-ent-gg07"}
        ],
        "total_entries": 7
    }))
    msgs.append(assistant(
        "Audit log lengkap (7 entries), Encik — semua tindakan dari typo awal 16:22 sampai retry scheduled 16:53 logged dengan betul. "
        "Nama Encik dipaparkan sebagai `***REDACTED-PII***` (mod query normal)."
    ))
    msgs.append(user(
        "Bagus. Eh lagi satu soalan luar topik — kafe Subang Jaya tower 7 buka sampai jam berapa malam ni? Saya nak supper."
    ))
    msgs.append(assistant(
        "Maaf Encik Khairul, jadual kafe pejabat adalah di luar skop khidmat entitlement saya. Untuk hal tersebut:\n\n"
        "- Sila tanya **front desk Tower 7** atau guna intranet **FacilitiesMy**.\n\n"
        "Kembali kepada operasi — adakah ada apa-apa lagi sebelum saya tutup sesi?"
    ))
    msgs.append(user(
        "Last — KPI metrics untuk customer ni sebulan lepas, supaya saya boleh attach ke handover note."
    ))
    msgs.append(assistant_tool(
        "Baik.",
        [("call-89-012", "entitlement_get_kpi_metrics", {
            "scope": {"customer_id": "cust-abc-5588"},
            "metric_set": "monthly_summary",
            "time_range": {"from": "2026-04-21T00:00:00+08:00", "to": "2026-05-21T16:55:00+08:00"}
        })]
    ))
    msgs.append(tool("call-89-012", "entitlement_get_kpi_metrics", {
        "kpis": {
            "site_count": 28,
            "site_utilization_pct": 93,
            "license_used": 28,
            "license_quota": 30,
            "license_headroom": 2,
            "activations_30d": 4,
            "deactivations_30d": 0,
            "failed_activations_30d": 2
        },
        "note": "After current batch completes, site_count will reach 32; license_quota will be 35."
    }))
    msgs.append(assistant(
        "KPI bulanan customer ABC Logistics:\n\n"
        "- Site count: 28 (utilization 93%) | License headroom: 2\n"
        "- Activations 30d: 4 | Failed: 2\n"
        "- Selepas batch hari ini siap: 32 sites, quota 35.\n\n"
        "Adakah ada apa-apa lagi Encik?"
    ))
    msgs.append(user(
        "Cukup. Terima kasih atas handle 404 typo correction, 202 async batch, dan partial-failure recovery. "
        "Saya tunggu webhook untuk retry hasil. Selamat petang."
    ))
    msgs.append(assistant(
        "Sama-sama Encik Khairul Anwar. Terima kasih atas kesabaran. Hari ini kita handle 404 not found (diselesaikan dengan "
        "list_entitlements + correct ID), 202 async batch activation, partial-failure recovery untuk 2 site Johor, "
        "dan amaran kuota proaktif. Selamat petang dan handover shift malam yang berjaya."
    ))

    meta = build_metadata(I, "malay", 14,
        [
            {"http_status": 404, "service": "eligibility-api", "kind": "not_found_typo", "recovered": True, "via": "list-entitlements-then-retry-with-correct-id"},
            {"http_status": 202, "service": "activation-api", "kind": "async_batch", "recovered": True, "via": "webhook-subscription"},
            {"http_status": 200, "service": "batch-status-api", "kind": "partial_success_with_failures", "recovered": True, "via": "retry-failed-entitlement-operation"},
            {"http_status": 200, "service": "eligibility-api", "kind": "quota_warning", "recovered": True, "via": "agent-flags-low-quota"},
            {"http_status": 200, "service": "audit-api", "kind": "pii_redaction", "recovered": True, "via": "agent-explains-redaction"}
        ],
        [
            {"turn": 10, "topic": "e-hailing reimbursement late shift"},
            {"turn": 13, "topic": "office cafe hours Tower 7"}
        ],
        [
            "self_correction_after_404_typo",
            "verification_before_batch_activation",
            "proactive_quota_warning",
            "partial_failure_recovery_via_retry",
            "explains_pii_redaction"
        ],
        [
            "check_customer_entitlement_eligibility", "list_entitlements",
            "get_entitlement_details", "plan_entitlement_change",
            "validate_entitlement_quota", "activate_entitlement_batch",
            "entitlement_subscribe_to_events", "get_activation_batch_status",
            "retry_failed_entitlement_operation", "entitlement_get_audit_log",
            "entitlement_get_kpi_metrics"
        ],
        "Malay-leading Encik Khairul Anwar (entitlement admin); Bahasa primary; formal agent."
    )
    return I, msgs, meta


if __name__ == '__main__':
    for builder in [build_85, build_86, build_87, build_88, build_89]:
        I, msgs, meta = builder()
        out = {
            "conversation_id": f"myl-fnlib-extra-{I}",
            "workflow_name": meta['workflow_name'],
            "domain": meta['domain'],
            "messages": msgs,
            "metadata": meta['metadata']
        }
        out['metadata']['turn_details'] = [
            {"turn": i+1, "intent": "auto-derived", "expected_functions": [], "complexity": "moderate"}
            for i in range(meta['metadata']['num_turns'])
        ]
        path = save(I, out)
        print('WROTE', path)
