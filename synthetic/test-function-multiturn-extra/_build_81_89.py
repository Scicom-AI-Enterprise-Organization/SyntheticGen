#!/usr/bin/env python3
"""Build conversations 81..89 for multiturn-extra.

Language rotation across 81..89:
  81: malay
  82: english
  83: tamil
  84: malay
  85: mandarin
  86: malay
  87: english
  88: tamil
  89: malay
"""
import sys, os, json
sys.path.insert(0, os.path.dirname(__file__))
from _gen import js, assistant, assistant_tool, user, tool, save

OUT_DIR = '/home/husein/ssd3/SyntheticGen/synthetic/test-function-multiturn-extra'
LIB_DIR = '/home/husein/ssd3/SyntheticGen/synthetic/test-function'


def build_metadata(idx, language_profile, num_turns, api_errors, ooc, edges, fns_used, narrative):
    lib = json.load(open(f'{LIB_DIR}/{idx}.json'))
    return {
        "conversation_id": f"myl-fnlib-extra-{idx}",
        "workflow_name": lib['workflow_name'],
        "domain": lib['domain'],
        "messages": None,  # filled in by caller
        "metadata": {
            "num_turns": num_turns,
            "language_profile": language_profile,
            "api_errors_simulated": api_errors,
            "out_of_context_turns": ooc,
            "agent_edges_demonstrated": edges,
            "functions_used": fns_used,
            "language_style": narrative,
            "generated_at": "2026-05-21T15:00:00+08:00",
            "turn_details": []
        }
    }


# ---------------------------------------------------------------------------
# 81 - subscriber_lifecycle UC (Malay-leading)
# ---------------------------------------------------------------------------
def build_81():
    I = 81
    msgs = []

    msgs.append(user(
        "Selamat pagi. Saya Puan Aishah Rahman, B2B account ops Maxis Enterprise, Cyberjaya. "
        "Hari ni saya nak start lifecycle untuk satu corporate customer baru — Sime Darby Plantation. "
        "Mereka nak 350 UC seats (200 KL HQ, 100 Carey Island, 50 Sandakan). Boleh tolong check eligibility dulu?"
    ))
    msgs.append(assistant_tool(
        "Selamat pagi Puan Aishah. Baik, saya semak kelayakan UC untuk Sime Darby Plantation sekarang.",
        [("call-81-001", "check_uc_service_eligibility", {
            "customer_id": "cust-sdpl-9912",
            "requested_service": {
                "product_code": "UC_ENTERPRISE_PRO",
                "seats_count": 350,
                "sites": [
                    {"site_id": "site-sdpl-kl-hq", "city": "Kuala Lumpur", "seat_count": 200},
                    {"site_id": "site-sdpl-cary", "city": "Carey Island", "seat_count": 100},
                    {"site_id": "site-sdpl-sdk", "city": "Sandakan", "seat_count": 50}
                ]
            },
            "requested_by": {"user_id": "usr-aishah-b2bops-021", "role": "b2b_account_ops"}
        })]
    ))
    msgs.append(tool("call-81-001", "check_uc_service_eligibility", {
        "error": {
            "http_status": 400,
            "code": "validation_error",
            "message": "Field requested_service.sites[2].city='Sandakan' resolves to coverage_zone='Sabah-East'. UC_ENTERPRISE_PRO eligibility for Sabah-East requires explicit feature flag 'sabah_east_enabled' in payload. Add or split site to a separate request.",
            "field_path": "requested_service.sites[2]",
            "trace_id": "trc-400-2026-05-21-09-12-aa"
        }
    }))
    msgs.append(assistant(
        "Maaf Puan, API tolak permintaan dengan **HTTP 400 Validation Error**:\n\n"
        "- **Masalah:** Site Sandakan tergolong dalam zone `Sabah-East` yang memerlukan feature flag `sabah_east_enabled` "
        "untuk product UC_ENTERPRISE_PRO.\n"
        "- **Trace ID:** `trc-400-2026-05-21-09-12-aa`\n\n"
        "Saya boleh ulang permintaan dengan feature flag diaktifkan. Adakah Puan sahkan customer ini ada hak Sabah-East "
        "dalam kontrak induk?"
    ))
    msgs.append(user(
        "Ya, dalam MSA mereka memang ada Sabah-East coverage. Set flag, retry. Cepat sikit, pre-sales meeting jam 11 pagi."
    ))
    msgs.append(assistant_tool(
        "Baik Puan, retry dengan feature flag.",
        [("call-81-002", "check_uc_service_eligibility", {
            "customer_id": "cust-sdpl-9912",
            "requested_service": {
                "product_code": "UC_ENTERPRISE_PRO",
                "seats_count": 350,
                "sites": [
                    {"site_id": "site-sdpl-kl-hq", "city": "Kuala Lumpur", "seat_count": 200},
                    {"site_id": "site-sdpl-cary", "city": "Carey Island", "seat_count": 100},
                    {"site_id": "site-sdpl-sdk", "city": "Sandakan", "seat_count": 50}
                ],
                "feature_flags": ["sabah_east_enabled"]
            },
            "requested_by": {"user_id": "usr-aishah-b2bops-021", "role": "b2b_account_ops"}
        })]
    ))
    msgs.append(tool("call-81-002", "check_uc_service_eligibility", {
        "eligibility_id": "elig-sdpl-9912-aa11",
        "is_eligible": True,
        "matched_offering": "UC_ENTERPRISE_PRO_v4",
        "site_coverage": [
            {"site_id": "site-sdpl-kl-hq", "coverage": "full"},
            {"site_id": "site-sdpl-cary", "coverage": "full"},
            {"site_id": "site-sdpl-sdk", "coverage": "limited_high_latency"}
        ],
        "valid_until": "2026-06-21T09:13:00+08:00",
        "_warning": "quota_remaining_today: 7 of 50 eligibility checks. Plan additional checks carefully."
    }))
    msgs.append(assistant(
        "Berjaya, Puan. Status:\n\n"
        "- **eligibility_id:** `elig-sdpl-9912-aa11` (sah sehingga 21 Jun 2026)\n"
        "- 3 site lulus; Sandakan mempunyai status `limited_high_latency` — sila ambil tahu kemungkinan latensi tambahan.\n"
        "- Amaran kuota proaktif: hanya **7 daripada 50** eligibility checks tinggal hari ini.\n\n"
        "Adakah Puan mahu saya teruskan dengan jana quote?"
    ))
    msgs.append(user(
        "Ya, jana quote. Term 24 bulan, billing monthly, currency MYR. Discount band sub-band-B (negotiated 12%)."
    ))
    msgs.append(assistant_tool(
        "Baik, saya jana quote sekarang.",
        [("call-81-003", "create_uc_subscription_quote", {
            "eligibility_id": "elig-sdpl-9912-aa11",
            "customer_id": "cust-sdpl-9912",
            "term_months": 24,
            "billing_frequency": "monthly",
            "currency": "MYR",
            "discount_band": "sub-band-B",
            "requested_by": {"user_id": "usr-aishah-b2bops-021", "role": "b2b_account_ops"}
        })]
    ))
    msgs.append(tool("call-81-003", "create_uc_subscription_quote", {
        "quote_id": "quo-sdpl-9912-bb22",
        "status": "draft",
        "total_mrc": {"amount": 91245.00, "currency": "MYR"},
        "total_nrc": {"amount": 12500.00, "currency": "MYR"},
        "term_months": 24,
        "discount_applied_pct": 12,
        "expires_at": "2026-06-04T09:14:00+08:00"
    }))
    msgs.append(assistant(
        "Quote berjaya dijana, Puan:\n\n"
        "- **quote_id:** `quo-sdpl-9912-bb22`\n"
        "- **MRC:** RM 91,245/bulan | **NRC:** RM 12,500\n"
        "- **Tempoh:** 24 bulan | **Diskaun:** 12% (sub-band-B)\n"
        "- Tamat tempoh quote: 4 Jun 2026"
    ))
    msgs.append(user(
        "Sebelum convert ke order, kebimbangan saya tentang Sandakan limited latency tu — saya nak simulate dulu "
        "impact provisioning side. Boleh dry-run dulu? Saya tak nak surprise."
    ))
    msgs.append(assistant_tool(
        "Idea yang bijak Puan — simulate operation membenarkan kita lihat impact sebelum komit.",
        [("call-81-004", "uc_subscription_simulate_operation", {
            "operation_type": "provision_subscribers",
            "quote_id": "quo-sdpl-9912-bb22",
            "what_if_inputs": {
                "site_focus": ["site-sdpl-sdk"],
                "simulate_latency_impact": True,
                "concurrency_assumption": 50
            },
            "output_options": {"include_risk_score": True, "include_estimated_duration": True}
        })]
    ))
    msgs.append(tool("call-81-004", "uc_subscription_simulate_operation", {
        "simulation_id": "sim-sdpl-9912-cc33",
        "operation_type": "provision_subscribers",
        "risk_score": 0.42,
        "risk_band": "medium",
        "key_findings": [
            {"site_id": "site-sdpl-sdk", "issue": "median_provisioning_latency_seconds estimated 38s (vs 12s baseline)"},
            {"site_id": "site-sdpl-sdk", "issue": "regional registrar capacity at 78% — peak provisioning may queue"}
        ],
        "estimated_duration_minutes": 42,
        "recommended_mitigation": "schedule_provisioning_window_offpeak_midnight_my"
    }))
    msgs.append(assistant(
        "Simulasi siap, Puan:\n\n"
        "- **risk_score:** 0.42 (medium)\n"
        "- **Anggaran tempoh:** 42 minit\n"
        "- **Penemuan:** Latensi median Sandakan ~38 saat (vs baseline 12s); kapasiti registrar serantau pada 78%.\n"
        "- **Cadangan:** Jalankan provisioning di luar waktu puncak (tengah malam MYT).\n\n"
        "Saya cadangkan jadualkan provisioning Sandakan secara berasingan untuk slot midnight. Setuju?"
    ))
    msgs.append(user(
        "Setuju. Convert quote ke order dulu, kemudian schedule recurring job untuk Sandakan jam 12 tengah malam."
    ))
    msgs.append(assistant_tool(
        "Baik Puan, saya convert quote dan schedule job secara selari.",
        [
            ("call-81-005", "create_subscription_order_from_quote", {
                "quote_id": "quo-sdpl-9912-bb22",
                "customer_po_number": "SDPL-PO-2026-0517",
                "requested_by": {"user_id": "usr-aishah-b2bops-021", "role": "b2b_account_ops"}
            }),
            ("call-81-006", "uc_subscription_schedule_recurring_job", {
                "job_type": "provision_subscribers",
                "schedule_expression": "0 0 22 * * ?",
                "timezone": "Asia/Kuala_Lumpur",
                "job_payload": {
                    "site_id": "site-sdpl-sdk",
                    "concurrency": 25,
                    "quote_id": "quo-sdpl-9912-bb22"
                },
                "starts_at": "2026-05-21T23:59:00+08:00",
                "max_runs": 1
            })
        ]
    ))
    msgs.append(tool("call-81-005", "create_subscription_order_from_quote", {
        "order_id": "ord-sdpl-9912-dd44",
        "status": "accepted",
        "quote_id": "quo-sdpl-9912-bb22",
        "created_at": "2026-05-21T09:18:33+08:00"
    }))
    msgs.append(tool("call-81-006", "uc_subscription_schedule_recurring_job", {
        "scheduled_job_id": "sjob-sdpl-sdk-ee55",
        "schedule_expression": "0 0 22 * * ?",
        "next_run_at": "2026-05-21T22:00:00+08:00",
        "status": "scheduled"
    }))
    msgs.append(assistant(
        "Kedua-dua siap, Puan:\n\n"
        "- **order_id:** `ord-sdpl-9912-dd44` (status accepted)\n"
        "- **scheduled_job_id:** `sjob-sdpl-sdk-ee55` — run pertama jam 22:00 MYT malam ini\n\n"
        "Adakah Puan mahu saya mulakan provisioning untuk 2 site lain (KL HQ + Carey Island) sekarang?"
    ))
    msgs.append(user(
        "Ya, provision KL HQ dan Carey Island sekarang. Concurrency standard, contact admin Cik Nurul Hasanah."
    ))
    msgs.append(assistant_tool(
        "Baik.",
        [("call-81-007", "provision_subscribers", {
            "order_id": "ord-sdpl-9912-dd44",
            "site_scope": ["site-sdpl-kl-hq", "site-sdpl-cary"],
            "concurrency": 50,
            "admin_contact": {"name": "Nurul Hasanah", "email": "nurul.hasanah@simedarby.com.my"},
            "requested_by": {"user_id": "usr-aishah-b2bops-021", "role": "b2b_account_ops"}
        })]
    ))
    msgs.append(tool("call-81-007", "provision_subscribers", {
        "error": {
            "http_status": 503,
            "code": "service_unavailable",
            "message": "UC provisioning service is currently in scheduled maintenance window (window-2026-05-21-am). Estimated restoration: 2026-05-21T09:35:00+08:00.",
            "incident_id": "inc-maint-2026-05-21-uc-prov",
            "retry_after_seconds": 900,
            "trace_id": "trc-503-2026-05-21-09-19-bb"
        }
    }))
    msgs.append(assistant(
        "Mohon maaf Puan, UC provisioning service sedang dalam **maintenance window** (HTTP 503):\n\n"
        "- **incident_id:** `inc-maint-2026-05-21-uc-prov`\n"
        "- Anggaran pulih: 09:35 MYT (15 minit lagi)\n\n"
        "Sebagai langkah alternatif, saya cadang **subscribe events** dulu supaya notifikasi automatik bila service pulih, "
        "dan saya retry sebaik sahaja. Atau kita boleh tunggu manual. Apa Puan pilih?"
    ))
    msgs.append(user(
        "Subscribe events. E-mel saya aishah.rahman@maxis.com.my. Sat sat, telefon CFO masuk... [pause] OK done. Sambung."
    ))
    msgs.append(assistant_tool(
        "Saya tunggu Puan tadi. Subscribe sekarang.",
        [("call-81-008", "uc_subscription_subscribe_to_events", {
            "subscription_scope": {"order_id": "ord-sdpl-9912-dd44"},
            "subscribers": [
                {"channel": "email", "address": "aishah.rahman@maxis.com.my", "locale": "ms-MY"}
            ],
            "events": ["provision.started", "provision.completed", "provision.failed", "service.restored"],
            "delivery_options": {"retry_on_failure": True, "include_summary_pdf": True}
        })]
    ))
    msgs.append(tool("call-81-008", "uc_subscription_subscribe_to_events", {
        "subscription_id": "subs-evt-sdpl-ff66",
        "subscribers_confirmed": 1,
        "events": ["provision.started", "provision.completed", "provision.failed", "service.restored"],
        "status": "active",
        "first_delivery_eta": "2026-05-21T09:35:00+08:00"
    }))
    msgs.append(assistant(
        "Subscription aktif, Puan:\n\n"
        "- **subscription_id:** `subs-evt-sdpl-ff66`\n"
        "- 4 jenis event akan dihantar ke aishah.rahman@maxis.com.my\n\n"
        "Sambil tunggu maintenance window, ada apa Puan nak saya bantu?"
    ))
    msgs.append(user(
        "Eh, tanya luar topik sikit — anak buah saya nak intern Maxis Enterprise, jurusan telekomunikasi UTM tahun 3. "
        "Bila next intake intern dan camne apply?"
    ))
    msgs.append(assistant(
        "Maaf Puan Aishah, urusan rekrutmen dan internship adalah di luar skop khidmat UC subscription saya. "
        "Untuk pertanyaan tersebut, sila rujuk:\n\n"
        "- Portal kerjaya rasmi: careers.maxis.com.my (bahagian *Internship*)\n"
        "- E-mel HR talent acquisition: talent@maxis.com.my\n\n"
        "Kembali kepada operasi — semasa tunggu service pulih, saya boleh paparkan KPI dashboard semasa atau "
        "tarik audit log eligibility check tadi. Apa Puan suka?"
    ))
    msgs.append(user(
        "OK terima kasih. Tarik audit log dulu, saya nak verify mana yang kena log betul untuk sebab compliance audit nanti."
    ))
    msgs.append(assistant_tool(
        "Baik.",
        [("call-81-009", "uc_subscription_get_audit_log", {
            "scope": {"customer_id": "cust-sdpl-9912"},
            "time_range": {"from": "2026-05-21T09:00:00+08:00", "to": "2026-05-21T09:25:00+08:00"},
            "include_system_actors": True,
            "limit": 20
        })]
    ))
    msgs.append(tool("call-81-009", "uc_subscription_get_audit_log", {
        "entries": [
            {"timestamp": "2026-05-21T09:12:00+08:00", "actor": {"id": "usr-aishah-b2bops-021", "type": "user", "name": "***REDACTED-PII***"}, "action": "eligibility_check_attempt", "result": "validation_error_400"},
            {"timestamp": "2026-05-21T09:13:00+08:00", "actor": {"id": "usr-aishah-b2bops-021", "type": "user", "name": "***REDACTED-PII***"}, "action": "eligibility_check_attempt", "result": "ok"},
            {"timestamp": "2026-05-21T09:14:00+08:00", "actor": {"id": "usr-aishah-b2bops-021", "type": "user"}, "action": "quote_created", "quote_id": "quo-sdpl-9912-bb22"},
            {"timestamp": "2026-05-21T09:18:33+08:00", "actor": {"id": "usr-aishah-b2bops-021", "type": "user"}, "action": "order_created", "order_id": "ord-sdpl-9912-dd44"},
            {"timestamp": "2026-05-21T09:19:00+08:00", "actor": {"id": "system:provisioner", "type": "system"}, "action": "provisioning_attempt", "result": "service_unavailable_503"}
        ],
        "total_entries": 5,
        "pagination": {"has_next_page": False}
    }))
    msgs.append(assistant(
        "Audit log lengkap (5 entries), Puan — semuanya logged dengan betul:\n\n"
        "1. 09:12 — eligibility check pertama (gagal 400)\n"
        "2. 09:13 — eligibility check kedua (lulus)\n"
        "3. 09:14 — quote created (`quo-sdpl-9912-bb22`)\n"
        "4. 09:18:33 — order created (`ord-sdpl-9912-dd44`)\n"
        "5. 09:19 — provisioning attempt (gagal 503 maintenance)\n\n"
        "(Nota: nama Puan dipaparkan sebagai `***REDACTED-PII***` kerana mod query — ini tingkah laku normal, bukan ralat.)"
    ))
    msgs.append(user(
        "Bagus. Eh sekejap, saya tertanya — kalau saya nak rollback order ni semua sekali, prosedur dia macam mana? "
        "Tak nak buat sekarang, just nak tahu blast radius."
    ))
    msgs.append(assistant(
        "Soalan baik untuk dirancang awal, Puan. Jika rollback dilakukan kemudian, kesan utama:\n\n"
        "1. **Padam** order `ord-sdpl-9912-dd44` (semua provisioning belum berlaku akan dibatalkan)\n"
        "2. Quote `quo-sdpl-9912-bb22` masih boleh diguna semula (tidak dipadam)\n"
        "3. Scheduled job Sandakan `sjob-sdpl-sdk-ee55` perlu dibatalkan secara berasingan\n"
        "4. Subscription events `subs-evt-sdpl-ff66` akan terus aktif sehingga dipadam manual\n"
        "5. **Audit trail dikekalkan** — semua tindakan tetap boleh diperiksa untuk compliance\n\n"
        "Untuk tindakan sebenar nanti, saya akan minta pengesahan eksplisit kerana ia adalah operasi destructive. "
        "Buat masa ini, tiada apa-apa akan saya ubah."
    ))
    msgs.append(user(
        "Faham, terima kasih atas penjelasan blast radius. Last sekali — sebelum saya tutup call, "
        "boleh check overall health status untuk customer ni? Saya nak laporan sikit untuk pre-sales meeting."
    ))
    msgs.append(assistant_tool(
        "Baik, saya tarik monitoring health + KPI metrics secara selari.",
        [
            ("call-81-010", "monitor_subscription_health", {
                "scope": {"customer_id": "cust-sdpl-9912"},
                "include_site_breakdown": True
            }),
            ("call-81-011", "uc_subscription_get_kpi_metrics", {
                "scope": {"customer_id": "cust-sdpl-9912"},
                "metric_set": "executive_summary",
                "time_range": {"from": "2026-05-21T00:00:00+08:00", "to": "2026-05-21T09:25:00+08:00"}
            })
        ]
    ))
    msgs.append(tool("call-81-010", "monitor_subscription_health", {
        "overall_health": "pending_provisioning",
        "site_health": [
            {"site_id": "site-sdpl-kl-hq", "status": "awaiting_provisioning"},
            {"site_id": "site-sdpl-cary", "status": "awaiting_provisioning"},
            {"site_id": "site-sdpl-sdk", "status": "scheduled_for_offpeak"}
        ],
        "open_alerts": 0,
        "as_of": "2026-05-21T09:24:50+08:00"
    }))
    msgs.append(tool("call-81-011", "uc_subscription_get_kpi_metrics", {
        "kpis": {
            "subscribers_active": 0,
            "subscribers_pending": 350,
            "subscribers_failed": 0,
            "first_contact_resolution_pct": None,
            "mttr_minutes_30d": None
        },
        "note": "customer is in onboarding phase; lifecycle KPIs will populate after first successful provisioning."
    }))
    msgs.append(assistant(
        "Ringkasan untuk pre-sales meeting Puan Aishah:\n\n"
        "**Health:** pending_provisioning (KL HQ + Carey awaiting; Sandakan scheduled midnight)\n"
        "**KPIs:** 350 pending subscribers, 0 active, 0 failed (customer dalam onboarding phase)\n"
        "**Open alerts:** 0\n\n"
        "Operasi saya yang masih tertunda:\n"
        "- Webhook akan trigger automatik bila maintenance pulih (~09:35)\n"
        "- Job Sandakan jalan jam 22:00 malam ini\n\n"
        "Adakah ada apa-apa lagi yang Puan perlukan sebelum tutup sesi?"
    ))
    msgs.append(user(
        "Cukup dulu, terima kasih banyak. Saya akan lapor balik kepada CFO sebelum 11 pagi. "
        "Kalau ada apa-apa fail kemudian, saya call balik. Selamat pagi."
    ))
    msgs.append(assistant(
        "Sama-sama Puan Aishah. Terima kasih atas kesabaran sepanjang panggilan ini, terutama dalam menangani siri ralat sistem hari ini "
        "(400 validation Sabah-East, 503 maintenance window provisioning, serta amaran kuota proaktif). "
        "Selamat menjalankan pre-sales meeting jam 11. Sila hubungi kami semula kemudian. Selamat pagi."
    ))

    meta = build_metadata(I, "malay", 14,
        [
            {"http_status": 400, "service": "eligibility-api", "kind": "validation_error", "recovered": True, "via": "add-feature-flag-and-retry"},
            {"http_status": 503, "service": "provisioning-api", "kind": "service_unavailable_maintenance", "recovered": True, "via": "subscribe-events-and-wait"},
            {"http_status": 200, "service": "eligibility-api", "kind": "quota_warning", "recovered": True, "via": "agent-flags-low-quota"},
            {"http_status": 200, "service": "audit-api", "kind": "pii_redaction", "recovered": True, "via": "agent-explains-redaction"}
        ],
        [
            {"turn": 11, "topic": "internship application for relative at Maxis HR"}
        ],
        [
            "proactive_quota_warning",
            "verification_before_destructive_explanation_of_blast_radius",
            "suggest_workaround_subscribe_events_during_maintenance",
            "explains_pii_redaction_as_normal_behaviour",
            "proactive_simulation_before_provisioning"
        ],
        [
            "check_uc_service_eligibility", "create_uc_subscription_quote",
            "uc_subscription_simulate_operation", "create_subscription_order_from_quote",
            "uc_subscription_schedule_recurring_job", "provision_subscribers",
            "uc_subscription_subscribe_to_events", "uc_subscription_get_audit_log",
            "monitor_subscription_health", "uc_subscription_get_kpi_metrics"
        ],
        "Malay-leading Puan Aishah (B2B account ops); Bahasa primary, English code-switch occasional; agent formal Bahasa with Encik/Puan."
    )
    # Need second OOC — adjust above to have 2 OOCs. Let me re-check.
    # I have only one OOC. Need to insert one more. Move "rollback blast radius" question? That isn't OOC.
    # Let me bend in a second one via the metadata — but text must have one. Re-edit by re-running build...
    return I, msgs, meta


# We need to insert a second OOC in conversation 81. Easier: I'll redo with two OOCs.

def build_81_v2():
    I = 81
    msgs = []

    msgs.append(user(
        "Selamat pagi. Saya Puan Aishah Rahman, B2B account ops Maxis Enterprise, Cyberjaya. "
        "Hari ni saya nak start lifecycle untuk satu corporate customer baru — Sime Darby Plantation. "
        "Mereka nak 350 UC seats (200 KL HQ, 100 Carey Island, 50 Sandakan). Boleh tolong check eligibility dulu?"
    ))
    msgs.append(assistant_tool(
        "Selamat pagi Puan Aishah. Baik, saya semak kelayakan UC untuk Sime Darby Plantation sekarang.",
        [("call-81-001", "check_uc_service_eligibility", {
            "customer_id": "cust-sdpl-9912",
            "requested_service": {
                "product_code": "UC_ENTERPRISE_PRO",
                "seats_count": 350,
                "sites": [
                    {"site_id": "site-sdpl-kl-hq", "city": "Kuala Lumpur", "seat_count": 200},
                    {"site_id": "site-sdpl-cary", "city": "Carey Island", "seat_count": 100},
                    {"site_id": "site-sdpl-sdk", "city": "Sandakan", "seat_count": 50}
                ]
            },
            "requested_by": {"user_id": "usr-aishah-b2bops-021", "role": "b2b_account_ops"}
        })]
    ))
    msgs.append(tool("call-81-001", "check_uc_service_eligibility", {
        "error": {
            "http_status": 400,
            "code": "validation_error",
            "message": "Field requested_service.sites[2].city='Sandakan' resolves to coverage_zone='Sabah-East'. UC_ENTERPRISE_PRO eligibility for Sabah-East requires explicit feature flag 'sabah_east_enabled' in payload.",
            "field_path": "requested_service.sites[2]",
            "trace_id": "trc-400-2026-05-21-09-12-aa"
        }
    }))
    msgs.append(assistant(
        "Maaf Puan, API tolak permintaan dengan **HTTP 400 Validation Error**:\n\n"
        "- **Masalah:** Site Sandakan tergolong dalam zone `Sabah-East` yang memerlukan feature flag `sabah_east_enabled`.\n"
        "- **Trace ID:** `trc-400-2026-05-21-09-12-aa`\n\n"
        "Saya boleh ulang permintaan dengan feature flag diaktifkan. Adakah Puan sahkan customer ini ada hak Sabah-East?"
    ))
    msgs.append(user(
        "Ya, dalam MSA mereka memang ada Sabah-East coverage. Set flag, retry. Cepat sikit, pre-sales meeting jam 11 pagi."
    ))
    msgs.append(assistant_tool(
        "Baik Puan, retry dengan feature flag.",
        [("call-81-002", "check_uc_service_eligibility", {
            "customer_id": "cust-sdpl-9912",
            "requested_service": {
                "product_code": "UC_ENTERPRISE_PRO",
                "seats_count": 350,
                "sites": [
                    {"site_id": "site-sdpl-kl-hq", "city": "Kuala Lumpur", "seat_count": 200},
                    {"site_id": "site-sdpl-cary", "city": "Carey Island", "seat_count": 100},
                    {"site_id": "site-sdpl-sdk", "city": "Sandakan", "seat_count": 50}
                ],
                "feature_flags": ["sabah_east_enabled"]
            },
            "requested_by": {"user_id": "usr-aishah-b2bops-021", "role": "b2b_account_ops"}
        })]
    ))
    msgs.append(tool("call-81-002", "check_uc_service_eligibility", {
        "eligibility_id": "elig-sdpl-9912-aa11",
        "is_eligible": True,
        "matched_offering": "UC_ENTERPRISE_PRO_v4",
        "site_coverage": [
            {"site_id": "site-sdpl-kl-hq", "coverage": "full"},
            {"site_id": "site-sdpl-cary", "coverage": "full"},
            {"site_id": "site-sdpl-sdk", "coverage": "limited_high_latency"}
        ],
        "valid_until": "2026-06-21T09:13:00+08:00",
        "_warning": "quota_remaining_today: 7 of 50 eligibility checks."
    }))
    msgs.append(assistant(
        "Berjaya, Puan:\n\n"
        "- **eligibility_id:** `elig-sdpl-9912-aa11`\n"
        "- 3 site lulus; Sandakan status `limited_high_latency`.\n"
        "- Amaran kuota proaktif: hanya **7 daripada 50** eligibility checks tinggal hari ini.\n\n"
        "Adakah Puan mahu saya teruskan jana quote?"
    ))
    msgs.append(user(
        "Ya, jana quote. Term 24 bulan, billing monthly, currency MYR. Discount band sub-band-B (negotiated 12%)."
    ))
    msgs.append(assistant_tool(
        "Baik, saya jana quote sekarang.",
        [("call-81-003", "create_uc_subscription_quote", {
            "eligibility_id": "elig-sdpl-9912-aa11",
            "customer_id": "cust-sdpl-9912",
            "term_months": 24,
            "billing_frequency": "monthly",
            "currency": "MYR",
            "discount_band": "sub-band-B",
            "requested_by": {"user_id": "usr-aishah-b2bops-021", "role": "b2b_account_ops"}
        })]
    ))
    msgs.append(tool("call-81-003", "create_uc_subscription_quote", {
        "quote_id": "quo-sdpl-9912-bb22",
        "status": "draft",
        "total_mrc": {"amount": 91245.00, "currency": "MYR"},
        "total_nrc": {"amount": 12500.00, "currency": "MYR"},
        "term_months": 24,
        "discount_applied_pct": 12,
        "expires_at": "2026-06-04T09:14:00+08:00"
    }))
    msgs.append(assistant(
        "Quote berjaya dijana, Puan:\n\n"
        "- **quote_id:** `quo-sdpl-9912-bb22`\n"
        "- **MRC:** RM 91,245/bulan | **NRC:** RM 12,500\n"
        "- Tamat tempoh quote: 4 Jun 2026"
    ))
    msgs.append(user(
        "Eh sebelum kita teruskan — saya tertanya, kafetaria pejabat Cyberjaya, ada tak makanan vegetarian Hari Wesak hari ni? "
        "Lapar dah."
    ))
    msgs.append(assistant(
        "Maaf Puan Aishah, urusan kafetaria dan menu pejabat adalah di luar skop khidmat UC subscription saya. "
        "Untuk pertanyaan tersebut, sila rujuk:\n\n"
        "- Aplikasi Kantin Maxis Cyberjaya (canteen.maxis.com.my) atau pertanyaan ke front desk\n\n"
        "Kembali kepada operasi — sebelum convert ke order, adakah Puan mahu saya simulate impact provisioning di Sandakan dulu?"
    ))
    msgs.append(user(
        "Ah baik idea, simulate dulu. Saya tak nak surprise."
    ))
    msgs.append(assistant_tool(
        "Baik.",
        [("call-81-004", "uc_subscription_simulate_operation", {
            "operation_type": "provision_subscribers",
            "quote_id": "quo-sdpl-9912-bb22",
            "what_if_inputs": {
                "site_focus": ["site-sdpl-sdk"],
                "simulate_latency_impact": True,
                "concurrency_assumption": 50
            },
            "output_options": {"include_risk_score": True, "include_estimated_duration": True}
        })]
    ))
    msgs.append(tool("call-81-004", "uc_subscription_simulate_operation", {
        "simulation_id": "sim-sdpl-9912-cc33",
        "operation_type": "provision_subscribers",
        "risk_score": 0.42,
        "risk_band": "medium",
        "key_findings": [
            {"site_id": "site-sdpl-sdk", "issue": "median_provisioning_latency_seconds estimated 38s (vs 12s baseline)"},
            {"site_id": "site-sdpl-sdk", "issue": "regional registrar capacity at 78%"}
        ],
        "estimated_duration_minutes": 42,
        "recommended_mitigation": "schedule_provisioning_window_offpeak_midnight_my"
    }))
    msgs.append(assistant(
        "Simulasi siap, Puan:\n\n"
        "- **risk_score:** 0.42 (medium)\n"
        "- **Anggaran tempoh:** 42 minit\n"
        "- **Cadangan:** Jalankan provisioning di luar waktu puncak.\n\n"
        "Saya cadangkan jadualkan provisioning Sandakan secara berasingan. Setuju?"
    ))
    msgs.append(user(
        "Setuju. Convert quote ke order dulu, kemudian schedule recurring job untuk Sandakan jam 12 tengah malam."
    ))
    msgs.append(assistant_tool(
        "Baik Puan, saya convert quote dan schedule job secara selari.",
        [
            ("call-81-005", "create_subscription_order_from_quote", {
                "quote_id": "quo-sdpl-9912-bb22",
                "customer_po_number": "SDPL-PO-2026-0517",
                "requested_by": {"user_id": "usr-aishah-b2bops-021", "role": "b2b_account_ops"}
            }),
            ("call-81-006", "uc_subscription_schedule_recurring_job", {
                "job_type": "provision_subscribers",
                "schedule_expression": "0 0 22 * * ?",
                "timezone": "Asia/Kuala_Lumpur",
                "job_payload": {
                    "site_id": "site-sdpl-sdk",
                    "concurrency": 25,
                    "quote_id": "quo-sdpl-9912-bb22"
                },
                "starts_at": "2026-05-21T23:59:00+08:00",
                "max_runs": 1
            })
        ]
    ))
    msgs.append(tool("call-81-005", "create_subscription_order_from_quote", {
        "order_id": "ord-sdpl-9912-dd44",
        "status": "accepted",
        "quote_id": "quo-sdpl-9912-bb22",
        "created_at": "2026-05-21T09:18:33+08:00"
    }))
    msgs.append(tool("call-81-006", "uc_subscription_schedule_recurring_job", {
        "scheduled_job_id": "sjob-sdpl-sdk-ee55",
        "schedule_expression": "0 0 22 * * ?",
        "next_run_at": "2026-05-21T22:00:00+08:00",
        "status": "scheduled"
    }))
    msgs.append(assistant(
        "Kedua-dua siap, Puan:\n\n"
        "- **order_id:** `ord-sdpl-9912-dd44`\n"
        "- **scheduled_job_id:** `sjob-sdpl-sdk-ee55` — run pertama jam 22:00 MYT malam ini\n\n"
        "Adakah Puan mahu saya mulakan provisioning untuk KL HQ + Carey Island sekarang?"
    ))
    msgs.append(user(
        "Ya, provision KL HQ dan Carey Island sekarang. Concurrency standard."
    ))
    msgs.append(assistant_tool(
        "Baik.",
        [("call-81-007", "provision_subscribers", {
            "order_id": "ord-sdpl-9912-dd44",
            "site_scope": ["site-sdpl-kl-hq", "site-sdpl-cary"],
            "concurrency": 50,
            "admin_contact": {"name": "Nurul Hasanah", "email": "nurul.hasanah@simedarby.com.my"},
            "requested_by": {"user_id": "usr-aishah-b2bops-021", "role": "b2b_account_ops"}
        })]
    ))
    msgs.append(tool("call-81-007", "provision_subscribers", {
        "error": {
            "http_status": 503,
            "code": "service_unavailable",
            "message": "UC provisioning service is currently in scheduled maintenance window. Estimated restoration: 2026-05-21T09:35:00+08:00.",
            "incident_id": "inc-maint-2026-05-21-uc-prov",
            "retry_after_seconds": 900,
            "trace_id": "trc-503-2026-05-21-09-19-bb"
        }
    }))
    msgs.append(assistant(
        "Mohon maaf Puan, UC provisioning service sedang dalam **maintenance window** (HTTP 503):\n\n"
        "- **incident_id:** `inc-maint-2026-05-21-uc-prov`\n"
        "- Anggaran pulih: 09:35 MYT (15 minit lagi)\n\n"
        "Saya cadang **subscribe events** dulu supaya notifikasi automatik bila service pulih. Setuju?"
    ))
    msgs.append(user(
        "Setuju. E-mel saya aishah.rahman@maxis.com.my. Sat sat, telefon CFO masuk... [pause] OK done. Sambung."
    ))
    msgs.append(assistant_tool(
        "Saya tunggu Puan tadi. Subscribe sekarang.",
        [("call-81-008", "uc_subscription_subscribe_to_events", {
            "subscription_scope": {"order_id": "ord-sdpl-9912-dd44"},
            "subscribers": [
                {"channel": "email", "address": "aishah.rahman@maxis.com.my", "locale": "ms-MY"}
            ],
            "events": ["provision.started", "provision.completed", "provision.failed", "service.restored"],
            "delivery_options": {"retry_on_failure": True, "include_summary_pdf": True}
        })]
    ))
    msgs.append(tool("call-81-008", "uc_subscription_subscribe_to_events", {
        "subscription_id": "subs-evt-sdpl-ff66",
        "subscribers_confirmed": 1,
        "events": ["provision.started", "provision.completed", "provision.failed", "service.restored"],
        "status": "active",
        "first_delivery_eta": "2026-05-21T09:35:00+08:00"
    }))
    msgs.append(assistant(
        "Subscription aktif, Puan:\n\n"
        "- **subscription_id:** `subs-evt-sdpl-ff66`\n\n"
        "Sambil tunggu maintenance, ada apa Puan nak saya bantu?"
    ))
    msgs.append(user(
        "Tanya luar topik sikit — anak buah saya nak intern Maxis Enterprise, jurusan telekomunikasi UTM tahun 3. "
        "Bila next intake intern?"
    ))
    msgs.append(assistant(
        "Maaf Puan Aishah, urusan rekrutmen dan internship adalah di luar skop khidmat UC subscription saya. "
        "Untuk pertanyaan tersebut, sila rujuk:\n\n"
        "- Portal kerjaya rasmi: careers.maxis.com.my (bahagian *Internship*)\n"
        "- E-mel HR: talent@maxis.com.my\n\n"
        "Kembali kepada operasi — semasa tunggu service pulih, saya boleh tarik audit log untuk Puan?"
    ))
    msgs.append(user(
        "OK ya, tarik audit log. Saya nak verify untuk compliance audit nanti."
    ))
    msgs.append(assistant_tool(
        "Baik.",
        [("call-81-009", "uc_subscription_get_audit_log", {
            "scope": {"customer_id": "cust-sdpl-9912"},
            "time_range": {"from": "2026-05-21T09:00:00+08:00", "to": "2026-05-21T09:25:00+08:00"},
            "include_system_actors": True,
            "limit": 20
        })]
    ))
    msgs.append(tool("call-81-009", "uc_subscription_get_audit_log", {
        "entries": [
            {"timestamp": "2026-05-21T09:12:00+08:00", "actor": {"id": "usr-aishah-b2bops-021", "type": "user", "name": "***REDACTED-PII***"}, "action": "eligibility_check_attempt", "result": "validation_error_400"},
            {"timestamp": "2026-05-21T09:13:00+08:00", "actor": {"id": "usr-aishah-b2bops-021", "type": "user", "name": "***REDACTED-PII***"}, "action": "eligibility_check_attempt", "result": "ok"},
            {"timestamp": "2026-05-21T09:14:00+08:00", "actor": {"id": "usr-aishah-b2bops-021", "type": "user"}, "action": "quote_created", "quote_id": "quo-sdpl-9912-bb22"},
            {"timestamp": "2026-05-21T09:18:33+08:00", "actor": {"id": "usr-aishah-b2bops-021", "type": "user"}, "action": "order_created", "order_id": "ord-sdpl-9912-dd44"},
            {"timestamp": "2026-05-21T09:19:00+08:00", "actor": {"id": "system:provisioner", "type": "system"}, "action": "provisioning_attempt", "result": "service_unavailable_503"}
        ],
        "total_entries": 5,
        "pagination": {"has_next_page": False}
    }))
    msgs.append(assistant(
        "Audit log lengkap (5 entries), Puan — semuanya logged dengan betul:\n\n"
        "1. 09:12 — eligibility check pertama (gagal 400)\n"
        "2. 09:13 — eligibility check kedua (lulus)\n"
        "3. 09:14 — quote created\n"
        "4. 09:18:33 — order created\n"
        "5. 09:19 — provisioning attempt (gagal 503)\n\n"
        "(Nota: nama Puan dipaparkan sebagai `***REDACTED-PII***` kerana mod query — ini tingkah laku normal, bukan ralat.)"
    ))
    msgs.append(user(
        "Bagus. Last sekali — boleh check overall health status untuk customer ni? Saya nak laporan sikit untuk pre-sales meeting."
    ))
    msgs.append(assistant_tool(
        "Baik, saya tarik health + KPI metrics secara selari.",
        [
            ("call-81-010", "monitor_subscription_health", {
                "scope": {"customer_id": "cust-sdpl-9912"},
                "include_site_breakdown": True
            }),
            ("call-81-011", "uc_subscription_get_kpi_metrics", {
                "scope": {"customer_id": "cust-sdpl-9912"},
                "metric_set": "executive_summary",
                "time_range": {"from": "2026-05-21T00:00:00+08:00", "to": "2026-05-21T09:25:00+08:00"}
            })
        ]
    ))
    msgs.append(tool("call-81-010", "monitor_subscription_health", {
        "overall_health": "pending_provisioning",
        "site_health": [
            {"site_id": "site-sdpl-kl-hq", "status": "awaiting_provisioning"},
            {"site_id": "site-sdpl-cary", "status": "awaiting_provisioning"},
            {"site_id": "site-sdpl-sdk", "status": "scheduled_for_offpeak"}
        ],
        "open_alerts": 0,
        "as_of": "2026-05-21T09:24:50+08:00"
    }))
    msgs.append(tool("call-81-011", "uc_subscription_get_kpi_metrics", {
        "kpis": {
            "subscribers_active": 0,
            "subscribers_pending": 350,
            "subscribers_failed": 0
        },
        "note": "customer is in onboarding phase; lifecycle KPIs will populate after first successful provisioning."
    }))
    msgs.append(assistant(
        "Ringkasan, Puan Aishah:\n\n"
        "**Health:** pending_provisioning (KL HQ + Carey awaiting; Sandakan scheduled midnight)\n"
        "**KPIs:** 350 pending subscribers, 0 active, 0 failed\n"
        "**Open alerts:** 0\n\n"
        "Adakah ada apa-apa lagi yang Puan perlukan sebelum tutup sesi?"
    ))
    msgs.append(user(
        "Cukup dulu, terima kasih banyak. Saya akan lapor balik kepada CFO sebelum 11 pagi. Selamat pagi."
    ))
    msgs.append(assistant(
        "Sama-sama Puan Aishah. Terima kasih atas kesabaran sepanjang panggilan ini, terutama dalam menangani siri ralat sistem hari ini "
        "(400 validation Sabah-East, 503 maintenance window, amaran kuota proaktif). "
        "Sila hubungi kami semula kemudian. Selamat pagi."
    ))

    meta = build_metadata(I, "malay", 13,
        [
            {"http_status": 400, "service": "eligibility-api", "kind": "validation_error", "recovered": True, "via": "add-feature-flag-and-retry"},
            {"http_status": 503, "service": "provisioning-api", "kind": "service_unavailable_maintenance", "recovered": True, "via": "subscribe-events-and-wait"},
            {"http_status": 200, "service": "eligibility-api", "kind": "quota_warning", "recovered": True, "via": "agent-flags-low-quota"},
            {"http_status": 200, "service": "audit-api", "kind": "pii_redaction", "recovered": True, "via": "agent-explains-redaction"}
        ],
        [
            {"turn": 5, "topic": "cafeteria menu Wesak Day"},
            {"turn": 11, "topic": "internship application for relative at Maxis HR"}
        ],
        [
            "proactive_quota_warning",
            "suggest_workaround_subscribe_events_during_maintenance",
            "explains_pii_redaction_as_normal_behaviour",
            "proactive_simulation_before_provisioning",
            "parallel_tool_calls_for_efficiency"
        ],
        [
            "check_uc_service_eligibility", "create_uc_subscription_quote",
            "uc_subscription_simulate_operation", "create_subscription_order_from_quote",
            "uc_subscription_schedule_recurring_job", "provision_subscribers",
            "uc_subscription_subscribe_to_events", "uc_subscription_get_audit_log",
            "monitor_subscription_health", "uc_subscription_get_kpi_metrics"
        ],
        "Malay-leading Puan Aishah (B2B account ops); Bahasa primary; agent formal Bahasa with Puan."
    )
    return I, msgs, meta


# ---------------------------------------------------------------------------
# 82 - api_pipeline_gateway_management (English-leading)
# ---------------------------------------------------------------------------
def build_82():
    I = 82
    msgs = []

    msgs.append(user(
        "Good afternoon. This is Sir Daniel Tan, platform engineer at CelcomDigi API platform team in KL Sentral. "
        "I need to deploy a new ML inference pipeline behind our API gateway today — `customer-churn-scorer-v2`. "
        "Can we start by creating the pipeline definition? Owner team is data-platform-mlops, runtime python-3.11, "
        "with two stages: feature lookup then xgboost scoring."
    ))
    msgs.append(assistant_tool(
        "Good afternoon Sir Daniel. Certainly, I will create the gateway pipeline now.",
        [("call-82-001", "create_gateway_pipeline", {
            "name": "customer-churn-scorer-v2",
            "description": "ML inference pipeline scoring customer churn risk; feature-lookup then xgboost.",
            "owner_team": "data-platform-mlops",
            "runtime": "python-3.11",
            "stages": [
                {"stage_id": "feature_lookup", "type": "data_lookup", "config_ref": "fs-churn-v3"},
                {"stage_id": "xgb_score", "type": "model_inference", "config_ref": "mdl-xgb-churn-1108"}
            ],
            "metadata": {"environment": "production", "tags": ["ml", "churn", "scoring"]},
            "requested_by": {"user_id": "usr-dtan-mlops-033", "role": "platform_engineer"}
        })]
    ))
    msgs.append(tool("call-82-001", "create_gateway_pipeline", {
        "pipeline_id": "pipe-churn-v2-aa01",
        "name": "customer-churn-scorer-v2",
        "lifecycle_state": "draft",
        "created_at": "2026-05-21T13:42:10+08:00",
        "stage_count": 2
    }))
    msgs.append(assistant(
        "Pipeline created, Sir Daniel:\n\n"
        "- **pipeline_id:** `pipe-churn-v2-aa01`\n"
        "- **State:** draft | **Stages:** 2 (feature_lookup + xgb_score)\n\n"
        "Next, shall I define the first version (semver 2.0.0) for this pipeline?"
    ))
    msgs.append(user(
        "Yes, define version 2.0.0. Source artifact from our registry — image tag `ml-registry.celcomdigi.my/churn:v2.0.0`, "
        "sha256 `8f4a2c...` (full hash: `8f4a2c7e9d1b3a5f0c6e8b1d2f4a7c9e0b1d2f4a7c9e0b1d2f4a7c9e0b1d2f4a`). "
        "Resource profile medium."
    ))
    msgs.append(assistant_tool(
        "Defining version 2.0.0.",
        [("call-82-002", "define_pipeline_version", {
            "pipeline_id": "pipe-churn-v2-aa01",
            "semver": "2.0.0",
            "artifact": {
                "type": "container_image",
                "uri": "ml-registry.celcomdigi.my/churn:v2.0.0",
                "sha256": "8f4a2c7e9d1b3a5f0c6e8b1d2f4a7c9e0b1d2f4a7c9e0b1d2f4a7c9e0b1d2f4a"
            },
            "resource_profile": "medium",
            "changelog": "Initial v2 release; switched to xgboost from logistic; added feature freshness check.",
            "requested_by": {"user_id": "usr-dtan-mlops-033"}
        })]
    ))
    msgs.append(tool("call-82-002", "define_pipeline_version", {
        "version_id": "ver-churn-v2-bb02",
        "semver": "2.0.0",
        "status": "validated",
        "created_at": "2026-05-21T13:43:55+08:00"
    }))
    msgs.append(assistant(
        "Version 2.0.0 validated:\n\n"
        "- **version_id:** `ver-churn-v2-bb02`\n\n"
        "Shall I proceed to configure a gateway route for this version?"
    ))
    msgs.append(user(
        "Yes please. Path `/v2/score/churn`, methods POST only, attach the existing auth policy `pol-jwt-strict-014`. "
        "Initially route 100% to v2.0.0."
    ))
    msgs.append(assistant_tool(
        "Configuring the route and attaching the auth policy in parallel.",
        [
            ("call-82-003", "configure_gateway_route", {
                "pipeline_id": "pipe-churn-v2-aa01",
                "path": "/v2/score/churn",
                "methods": ["POST"],
                "traffic_split": [{"version_id": "ver-churn-v2-bb02", "weight": 100}],
                "rate_limit": {"requests_per_minute": 2000},
                "requested_by": {"user_id": "usr-dtan-mlops-033"}
            }),
            ("call-82-004", "attach_gateway_policy", {
                "pipeline_id": "pipe-churn-v2-aa01",
                "policy_id": "pol-jwt-strict-014",
                "scope": "route",
                "enforcement_phase": "request"
            })
        ]
    ))
    msgs.append(tool("call-82-003", "configure_gateway_route", {
        "route_id": "rte-churn-v2-cc03",
        "path": "/v2/score/churn",
        "methods": ["POST"],
        "traffic_split": [{"version_id": "ver-churn-v2-bb02", "weight": 100}],
        "status": "configured"
    }))
    msgs.append(tool("call-82-004", "attach_gateway_policy", {
        "error": {
            "http_status": 409,
            "code": "version_conflict",
            "message": "Policy attachment conflict: policy pol-jwt-strict-014 is already attached at the pipeline-level (parent scope) with etag 'etag-pol-014-prv'. Provided If-Match etag did not match. Re-fetch and retry, or specify scope='route' override flag.",
            "current_etag": "etag-pol-014-prv-zz",
            "trace_id": "trc-409-2026-05-21-13-45-aa"
        }
    }))
    msgs.append(assistant(
        "The route is configured (rte-churn-v2-cc03) but the policy attach returned **HTTP 409 Version Conflict**:\n\n"
        "- The policy `pol-jwt-strict-014` is **already attached at pipeline-level** (parent scope), making a duplicate route-scope attach unnecessary.\n"
        "- **Trace ID:** `trc-409-2026-05-21-13-45-aa`\n\n"
        "I will treat this as inherited-policy (no action needed). The route will still enforce JWT-strict via the parent scope. Acceptable, Sir?"
    ))
    msgs.append(user(
        "Wait actually — I want to also verify the policy is correctly evaluated for our test JWT before we deploy. "
        "Can you evaluate the policy first?"
    ))
    msgs.append(assistant_tool(
        "Good check before deploy. Evaluating now.",
        [("call-82-005", "api_pipeline_evaluate_policy", {
            "policy_id": "pol-jwt-strict-014",
            "evaluation_inputs": {
                "subject": {"jwt_iss": "https://auth.celcomdigi.my", "jwt_sub": "svc-mlops-test", "scopes": ["score:churn:write"]},
                "request": {"path": "/v2/score/churn", "method": "POST"}
            }
        })]
    ))
    msgs.append(tool("call-82-005", "api_pipeline_evaluate_policy", {
        "decision": "allow",
        "matched_rule": "scope_score_churn_write_allowed",
        "obligations": [],
        "evaluation_id": "eval-pol-014-dd04",
        "_deprecation_warning": {
            "header": "X-API-Deprecated",
            "message": "policy evaluator v1 sunset on 2026-11-30. Migrate to v2 with structured-obligations.",
            "sunset_date": "2026-11-30"
        }
    }))
    msgs.append(assistant(
        "Policy evaluation returns **allow**, Sir Daniel — the test JWT passes scope `score:churn:write`.\n\n"
        "Proactive notice: the response carries an **X-API-Deprecated** header. Policy evaluator v1 will sunset on "
        "**30 November 2026**; your team should plan migration to v2 (structured obligations). I will flag this to "
        "the platform team in the audit comments later."
    ))
    msgs.append(user(
        "Noted on the deprecation, thanks for the heads up. By the way — totally off topic — do you know what time "
        "the visitor reception closes today at KL Sentral office? My vendor's coming at 5pm."
    ))
    msgs.append(assistant(
        "I apologise Sir Daniel, visitor reception hours fall outside my pipeline-management scope. For that:\n\n"
        "- Please refer to **facilities@celcomdigi.my** or the FrontDesk mobile app for accurate visitor-policy timings.\n\n"
        "Returning to the workflow: shall I now simulate the deployment impact before pushing v2.0.0 live?"
    ))
    msgs.append(user(
        "Yes, simulate. I want to see projected latency and any blast radius before we go canary."
    ))
    msgs.append(assistant_tool(
        "Running the deployment simulation.",
        [("call-82-006", "api_pipeline_simulate_operation", {
            "operation_type": "deploy_pipeline_version",
            "pipeline_id": "pipe-churn-v2-aa01",
            "version_id": "ver-churn-v2-bb02",
            "what_if_inputs": {
                "expected_qps": 1500,
                "current_p99_ms_baseline": 180
            },
            "output_options": {"include_risk_score": True, "include_blast_radius": True}
        })]
    ))
    msgs.append(tool("call-82-006", "api_pipeline_simulate_operation", {
        "simulation_id": "sim-churn-v2-ee05",
        "risk_score": 0.31,
        "risk_band": "low_to_medium",
        "projected_p99_ms": 165,
        "blast_radius": {
            "downstream_consumers": 14,
            "tenants_affected": ["tnt-celcomdigi-prod", "tnt-celcomdigi-staging"]
        },
        "recommended_strategy": "canary_10pct_then_50pct_then_100pct"
    }))
    msgs.append(assistant(
        "Simulation done, Sir Daniel:\n\n"
        "- **risk_score:** 0.31 (low-to-medium)\n"
        "- **Projected p99:** 165ms (improvement over 180ms baseline)\n"
        "- **Blast radius:** 14 downstream consumers across 2 tenants\n"
        "- **Recommended strategy:** canary 10% → 50% → 100%\n\n"
        "Shall I proceed with deployment via canary?"
    ))
    msgs.append(user(
        "Yes, deploy to canary at 10% first."
    ))
    msgs.append(assistant_tool(
        "Deploying with 10% canary.",
        [("call-82-007", "deploy_pipeline_version", {
            "pipeline_id": "pipe-churn-v2-aa01",
            "version_id": "ver-churn-v2-bb02",
            "deployment_strategy": "canary",
            "initial_traffic_pct": 10,
            "requested_by": {"user_id": "usr-dtan-mlops-033"}
        })]
    ))
    msgs.append(tool("call-82-007", "deploy_pipeline_version", {
        "http_status": 202,
        "status": "accepted",
        "deployment_id": "dep-churn-v2-ff06",
        "estimated_completion_seconds": 120,
        "polling_url": "/deployments/dep-churn-v2-ff06/status",
        "webhook_supported": True,
        "accepted_at": "2026-05-21T13:48:11+08:00"
    }))
    msgs.append(assistant(
        "Deployment accepted as background job (**HTTP 202 Accepted**):\n\n"
        "- **deployment_id:** `dep-churn-v2-ff06`\n"
        "- ETA: 120 seconds\n\n"
        "Would you prefer I poll, or set up a webhook subscription to notify you when the canary is live?"
    ))
    msgs.append(user(
        "Subscribe by webhook — and also CC our SRE channel. Webhook URL `https://sre-events.celcomdigi.my/hook/ml`."
    ))
    msgs.append(assistant_tool(
        "Subscribing.",
        [("call-82-008", "api_pipeline_subscribe_to_events", {
            "subscription_scope": {"pipeline_id": "pipe-churn-v2-aa01"},
            "subscribers": [
                {"channel": "webhook", "address": "https://sre-events.celcomdigi.my/hook/ml", "signing_secret_ref": "vault://sre/ml-webhook"}
            ],
            "events": ["deployment.completed", "deployment.failed", "canary.promoted", "rollback.executed"],
            "delivery_options": {"retry_on_failure": True}
        })]
    ))
    msgs.append(tool("call-82-008", "api_pipeline_subscribe_to_events", {
        "subscription_id": "subs-pipe-churn-gg07",
        "subscribers_confirmed": 1,
        "status": "active",
        "first_delivery_eta": "2026-05-21T13:50:11+08:00"
    }))
    msgs.append(assistant(
        "Webhook subscription active (`subs-pipe-churn-gg07`). The SRE channel will be notified for deployment, canary promotion, and rollback events.\n\n"
        "Anything else while we wait for canary?"
    ))
    msgs.append(user(
        "Yes, can you check deployment status now and pull a list of recent deployments for this pipeline?"
    ))
    msgs.append(assistant_tool(
        "Running both in parallel.",
        [
            ("call-82-009", "get_deployment_status", {
                "deployment_id": "dep-churn-v2-ff06"
            }),
            ("call-82-010", "list_gateway_pipelines", {
                "filters": {"name_contains": "churn"},
                "page_size": 5,
                "sort_by": "updated_at",
                "sort_direction": "desc"
            })
        ]
    ))
    msgs.append(tool("call-82-009", "get_deployment_status", {
        "deployment_id": "dep-churn-v2-ff06",
        "status": "completed",
        "progress_pct": 100,
        "current_traffic_split": [
            {"version_id": "ver-churn-v2-bb02", "weight": 10},
            {"version_id": "ver-churn-v1-9988", "weight": 90}
        ],
        "completed_at": "2026-05-21T13:50:14+08:00"
    }))
    msgs.append(tool("call-82-010", "list_gateway_pipelines", {
        "data": [
            {"pipeline_id": "pipe-churn-v2-aa01", "name": "customer-churn-scorer-v2", "lifecycle_state": "live", "updated_at": "2026-05-21T13:50:14+08:00"},
            {"pipeline_id": "pipe-churn-v1-aa00", "name": "customer-churn-scorer-v1", "lifecycle_state": "deprecating", "updated_at": "2026-05-20T16:30:00+08:00"}
        ],
        "pagination": {"page_size": 5, "has_next_page": False, "total_count": 2}
    }))
    msgs.append(assistant(
        "Canary is live, Sir Daniel:\n\n"
        "- **Deployment status:** completed (100% progress)\n"
        "- **Traffic split:** v2.0.0 @ 10%, v1 @ 90%\n"
        "- **Total churn pipelines on platform:** 2 (v1 deprecating, v2 live)\n\n"
        "Anything else before I close the session?"
    ))
    msgs.append(user(
        "Hold on — quick sanity check. Looking at the v1 pipeline still receiving 90%, can I see the audit log "
        "of who deployed v1 originally? Was it me or someone else?"
    ))
    msgs.append(assistant_tool(
        "I am not certain of the original deployer offhand; let me check the audit log for v1.",
        [("call-82-011", "api_pipeline_get_audit_log", {
            "scope": {"pipeline_id": "pipe-churn-v1-aa00"},
            "filters": {"action_types": ["deploy_pipeline_version"]},
            "limit": 5,
            "include_system_actors": True
        })]
    ))
    msgs.append(tool("call-82-011", "api_pipeline_get_audit_log", {
        "entries": [
            {
                "timestamp": "2025-11-04T10:14:22+08:00",
                "actor": {"id": "usr-ssamy-mlops-019", "type": "user", "name": "***REDACTED-PII***"},
                "action": "deploy_pipeline_version",
                "version_id": "ver-churn-v1-9988",
                "deployment_id": "dep-churn-v1-hh99"
            }
        ],
        "total_entries": 1
    }))
    msgs.append(assistant(
        "Audit history clarifies, Sir:\n\n"
        "- v1 was deployed on **4 November 2025, 10:14 MYT** by user `usr-ssamy-mlops-019` (name redacted in query mode — normal behaviour, not an error).\n"
        "- That is a different user from yourself; you can follow up with them about the v1 deprecation timeline."
    ))
    msgs.append(user(
        "OK noted. Final ask — can you take a snapshot of the current pipeline state for our compliance evidence? "
        "And then I will close the call."
    ))
    msgs.append(assistant_tool(
        "Creating snapshot now.",
        [("call-82-012", "api_pipeline_create_snapshot", {
            "scope": {"pipeline_id": "pipe-churn-v2-aa01"},
            "snapshot_name": "post-canary-deploy-2026-05-21",
            "include_artifacts": ["pipeline_definition", "version", "route", "active_policies", "traffic_split"],
            "retention_days": 365,
            "purpose": "compliance_evidence_post_canary"
        })]
    ))
    msgs.append(tool("call-82-012", "api_pipeline_create_snapshot", {
        "snapshot_id": "snap-pipe-churn-v2-ii08",
        "created_at": "2026-05-21T13:53:10+08:00",
        "retention_days": 365,
        "size_bytes": 184320,
        "checksum": "sha256:7e3a9c1b...",
        "_warning": "Eventually consistent: snapshot indexing across all replicas may lag up to 60s. Snapshot is immediately retrievable from primary."
    }))
    msgs.append(assistant(
        "Snapshot captured, Sir Daniel:\n\n"
        "- **snapshot_id:** `snap-pipe-churn-v2-ii08`\n"
        "- Retention: 365 days | Size: 184 KB\n"
        "- Note: eventually-consistent indexing may take up to 60s across replicas, but the snapshot is already retrievable from primary."
    ))
    msgs.append(user(
        "Excellent. Thanks for handling the 409 conflict, the deprecation warning, and the 202 deploy so smoothly. "
        "I will monitor the webhook for canary promotion in 30 min. Closing call now."
    ))
    msgs.append(assistant(
        "Thank you, Sir Daniel. To recap, we handled today: a 409 policy conflict (resolved by recognising inherited scope), "
        "a 202 async deployment (canary now at 10%), an X-API-Deprecated warning on the policy evaluator, and an eventually-consistent "
        "snapshot indexing notice. Please contact us again if anything arises during canary monitoring. Have a good afternoon."
    ))

    meta = build_metadata(I, "english", 13,
        [
            {"http_status": 409, "service": "policy-api", "kind": "version_conflict", "recovered": True, "via": "recognise-policy-inherited-from-parent-scope"},
            {"http_status": 202, "service": "deploy-api", "kind": "async_accepted", "recovered": True, "via": "webhook-subscription"},
            {"http_status": 200, "service": "policy-evaluator-api", "kind": "deprecation_warning", "recovered": True, "via": "agent-flags-sunset-date"},
            {"http_status": 200, "service": "snapshot-api", "kind": "eventually_consistent", "recovered": True, "via": "agent-explains-replica-lag"},
            {"http_status": 200, "service": "audit-api", "kind": "pii_redaction", "recovered": True, "via": "agent-explains-redaction"}
        ],
        [
            {"turn": 6, "topic": "visitor reception hours at KL Sentral"}
        ],
        [
            "self_correction_acknowledges_inherited_policy_scope",
            "proactive_deprecation_warning",
            "proactive_simulation_before_canary_deploy",
            "admits_uncertainty_then_uses_audit_log",
            "parallel_tool_calls_for_status_and_listing",
            "explains_pii_redaction_as_normal_behaviour"
        ],
        [
            "create_gateway_pipeline", "define_pipeline_version",
            "configure_gateway_route", "attach_gateway_policy",
            "api_pipeline_evaluate_policy", "api_pipeline_simulate_operation",
            "deploy_pipeline_version", "api_pipeline_subscribe_to_events",
            "get_deployment_status", "list_gateway_pipelines",
            "api_pipeline_get_audit_log", "api_pipeline_create_snapshot"
        ],
        "English-leading Sir Daniel Tan (platform engineer); agent formal English with Sir."
    )
    # Need 2 OOCs - add a second
    return I, msgs, meta


def build_82_v2():
    I, msgs, meta = build_82()
    # add second OOC near the end
    # Insert after canary status response (after the audit call summary):
    # We need to actually edit msgs list properly. Easier to rebuild with 2 OOCs.
    # I'll just patch in by inserting before the snapshot-create question:
    # Find index of user message "OK noted. Final ask"
    # Simpler: append additional OOC pair before snapshot.
    new_msgs = []
    inserted = False
    for m in msgs:
        if not inserted and m['role'] == 'user' and m.get('content','').startswith("OK noted. Final ask"):
            # insert an OOC user + agent redirect pair before this
            new_msgs.append(user(
                "Quick aside — any chance you know the lunch place in KL Sentral nearby that's open today? "
                "Been here since morning."
            ))
            new_msgs.append(assistant(
                "I apologise Sir Daniel, food recommendations are outside my pipeline-management scope. For that:\n\n"
                "- Please refer to **Google Maps** or **GrabFood** for nearby outlet listings around KL Sentral.\n\n"
                "Returning to the workflow — anything else on the deployment side before we wrap?"
            ))
            inserted = True
        new_msgs.append(m)
    # update metadata
    meta['metadata']['out_of_context_turns'].append({"turn": 12, "topic": "lunch recommendation KL Sentral"})
    meta['metadata']['num_turns'] = sum(1 for m in new_msgs if m['role']=='user')
    return I, new_msgs, meta


# ---------------------------------------------------------------------------
# 83 - telco_alarm_lifecycle_management (Tamil-leading)
# ---------------------------------------------------------------------------
def build_83():
    I = 83
    msgs = []

    msgs.append(user(
        "Vanakkam, selamat petang. Saya Encik Ravi Kumar, NOC engineer shift petang di Subang Jaya. "
        "Tadi OSS Ericsson trigger satu alarm baru — external ID `EXT-ER-2026-05-21-991122`, "
        "node `BTS-PNG-GE-204` (Penang Georgetown), severity critical, transmission loss. "
        "Boleh ingest dulu ke sistem assurance kita?"
    ))
    msgs.append(assistant_tool(
        "Vanakkam, selamat petang Encik Ravi. Baik, saya ingest sekarang.",
        [("call-83-001", "ingest_alarm_event", {
            "external_alarm_id": "EXT-ER-2026-05-21-991122",
            "source": {"system_name": "OSS-Ericsson", "vendor": "Ericsson", "ne_id": "BTS-PNG-GE-204", "region": "Penang-Georgetown"},
            "alarm_details": {
                "severity": "critical",
                "probable_cause": "transmission_loss",
                "specific_problem_code": "TX_LOSS",
                "alarm_type": "communication",
                "raised_at": "2026-05-21T15:18:42+08:00"
            },
            "event_payload": {
                "raw_text": "CRITICAL: TX path lost on E1 link 3/2/1, BER above threshold for 5 minutes",
                "metric_snapshots": {"ber_rate": 0.012, "rx_signal_dbm": -52.1}
            }
        })]
    ))
    msgs.append(tool("call-83-001", "ingest_alarm_event", {
        "alarm_id": "alm-2026-05-21-png204-77810",
        "normalized": True,
        "severity": "critical",
        "created_at": "2026-05-21T15:19:11+08:00",
        "status": "open"
    }))
    msgs.append(assistant(
        "Alarm berjaya diingest, Encik Ravi:\n\n"
        "- **alarm_id:** `alm-2026-05-21-png204-77810` (severity critical, status open)\n\n"
        "Adakah Encik mahu saya correlate dengan alarm sekitar (kemungkinan ada sister alarm dari kawasan Penang)?"
    ))
    msgs.append(user(
        "Appadi-aa, severity critical eh. Aiyo, ya tolong correlate. Saya rasa boleh ada alarm transport dari nod sebelah."
    ))
    msgs.append(assistant_tool(
        "Baik.",
        [("call-83-002", "correlate_alarms", {
            "alarm_ids": ["alm-2026-05-21-png204-77810"],
            "correlation_strategy": "topology_and_time_window",
            "time_window": {"from": "2026-05-21T15:00:00+08:00", "to": "2026-05-21T15:25:00+08:00"},
            "topology_scope": {"region": "Penang-Georgetown"}
        })]
    ))
    msgs.append(tool("call-83-002", "correlate_alarms", {
        "error": {
            "http_status": 504,
            "code": "gateway_timeout",
            "message": "Topology correlation engine timed out at 30s. Partial result available via checkpoint_token.",
            "checkpoint_token": "chk-corr-png204-aa01",
            "trace_id": "trc-504-2026-05-21-15-20-bb",
            "incident_id": "inc-504-corr-engine-2026-05-21"
        }
    }))
    msgs.append(assistant(
        "Maaf Encik, enjin korelasi mengalami **HTTP 504 Gateway Timeout**:\n\n"
        "- **incident_id:** `inc-504-corr-engine-2026-05-21`\n"
        "- Hasil separa tersedia dengan `checkpoint_token: chk-corr-png204-aa01`\n\n"
        "Sebagai fallback, saya cadang guna `search_alarms` untuk fetch alarm secara manual dalam window 25 minit "
        "di region Penang-Georgetown, kemudian retry korelasi. Encik setuju?"
    ))
    msgs.append(user(
        "Seri, lakukan macam tu. Aiyaa, peak hour Penang dekat — saya nak resolve cepat sebelum trafik petang naik."
    ))
    msgs.append(assistant_tool(
        "Baik, saya search alarm dulu.",
        [("call-83-003", "search_alarms", {
            "filters": {
                "region": "Penang-Georgetown",
                "severity_min": "major",
                "time_range": {"from": "2026-05-21T15:00:00+08:00", "to": "2026-05-21T15:25:00+08:00"},
                "status_in": ["open", "acknowledged"]
            },
            "page_size": 10,
            "sort_by": "raised_at",
            "sort_direction": "desc"
        })]
    ))
    msgs.append(tool("call-83-003", "search_alarms", {
        "data": [
            {"alarm_id": "alm-2026-05-21-png204-77810", "ne_id": "BTS-PNG-GE-204", "severity": "critical", "probable_cause": "transmission_loss", "raised_at": "2026-05-21T15:18:42+08:00"},
            {"alarm_id": "alm-2026-05-21-png205-77815", "ne_id": "BTS-PNG-GE-205", "severity": "major", "probable_cause": "high_ber", "raised_at": "2026-05-21T15:17:01+08:00"},
            {"alarm_id": "alm-2026-05-21-png-mw-001", "ne_id": "MW-PNG-CORE-01", "severity": "major", "probable_cause": "microwave_link_degradation", "raised_at": "2026-05-21T15:16:34+08:00"}
        ],
        "pagination": {"page_size": 10, "has_next_page": False, "total_count": 3}
    }))
    msgs.append(assistant(
        "3 alarm relevan ditemui, Encik:\n\n"
        "1. `alm-2026-05-21-png204-77810` — critical TX loss (yang kita baru ingest)\n"
        "2. `alm-2026-05-21-png205-77815` — major high BER (BTS-PNG-GE-205, sister node)\n"
        "3. `alm-2026-05-21-png-mw-001` — major microwave link degradation (MW-PNG-CORE-01, hop atas)\n\n"
        "Saya cadang ketiga-tiga dicorrelate sebagai satu cluster — root cause kemungkinan microwave link degradation di hop atas. "
        "Saya retry correlation dengan 3 alarm ids?"
    ))
    msgs.append(user(
        "Ya tolong, romba thanks. Itu masuk akal — kalau microwave atas degrade, downstream BTS pun jadi loss."
    ))
    msgs.append(assistant_tool(
        "Retry correlate dengan 3 alarms + checkpoint.",
        [("call-83-004", "correlate_alarms", {
            "alarm_ids": [
                "alm-2026-05-21-png204-77810",
                "alm-2026-05-21-png205-77815",
                "alm-2026-05-21-png-mw-001"
            ],
            "correlation_strategy": "root_cause_inference",
            "checkpoint_token": "chk-corr-png204-aa01"
        })]
    ))
    msgs.append(tool("call-83-004", "correlate_alarms", {
        "correlation_id": "corr-png-cluster-bb02",
        "root_cause_alarm_id": "alm-2026-05-21-png-mw-001",
        "child_alarm_ids": ["alm-2026-05-21-png204-77810", "alm-2026-05-21-png205-77815"],
        "confidence": 0.86,
        "inferred_at": "2026-05-21T15:21:33+08:00"
    }))
    msgs.append(assistant(
        "Korelasi berjaya, Encik Ravi:\n\n"
        "- **correlation_id:** `corr-png-cluster-bb02`\n"
        "- **Root cause:** microwave link degradation (`alm-2026-05-21-png-mw-001`)\n"
        "- **Child alarms:** 2 BTS downstream\n"
        "- **Confidence:** 86%\n\n"
        "Saya cadangkan acknowledge ketiga-tiga, kemudian buka kes untuk MW-PNG-CORE-01. Setuju?"
    ))
    msgs.append(user(
        "Setuju, acknowledge semua. Saya akan handle MW investigation. Aiyo, tunggu — telefon supervisor masuk... [pause] OK sambung."
    ))
    msgs.append(assistant_tool(
        "Saya tunggu Encik tadi. Acknowledge sekarang.",
        [("call-83-005", "acknowledge_alarms", {
            "alarm_ids": [
                "alm-2026-05-21-png204-77810",
                "alm-2026-05-21-png205-77815",
                "alm-2026-05-21-png-mw-001"
            ],
            "acknowledged_by": {"user_id": "usr-ravi-noc-044", "role": "noc_engineer"},
            "note": "Cluster acknowledged; root cause MW link degradation under investigation by NOC Penang."
        })]
    ))
    msgs.append(tool("call-83-005", "acknowledge_alarms", {
        "acknowledged_count": 3,
        "results": [
            {"alarm_id": "alm-2026-05-21-png204-77810", "status": "acknowledged", "acknowledged_at": "2026-05-21T15:22:50+08:00"},
            {"alarm_id": "alm-2026-05-21-png205-77815", "status": "acknowledged", "acknowledged_at": "2026-05-21T15:22:50+08:00"},
            {"alarm_id": "alm-2026-05-21-png-mw-001", "status": "acknowledged", "acknowledged_at": "2026-05-21T15:22:50+08:00"}
        ]
    }))
    msgs.append(assistant(
        "3 alarm acknowledged jam 15:22:50 MYT, Encik. Adakah Encik mahu saya teruskan dengan suppression rule untuk BTS downstream "
        "supaya tidak banjir alarm sementara MW dibetulkan?"
    ))
    msgs.append(user(
        "Ya idea bagus. Suppress alarm dari BTS-PNG-GE-204 dan BTS-PNG-GE-205 untuk 2 jam, scope severity major-or-below. Critical tetap pass-through."
    ))
    msgs.append(assistant(
        "Sebelum saya cipta suppression, izinkan saya jelaskan blast radius:\n\n"
        "1. Alarm `major-or-below` daripada **BTS-PNG-GE-204** dan **BTS-PNG-GE-205** akan disenyapkan selama 2 jam.\n"
        "2. Alarm **critical** tetap akan trigger.\n"
        "3. Lain-lain BTS Penang **tidak terjejas**.\n"
        "4. Suppression akan auto-expire pada **17:23 MYT** (2 jam dari sekarang).\n"
        "5. Audit log akan merekod siapa cipta peraturan ini.\n\n"
        "Setuju untuk teruskan?"
    ))
    msgs.append(user(
        "Setuju, teruskan."
    ))
    msgs.append(assistant_tool(
        "Cipta suppression.",
        [("call-83-006", "create_suppression_rule", {
            "name": "PNG-GE-MW-investigation-2026-05-21",
            "scope": {
                "ne_ids": ["BTS-PNG-GE-204", "BTS-PNG-GE-205"],
                "severity_filter": ["minor", "warning", "major"]
            },
            "starts_at": "2026-05-21T15:23:00+08:00",
            "ends_at": "2026-05-21T17:23:00+08:00",
            "reason": "MW link degradation root cause under investigation; suppress downstream noise",
            "created_by": {"user_id": "usr-ravi-noc-044"}
        })]
    ))
    msgs.append(tool("call-83-006", "create_suppression_rule", {
        "suppression_rule_id": "supp-png-mw-cc03",
        "status": "active",
        "starts_at": "2026-05-21T15:23:00+08:00",
        "ends_at": "2026-05-21T17:23:00+08:00",
        "affected_ne_count": 2
    }))
    msgs.append(assistant(
        "Suppression aktif, Encik:\n\n"
        "- **suppression_rule_id:** `supp-png-mw-cc03`\n"
        "- Berkesan 15:23 → 17:23 MYT\n\n"
        "Adakah ada apa-apa lagi sebelum saya tutup?"
    ))
    msgs.append(user(
        "Sat, satu lagi soalan luar topik — kafetaria NOC pejabat ni, ada makanan kari ayam tak hari ni? "
        "Saya nak break sebelum sambung kerja."
    ))
    msgs.append(assistant(
        "Maaf Encik Ravi, urusan kafetaria pejabat adalah di luar skop khidmat alarm management saya. Untuk perkara tersebut:\n\n"
        "- Sila rujuk aplikasi *FoodAtWork* atau pertanyaan ke front desk NOC Penang.\n\n"
        "Kembali kepada operasi — adakah Encik mahu saya pull timeline lengkap untuk alarm root cause supaya boleh attach sebagai evidence untuk MW investigation?"
    ))
    msgs.append(user(
        "Aiyoyo, ya bagus idea. Pull timeline `alm-2026-05-21-png-mw-001`."
    ))
    msgs.append(assistant_tool(
        "Baik.",
        [("call-83-007", "get_alarm_timeline", {
            "alarm_id": "alm-2026-05-21-png-mw-001",
            "include_correlated_events": True,
            "limit": 20
        })]
    ))
    msgs.append(tool("call-83-007", "get_alarm_timeline", {
        "alarm_id": "alm-2026-05-21-png-mw-001",
        "timeline": [
            {"timestamp": "2026-05-21T15:16:34+08:00", "event": "alarm_raised", "severity": "major"},
            {"timestamp": "2026-05-21T15:17:01+08:00", "event": "correlated_child_added", "child_alarm_id": "alm-2026-05-21-png205-77815"},
            {"timestamp": "2026-05-21T15:18:42+08:00", "event": "correlated_child_added", "child_alarm_id": "alm-2026-05-21-png204-77810"},
            {"timestamp": "2026-05-21T15:21:33+08:00", "event": "root_cause_inferred", "correlation_id": "corr-png-cluster-bb02"},
            {"timestamp": "2026-05-21T15:22:50+08:00", "event": "acknowledged", "actor_id": "usr-ravi-noc-044"}
        ],
        "total_events": 5
    }))
    msgs.append(assistant(
        "Timeline lengkap, Encik:\n\n"
        "1. **15:16:34** — Alarm MW raised (major)\n"
        "2. **15:17:01** — BTS-PNG-GE-205 alarm correlated\n"
        "3. **15:18:42** — BTS-PNG-GE-204 alarm correlated\n"
        "4. **15:21:33** — Root cause diinference (corr-png-cluster-bb02)\n"
        "5. **15:22:50** — Acknowledged oleh Encik\n\n"
        "Adakah Encik mahu saya attach evidence (timeline + correlation result) untuk MW alarm ini?"
    ))
    msgs.append(user(
        "Ya tolong, attach. Untuk dokumentasi investigation team."
    ))
    msgs.append(assistant_tool(
        "Baik.",
        [("call-83-008", "alarm_attach_evidence", {
            "alarm_id": "alm-2026-05-21-png-mw-001",
            "evidence_items": [
                {
                    "type": "correlation_result",
                    "ref_id": "corr-png-cluster-bb02",
                    "summary": "Cluster of 3 alarms; root cause MW link degradation"
                },
                {
                    "type": "timeline_snapshot",
                    "captured_at": "2026-05-21T15:24:00+08:00",
                    "event_count": 5
                }
            ],
            "attached_by": {"user_id": "usr-ravi-noc-044"}
        })]
    ))
    msgs.append(tool("call-83-008", "alarm_attach_evidence", {
        "evidence_attachment_id": "evi-png-mw-dd04",
        "alarm_id": "alm-2026-05-21-png-mw-001",
        "items_attached": 2,
        "attached_at": "2026-05-21T15:24:15+08:00",
        "_warning": "quota_remaining_today: 9 of 100 evidence attachments today."
    }))
    msgs.append(assistant(
        "Evidence attached, Encik:\n\n"
        "- **evidence_attachment_id:** `evi-png-mw-dd04`\n"
        "- 2 item attached (correlation result + timeline snapshot)\n"
        "- Amaran kuota proaktif: hanya **9 daripada 100** evidence attachments tinggal untuk hari ini.\n\n"
        "Adakah ada apa-apa lagi?"
    ))
    msgs.append(user(
        "Last sekali, KPI metrics untuk MTTR shift petang saya hari ni — supaya saya boleh hand-off kepada shift malam dengan ringkasan."
    ))
    msgs.append(assistant_tool(
        "Baik.",
        [("call-83-009", "alarm_get_kpi_metrics", {
            "scope": {"region": "Penang-Georgetown", "shift": "afternoon"},
            "metric_set": "shift_handover",
            "time_range": {"from": "2026-05-21T14:00:00+08:00", "to": "2026-05-21T15:30:00+08:00"}
        })]
    ))
    msgs.append(tool("call-83-009", "alarm_get_kpi_metrics", {
        "kpis": {
            "alarms_ingested": 7,
            "alarms_acknowledged": 6,
            "alarms_resolved": 2,
            "mttr_minutes": 22,
            "correlation_clusters": 1,
            "suppression_rules_active": 1
        },
        "shift_handover_note": "1 active MW investigation cluster (corr-png-cluster-bb02); suppression active until 17:23 MYT."
    }))
    msgs.append(assistant(
        "KPI shift petang Encik Ravi, untuk hand-off:\n\n"
        "- **Alarms ingested:** 7 | **Acknowledged:** 6 | **Resolved:** 2\n"
        "- **MTTR:** 22 minit\n"
        "- **Cluster aktif:** 1 (MW investigation, suppression aktif sehingga 17:23)\n\n"
        "Sekian operasi yang siap dari sebelah saya. Adakah ada apa-apa lagi?"
    ))
    msgs.append(user(
        "Cukup. Romba nandri, terima kasih banyak Encik, atas korelasi dan suppression. "
        "Saya akan brief shift malam pasal MW investigation. Selamat petang."
    ))
    msgs.append(assistant(
        "Sama-sama Encik Ravi Kumar. Vanakkam dan terima kasih atas kerjasama dalam menangani 504 timeout enjin korelasi tadi, "
        "ditambah amaran kuota evidence yang flagged proaktif. Selamat menjalankan hand-off shift malam. Selamat petang."
    ))

    meta = build_metadata(I, "tamil", 13,
        [
            {"http_status": 504, "service": "correlation-api", "kind": "gateway_timeout", "recovered": True, "via": "search-alarms-then-retry-with-checkpoint"},
            {"http_status": 200, "service": "evidence-api", "kind": "quota_warning", "recovered": True, "via": "agent-flags-low-quota"},
            {"http_status": 200, "service": "correlation-api", "kind": "partial_success_with_checkpoint", "recovered": True, "via": "checkpoint-token-resume"}
        ],
        [
            {"turn": 10, "topic": "cafeteria curry chicken menu"}
        ],
        [
            "suggest_workaround_search_alarms_after_504",
            "verification_before_suppression_with_blast_radius",
            "proactive_quota_warning_on_evidence",
            "self_correction_retry_correlation_with_more_alarms"
        ],
        [
            "ingest_alarm_event", "correlate_alarms", "search_alarms",
            "acknowledge_alarms", "create_suppression_rule",
            "get_alarm_timeline", "alarm_attach_evidence", "alarm_get_kpi_metrics"
        ],
        "Tamil-leading Encik Ravi Kumar (NOC engineer); Bahasa+English+Tamil mix (Vanakkam, Aiyo, Aiyoyo, Aiyaa, romba nandri, appadi-aa, seri)."
    )
    # Need 2 OOCs — add second
    new_msgs = []
    inserted = False
    for m in msgs:
        if not inserted and m['role'] == 'user' and m.get('content','').startswith("Cukup. Romba nandri"):
            new_msgs.append(user(
                "Eh sebelum tutup — kalau saya nak claim parking petang ni untuk kereta saya kat NOC Penang, "
                "system mana? Office baru pindah floor."
            ))
            new_msgs.append(assistant(
                "Maaf Encik Ravi, tuntutan parking adalah di luar skop khidmat alarm management saya. Untuk perkara tersebut:\n\n"
                "- Sila guna portal **HRMy** (modul Facilities → Parking Claim) atau e-mel facilities@maxis.com.my.\n\n"
                "Kembali kepada operasi — adakah ada apa-apa lagi tentang alarm yang Encik perlu sebelum tutup?"
            ))
            inserted = True
        new_msgs.append(m)
    meta['metadata']['out_of_context_turns'].append({"turn": 12, "topic": "parking claim NOC Penang"})
    meta['metadata']['num_turns'] = sum(1 for m in new_msgs if m['role']=='user')
    return I, new_msgs, meta


# ---------------------------------------------------------------------------
# 84 - subscriber_lifecycle_cloud_exchange (Malay-leading)
# ---------------------------------------------------------------------------
def build_84():
    I = 84
    msgs = []

    msgs.append(user(
        "Selamat tengah hari. Saya Encik Faiz Mohd, network architect Maxis Cloud Connect, Cyberjaya. "
        "Hari ni saya nak setup cloud exchange connectivity untuk customer baharu — Hong Leong Bank. "
        "Mereka nak link KL HQ ke AWS ap-southeast-3 (Jakarta) dengan bandwidth 1Gbps redundant. "
        "Boleh discover dulu pilihan connectivity yang tersedia?"
    ))
    msgs.append(assistant_tool(
        "Selamat tengah hari Encik Faiz. Baik, saya discover pilihan sekarang.",
        [("call-84-001", "discover_connectivity_options", {
            "customer_id": "cust-hlb-7711",
            "endpoints": [
                {"endpoint_type": "on_prem_site", "site_id": "site-hlb-klhq-001", "city": "Kuala Lumpur"},
                {"endpoint_type": "cloud_region", "cloud_provider": "AWS", "region": "ap-southeast-3"}
            ],
            "requirements": {
                "bandwidth_mbps": 1000,
                "redundancy": "active_active",
                "latency_target_ms": 25
            }
        })]
    ))
    msgs.append(tool("call-84-001", "discover_connectivity_options", {
        "options": [
            {"option_id": "opt-klhq-aws-jkt-001", "topology": "dual_homed_via_cyberjaya_meet_me_room", "latency_ms_est": 18, "cost_band": "premium"},
            {"option_id": "opt-klhq-aws-jkt-002", "topology": "single_path_via_singapore_transit", "latency_ms_est": 32, "cost_band": "standard"}
        ],
        "_warning": "quota_remaining_today: 12 of 100 discovery calls. Plan accordingly."
    }))
    msgs.append(assistant(
        "Dua pilihan tersedia, Encik Faiz:\n\n"
        "1. `opt-klhq-aws-jkt-001` — dual-homed via Cyberjaya MMR, 18ms latency, **cost band premium**\n"
        "2. `opt-klhq-aws-jkt-002` — single-path via Singapore transit, 32ms (lebih dari target 25ms), standard\n\n"
        "Amaran kuota proaktif: hanya **12 daripada 100** discovery calls tinggal hari ini.\n\n"
        "Cadangan saya pilih option 1 sebab memenuhi target latency dan redundancy. Setuju?"
    ))
    msgs.append(user(
        "Setuju option 1. Buat service profile dengan compliance class `bank-negara-regulated` dan SLA tier `gold`."
    ))
    msgs.append(assistant_tool(
        "Baik.",
        [("call-84-002", "create_service_profile", {
            "customer_id": "cust-hlb-7711",
            "name": "HLB-KLHQ-AWS-JKT-Primary",
            "compliance_class": "bank-negara-regulated",
            "sla_tier": "gold",
            "data_classification": "confidential",
            "based_on_option_id": "opt-klhq-aws-jkt-001"
        })]
    ))
    msgs.append(tool("call-84-002", "create_service_profile", {
        "service_profile_id": "sp-hlb-klhq-aa11",
        "status": "active",
        "created_at": "2026-05-21T12:15:42+08:00",
        "compliance_class": "bank-negara-regulated",
        "sla_tier": "gold"
    }))
    msgs.append(assistant(
        "Service profile dicipta:\n\n"
        "- **service_profile_id:** `sp-hlb-klhq-aa11`\n\n"
        "Adakah Encik mahu saya request quote untuk profile ini?"
    ))
    msgs.append(user(
        "Ya, request quote. Term 36 bulan, billing monthly MYR."
    ))
    msgs.append(assistant_tool(
        "Baik.",
        [("call-84-003", "request_connectivity_quote", {
            "service_profile_id": "sp-hlb-klhq-aa11",
            "term_months": 36,
            "billing_frequency": "monthly",
            "currency": "MYR",
            "requested_by": {"user_id": "usr-faiz-arch-052"}
        })]
    ))
    msgs.append(tool("call-84-003", "request_connectivity_quote", {
        "error": {
            "http_status": 403,
            "code": "permission_denied",
            "message": "Quote generation for compliance_class='bank-negara-regulated' requires elevated scope 'fin_sector_quote_create'. Current user usr-faiz-arch-052 has only 'connectivity_quote_create'. Please request scope elevation or route to a finance-sector-certified agent.",
            "required_scopes": ["fin_sector_quote_create"],
            "trace_id": "trc-403-2026-05-21-12-17-aa"
        }
    }))
    msgs.append(assistant(
        "Maaf Encik Faiz, API balas **HTTP 403 Permission Denied**:\n\n"
        "- **Sebab:** Quote untuk `bank-negara-regulated` compliance class memerlukan scope khas `fin_sector_quote_create`. "
        "Pada masa ini akaun Encik hanya ada `connectivity_quote_create`.\n"
        "- **Trace ID:** `trc-403-2026-05-21-12-17-aa`\n\n"
        "Sebagai pemulihan, saya boleh **request approval** untuk eskalasi scope ke supervisor sektor kewangan. Adakah Encik nak teruskan?"
    ))
    msgs.append(user(
        "Ya tolong, request approval. Justifikasi: HLB account onboarding, mandatori untuk Q2 2026."
    ))
    msgs.append(assistant_tool(
        "Baik.",
        [("call-84-004", "cloud_exchange_subscription_request_approval", {
            "approval_type": "scope_elevation_fin_sector_quote_create",
            "scope": {"customer_id": "cust-hlb-7711", "service_profile_id": "sp-hlb-klhq-aa11"},
            "justification": "HLB account onboarding mandatory for Q2 2026; quote generation blocked by missing fin_sector_quote_create scope.",
            "requester": {"user_id": "usr-faiz-arch-052"},
            "urgency": "high"
        })]
    ))
    msgs.append(tool("call-84-004", "cloud_exchange_subscription_request_approval", {
        "approval_request_id": "appr-fin-bb22",
        "status": "pending",
        "approvers": [
            {"approver_id": "usr-supv-fin-009", "name": "***REDACTED-PII***", "role": "finance_sector_supervisor"}
        ],
        "submitted_at": "2026-05-21T12:18:30+08:00",
        "sla_minutes": 30
    }))
    msgs.append(assistant(
        "Approval request submitted:\n\n"
        "- **approval_request_id:** `appr-fin-bb22`\n"
        "- Status: pending | SLA: 30 minit\n\n"
        "Sambil tunggu approval, adakah Encik mahu saya validate quote feasibility (separate dari quote creation) "
        "supaya kita tahu kebolehan sebelum approval lulus?"
    ))
    msgs.append(user(
        "Ya bagus, buat validate dulu. Hmm sat, telefon anak masuk... [pause] OK done. Sambung."
    ))
    msgs.append(assistant_tool(
        "Baik Encik, saya tunggu tadi. Validate feasibility sekarang.",
        [("call-84-005", "validate_quote_feasibility", {
            "service_profile_id": "sp-hlb-klhq-aa11",
            "validation_focus": ["capacity_at_meet_me_room", "cross_connect_availability", "cloud_provider_port_availability"]
        })]
    ))
    msgs.append(tool("call-84-005", "validate_quote_feasibility", {
        "feasibility_score": 0.92,
        "feasibility_band": "high",
        "checks": [
            {"check": "capacity_at_meet_me_room", "status": "pass", "headroom_pct": 38},
            {"check": "cross_connect_availability", "status": "pass", "available_count": 12},
            {"check": "cloud_provider_port_availability", "status": "pass_with_warning", "note": "AWS ap-southeast-3 reports 2 ports available; recommend reserve immediately."}
        ]
    }))
    msgs.append(assistant(
        "Validation menggalakkan, Encik:\n\n"
        "- **feasibility_score:** 0.92 (high)\n"
        "- MMR capacity 38% headroom; 12 cross-connect tersedia\n"
        "- ⚠️ AWS port tinggal 2 — sistem cadang reserve segera bila approval lulus\n\n"
        "Adakah Encik mahu saya periksa dependency graph untuk profile ini, supaya kita tahu kesan ke perkhidmatan lain?"
    ))
    msgs.append(user(
        "Ya, dependency graph. Saya nak make sure tak ada conflict dengan setup HLB yang sedia ada."
    ))
    msgs.append(assistant_tool(
        "Baik.",
        [("call-84-006", "cloud_exchange_subscription_get_dependency_graph", {
            "scope": {"customer_id": "cust-hlb-7711", "service_profile_id": "sp-hlb-klhq-aa11"},
            "depth": 2,
            "include_inactive": False
        })]
    ))
    msgs.append(tool("call-84-006", "cloud_exchange_subscription_get_dependency_graph", {
        "nodes": [
            {"node_id": "sp-hlb-klhq-aa11", "type": "service_profile", "name": "HLB-KLHQ-AWS-JKT-Primary"},
            {"node_id": "site-hlb-klhq-001", "type": "site"},
            {"node_id": "mmr-cyberjaya-01", "type": "meet_me_room"},
            {"node_id": "aws-port-asean-jkt-77", "type": "cloud_port"}
        ],
        "edges": [
            {"from": "sp-hlb-klhq-aa11", "to": "site-hlb-klhq-001", "relation": "originates_at"},
            {"from": "sp-hlb-klhq-aa11", "to": "mmr-cyberjaya-01", "relation": "transits"},
            {"from": "mmr-cyberjaya-01", "to": "aws-port-asean-jkt-77", "relation": "egresses_to"}
        ],
        "potential_conflicts": []
    }))
    msgs.append(assistant(
        "Dependency graph clean, Encik:\n\n"
        "- 4 node: profile → site KL HQ → MMR Cyberjaya → AWS port Jakarta\n"
        "- **Tiada potential conflicts**\n\n"
        "Adakah Encik mahu saya teruskan dengan apa-apa lagi sambil menunggu approval?"
    ))
    msgs.append(user(
        "Eh sat — boleh tolong cadang lunch place sekitar Cyberjaya hari ni? Saya nak break sebentar."
    ))
    msgs.append(assistant(
        "Maaf Encik Faiz, cadangan tempat makan adalah di luar skop khidmat cloud exchange saya. Untuk hal tersebut:\n\n"
        "- Sila rujuk **GrabFood**, **foodpanda**, atau aplikasi peta dalaman pejabat **Maxis@Cyberjaya** untuk pilihan terdekat.\n\n"
        "Kembali kepada operasi — adakah Encik mahu saya semak status approval sekarang? Mungkin dah ada update."
    ))
    msgs.append(user(
        "Ya semak status approval."
    ))
    msgs.append(assistant_tool(
        "Baik.",
        [("call-84-007", "cloud_exchange_subscription_get_audit_log", {
            "scope": {"approval_request_id": "appr-fin-bb22"},
            "include_system_actors": True,
            "limit": 10
        })]
    ))
    msgs.append(tool("call-84-007", "cloud_exchange_subscription_get_audit_log", {
        "entries": [
            {"timestamp": "2026-05-21T12:18:30+08:00", "actor": {"id": "usr-faiz-arch-052", "type": "user"}, "action": "approval_request_submitted", "approval_request_id": "appr-fin-bb22"},
            {"timestamp": "2026-05-21T12:20:14+08:00", "actor": {"id": "usr-supv-fin-009", "type": "user", "name": "***REDACTED-PII***"}, "action": "approval_recorded", "decision": "approved", "comment": "Justification accepted; scope granted for 24h."}
        ],
        "total_entries": 2
    }))
    msgs.append(assistant(
        "Approval **diluluskan**, Encik:\n\n"
        "- 12:20:14 — Supervisor sektor kewangan (nama redact-PII, normal) **approved** dengan komen *\"Justification accepted; scope granted for 24h.\"*\n\n"
        "Saya boleh retry quote sekarang dengan scope yang baru dielevate. Setuju?"
    ))
    msgs.append(user(
        "Ya retry quote."
    ))
    msgs.append(assistant_tool(
        "Retry quote dengan scope baharu.",
        [("call-84-008", "request_connectivity_quote", {
            "service_profile_id": "sp-hlb-klhq-aa11",
            "term_months": 36,
            "billing_frequency": "monthly",
            "currency": "MYR",
            "requested_by": {"user_id": "usr-faiz-arch-052"},
            "approval_ref": "appr-fin-bb22"
        })]
    ))
    msgs.append(tool("call-84-008", "request_connectivity_quote", {
        "quote_id": "quo-hlb-klhq-cc33",
        "status": "draft",
        "total_mrc": {"amount": 48000.00, "currency": "MYR"},
        "total_nrc": {"amount": 18000.00, "currency": "MYR"},
        "expires_at": "2026-06-04T12:25:00+08:00"
    }))
    msgs.append(assistant(
        "Quote dijana:\n\n"
        "- **quote_id:** `quo-hlb-klhq-cc33`\n"
        "- **MRC:** RM 48,000/bulan | **NRC:** RM 18,000\n"
        "- Tamat: 4 Jun 2026\n\n"
        "Adakah Encik mahu submit order sekarang?"
    ))
    msgs.append(user(
        "Ya submit order, customer PO `HLB-PO-2026-05-CC-001`."
    ))
    msgs.append(assistant_tool(
        "Submit order.",
        [("call-84-009", "submit_connectivity_order", {
            "quote_id": "quo-hlb-klhq-cc33",
            "customer_po_number": "HLB-PO-2026-05-CC-001",
            "approval_ref": "appr-fin-bb22",
            "requested_by": {"user_id": "usr-faiz-arch-052"}
        })]
    ))
    msgs.append(tool("call-84-009", "submit_connectivity_order", {
        "order_id": "ord-hlb-klhq-dd44",
        "status": "accepted",
        "http_status": 202,
        "provisioning_job_id": "job-prov-dd44",
        "estimated_completion_minutes": 90,
        "polling_url": "/orders/ord-hlb-klhq-dd44/status",
        "webhook_supported": True
    }))
    msgs.append(assistant(
        "Order diterima sebagai background provisioning (**HTTP 202 Accepted**), Encik:\n\n"
        "- **order_id:** `ord-hlb-klhq-dd44`\n"
        "- **provisioning_job_id:** `job-prov-dd44`\n"
        "- ETA: 90 minit\n\n"
        "Saya cadang subscribe events. Setuju?"
    ))
    msgs.append(user(
        "Ya subscribe — webhook URL `https://maxis-cc-events.maxis.com.my/hooks/hlb`."
    ))
    msgs.append(assistant_tool(
        "Subscribe.",
        [("call-84-010", "cloud_exchange_subscription_subscribe_to_events", {
            "subscription_scope": {"order_id": "ord-hlb-klhq-dd44"},
            "subscribers": [
                {"channel": "webhook", "address": "https://maxis-cc-events.maxis.com.my/hooks/hlb"}
            ],
            "events": ["provisioning.started", "provisioning.completed", "provisioning.failed"],
            "delivery_options": {"retry_on_failure": True}
        })]
    ))
    msgs.append(tool("call-84-010", "cloud_exchange_subscription_subscribe_to_events", {
        "subscription_id": "subs-cc-hlb-ee55",
        "status": "active",
        "subscribers_confirmed": 1
    }))
    msgs.append(assistant(
        "Subscription aktif (`subs-cc-hlb-ee55`). Adakah Encik mahu saya semak order status sekarang?"
    ))
    msgs.append(user(
        "Ya semak."
    ))
    msgs.append(assistant_tool(
        "Baik.",
        [("call-84-011", "get_order_status", {
            "order_id": "ord-hlb-klhq-dd44"
        })]
    ))
    msgs.append(tool("call-84-011", "get_order_status", {
        "order_id": "ord-hlb-klhq-dd44",
        "status": "provisioning",
        "progress_pct": 12,
        "current_stage": "cross_connect_request_dispatched",
        "_warning": "Eventually consistent: cross-connect status from datacenter may lag up to 90 seconds."
    }))
    msgs.append(assistant(
        "Status sekarang, Encik:\n\n"
        "- Status: provisioning (12%)\n"
        "- Stage semasa: cross-connect request dispatched\n"
        "- ⚠️ Eventually-consistent: status cross-connect dari datacenter boleh terlewat hingga 90s.\n\n"
        "Sekian setakat ini. Adakah ada apa-apa lagi?"
    ))
    msgs.append(user(
        "Cukup dulu, terima kasih. Saya akan tunggu webhook 90 minit lagi. Selamat tengah hari."
    ))
    msgs.append(assistant(
        "Sama-sama Encik Faiz. Terima kasih atas kesabaran sepanjang panggilan, terutamanya dalam menangani 403 permission denied "
        "(diselesaikan dengan approval escalation), 202 async order provisioning, amaran kuota discovery, dan eventually-consistent "
        "warning cross-connect. Selamat tengah hari."
    ))

    meta = build_metadata(I, "malay", 13,
        [
            {"http_status": 403, "service": "quote-api", "kind": "permission_denied_scope", "recovered": True, "via": "approval-request-and-scope-elevation"},
            {"http_status": 202, "service": "order-api", "kind": "async_provisioning", "recovered": True, "via": "webhook-subscription"},
            {"http_status": 200, "service": "discovery-api", "kind": "quota_warning", "recovered": True, "via": "agent-flags-low-quota"},
            {"http_status": 200, "service": "status-api", "kind": "eventually_consistent", "recovered": True, "via": "agent-explains-90s-lag"},
            {"http_status": 200, "service": "audit-api", "kind": "pii_redaction", "recovered": True, "via": "agent-explains-redaction"}
        ],
        [
            {"turn": 9, "topic": "lunch place recommendation Cyberjaya"}
        ],
        [
            "proactive_quota_warning",
            "self_correction_after_permission_denied",
            "suggest_workaround_validate_feasibility_while_waiting",
            "explains_pii_redaction",
            "proactive_check_dependency_graph_before_quote"
        ],
        [
            "discover_connectivity_options", "create_service_profile",
            "request_connectivity_quote", "cloud_exchange_subscription_request_approval",
            "validate_quote_feasibility", "cloud_exchange_subscription_get_dependency_graph",
            "cloud_exchange_subscription_get_audit_log", "submit_connectivity_order",
            "cloud_exchange_subscription_subscribe_to_events", "get_order_status"
        ],
        "Malay-leading Encik Faiz (network architect); Bahasa primary; formal agent."
    )
    # second OOC
    new_msgs = []
    inserted = False
    for m in msgs:
        if not inserted and m['role'] == 'user' and m.get('content','').startswith("Cukup dulu, terima kasih. Saya akan tunggu webhook"):
            new_msgs.append(user(
                "Eh sebelum tutup — kalau saya nak claim mileage drive ke datacenter Cyberjaya Tower 3 minggu lepas, "
                "boleh nak guna sistem apa? Lupa link."
            ))
            new_msgs.append(assistant(
                "Maaf Encik Faiz, tuntutan mileage adalah di luar skop khidmat cloud exchange saya. Untuk hal tersebut:\n\n"
                "- Sila guna **WorkdayMy** (modul Expenses → Mileage) atau e-mel finance-claims@maxis.com.my.\n\n"
                "Kembali kepada operasi — adakah ada apa-apa lagi pasal HLB connectivity?"
            ))
            inserted = True
        new_msgs.append(m)
    meta['metadata']['out_of_context_turns'].append({"turn": 12, "topic": "mileage claim datacenter Cyberjaya"})
    meta['metadata']['num_turns'] = sum(1 for m in new_msgs if m['role']=='user')
    return I, new_msgs, meta


# Save below — placeholder for now to test
if __name__ == '__main__':
    for builder in [build_81_v2, build_82_v2, build_83, build_84]:
        I, msgs, meta = builder()
        out = {
            "conversation_id": f"myl-fnlib-extra-{I}",
            "workflow_name": meta['workflow_name'],
            "domain": meta['domain'],
            "messages": msgs,
            "metadata": meta['metadata']
        }
        # synthesize turn_details
        out['metadata']['turn_details'] = [
            {"turn": i+1, "intent": "auto-derived", "expected_functions": [], "complexity": "moderate"}
            for i in range(meta['metadata']['num_turns'])
        ]
        path = save(I, out)
        print('WROTE', path)
