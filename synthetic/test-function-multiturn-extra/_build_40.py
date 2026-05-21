#!/usr/bin/env python3
"""Build conversation 40 - alarm_notification_flow - Malay-leading."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from _gen import js, assistant, assistant_tool, user, tool, save

I = 40

msgs = []

# Turn 1: User opens
msgs.append(user(
    "Selamat pagi. Saya Encik Ahmad Faiz, NOC engineer shift pagi di Cyberjaya. "
    "Ada alarm baru masuk dari OSS Huawei untuk node BTS-KL-SBJ-117 — link transport down sejak 06:42 pagi. "
    "External alarm ID `EXT-HW-2026-05-21-007742`. Boleh ingest dulu ke sistem assurance kita?"
))

# Turn 1 assistant - calls ingest_alarm_event
msgs.append(assistant_tool(
    "Selamat pagi Encik Ahmad Faiz. Baik, saya ingest sekarang.",
    [("call-40-001", "ingest_alarm_event", {
        "external_alarm_id": "EXT-HW-2026-05-21-007742",
        "source": {"system_name": "OSS-Huawei", "vendor": "Huawei", "ne_id": "BTS-KL-SBJ-117", "region": "Selangor-Subang"},
        "alarm_details": {
            "severity": "major",
            "probable_cause": "transport_link_down",
            "specific_problem_code": "TRANSPORT_LOS",
            "alarm_type": "communication",
            "raised_at": "2026-05-21T06:42:18+08:00"
        }
    })]
))
msgs.append(tool("call-40-001", "ingest_alarm_event", {
    "error": {
        "http_status": 400,
        "code": "validation_error",
        "message": "alarm_details.raised_at must be in RFC 3339 with TZ offset; got string but missing required `event_payload` field at root.",
        "field_path": "event_payload",
        "trace_id": "trc-400-2026-05-21-06-43-aa"
    }
}))

# Turn 2 assistant explains
msgs.append(assistant(
    "Maaf Encik, API balas **HTTP 400 Validation Error** — payload kurang field wajib `event_payload`. "
    "Saya akan cuba semula dengan struktur lengkap (raw event payload disertakan). Mohon tunggu."
))

# Turn 2 actually user response not needed - merge: user must respond? Spec says 10-20 user turns. Let me re-structure.
# Actually structure: user turn -> assistant turn (with tool calls + tool responses + summary). One user message per "turn".
# Let me redo - user replies to acknowledge or push forward.

msgs.append(user("OK retry la, saya tunggu."))

msgs.append(assistant_tool(
    "Baik Encik. Retry dengan `event_payload` lengkap.",
    [("call-40-002", "ingest_alarm_event", {
        "external_alarm_id": "EXT-HW-2026-05-21-007742",
        "source": {"system_name": "OSS-Huawei", "vendor": "Huawei", "ne_id": "BTS-KL-SBJ-117", "region": "Selangor-Subang"},
        "alarm_details": {
            "severity": "major",
            "probable_cause": "transport_link_down",
            "specific_problem_code": "TRANSPORT_LOS",
            "alarm_type": "communication",
            "raised_at": "2026-05-21T06:42:18+08:00"
        },
        "event_payload": {
            "raw_text": "MAJOR: Transport LoS on optical port 1/0/3, peer NE unreachable, last seen 06:42:14",
            "metric_snapshots": {"rx_power_dbm": -38.2, "tx_power_dbm": 1.1}
        }
    })]
))
msgs.append(tool("call-40-002", "ingest_alarm_event", {
    "alarm_id": "alm-2026-05-21-bts117-99021",
    "normalized": True,
    "severity": "major",
    "created_at": "2026-05-21T06:43:11+08:00",
    "status": "open"
}))

msgs.append(assistant(
    "Alarm berjaya diingest, Encik:\n"
    "- **Alarm ID:** `alm-2026-05-21-bts117-99021` (severity major, status open)\n"
    "Adakah Encik mahu saya cuba korelasi alarm ini dengan incident sedia ada?"
))

# Turn: correlate
msgs.append(user(
    "Ya, sila correlate. Saya rasa mungkin ada alarm lain dari BTS-KL-SBJ-117 sebab masa yang sama outage Subang Jaya."
))

msgs.append(assistant_tool(
    "Baik, saya cuba korelasi.",
    [("call-40-003", "correlate_alarms_to_incident", {
        "alarm_ids": ["alm-2026-05-21-bts117-99021"],
        "correlation_strategy": "topology_and_time_window",
        "time_window": {"from": "2026-05-21T06:30:00+08:00", "to": "2026-05-21T06:55:00+08:00"},
        "topology_scope": {"region": "Selangor-Subang", "ne_ids": ["BTS-KL-SBJ-117"]}
    })]
))
msgs.append(tool("call-40-003", "correlate_alarms_to_incident", {
    "error": {
        "http_status": 504,
        "code": "gateway_timeout",
        "message": "Topology correlation engine timed out at 30s. Partial result available via checkpoint_token.",
        "checkpoint_token": "chk-corr-99021-aa01",
        "trace_id": "trc-504-2026-05-21-06-45-bb",
        "incident_id": "inc-504-corr-engine-2026-05-21"
    }
}))

msgs.append(assistant(
    "Maaf Encik, enjin korelasi mengalami **HTTP 504 Gateway Timeout** (incident_id `inc-504-corr-engine-2026-05-21`). "
    "Hasil separa tersedia dengan `checkpoint_token`. Sebagai fallback, saya cadang gunakan `search_alarms_advanced` "
    "untuk fetch alarm pada window 25 minit terdekat di region Selangor-Subang, kemudian retry korelasi dengan checkpoint. "
    "Encik setuju?"
))

msgs.append(user("Setuju. Cepat sikit, peak hour dah dekat — jam 8 trafik tinggi."))

msgs.append(assistant_tool(
    "Faham Encik, saya jalankan search dan retry korelasi serentak.",
    [
        ("call-40-004", "search_alarms_advanced", {
            "filters": {
                "region": "Selangor-Subang",
                "time_range": {"from": "2026-05-21T06:30:00+08:00", "to": "2026-05-21T06:55:00+08:00"},
                "severities": ["critical", "major"]
            },
            "page_size": 20
        }),
        ("call-40-005", "correlate_alarms_to_incident", {
            "alarm_ids": ["alm-2026-05-21-bts117-99021"],
            "correlation_strategy": "topology_and_time_window",
            "time_window": {"from": "2026-05-21T06:30:00+08:00", "to": "2026-05-21T06:55:00+08:00"},
            "topology_scope": {"region": "Selangor-Subang", "ne_ids": ["BTS-KL-SBJ-117"]},
            "checkpoint_token": "chk-corr-99021-aa01"
        })
    ]
))
msgs.append(tool("call-40-004", "search_alarms_advanced", {
    "data": [
        {"alarm_id": "alm-2026-05-21-bts117-99021", "severity": "major", "ne_id": "BTS-KL-SBJ-117"},
        {"alarm_id": "alm-2026-05-21-bts118-99022", "severity": "major", "ne_id": "BTS-KL-SBJ-118"},
        {"alarm_id": "alm-2026-05-21-rtr-99023", "severity": "critical", "ne_id": "RTR-AGG-SBJ-01"}
    ],
    "pagination": {"page_size": 20, "has_next_page": False, "total_count": 3}
}))
msgs.append(tool("call-40-005", "correlate_alarms_to_incident", {
    "incident_id": "inc-2026-05-21-sbj-aggrtr-44012",
    "correlation_id": "corr-sbj-aggrtr-aa01",
    "root_cause_hypothesis": "RTR-AGG-SBJ-01 uplink failure cascading to BTS-117 and BTS-118",
    "severity": "critical",
    "linked_alarms": 3
}))

msgs.append(assistant(
    "Korelasi berjaya, Encik:\n"
    "- **Incident ID:** `inc-2026-05-21-sbj-aggrtr-44012` (critical)\n"
    "- 3 alarms terikat — root cause hipotesis: `RTR-AGG-SBJ-01` uplink failure\n"
    "- 2 BTS (117 + 118) impacted hilir router itu\n"
    "Saya cadangkan evaluate notification policy untuk decide siapa perlu dimaklumkan."
))

msgs.append(user(
    "Yes evaluate policy. Subscriber list mesti termasuk on-call NOC team dan operations manager Cik Aishah."
))

msgs.append(assistant_tool(
    "Baik.",
    [("call-40-006", "evaluate_notification_policies", {
        "incident_id": "inc-2026-05-21-sbj-aggrtr-44012",
        "context": {
            "severity": "critical",
            "region": "Selangor-Subang",
            "time_of_day": "06:48 MYT",
            "is_business_hours": False
        }
    })]
))
msgs.append(tool("call-40-006", "evaluate_notification_policies", {
    "matched_policies": [
        {"policy_id": "pol-critical-noc-2026", "matches": True, "channels": ["sms", "email", "voice"]},
        {"policy_id": "pol-ops-manager-after-hours", "matches": True, "channels": ["sms", "voice"]}
    ],
    "subscribers_resolved": [
        {"subscriber_id": "sub-noc-oncall-001", "name": "NOC On-call Pool"},
        {"subscriber_id": "sub-aishah-opsmgr-014", "name": "Cik Aishah (Ops Manager)"}
    ]
}))

msgs.append(assistant(
    "Polisi padanan, Encik:\n"
    "- `pol-critical-noc-2026` → SMS + email + voice ke NOC pool\n"
    "- `pol-ops-manager-after-hours` → SMS + voice ke Cik Aishah\n"
    "Saya boleh teruskan create + send notification batch sekarang."
))

msgs.append(user(
    "Eh sat sat — anak saya panggil, kena hantar dia ke sekolah. Tunggu 2 minit. [pause] OK saya dah balik. Teruskan."
))

msgs.append(assistant_tool(
    "Baik Encik, saya teruskan sekarang.",
    [("call-40-007", "create_notification_batch", {
        "incident_id": "inc-2026-05-21-sbj-aggrtr-44012",
        "policy_ids": ["pol-critical-noc-2026", "pol-ops-manager-after-hours"],
        "subscriber_ids": ["sub-noc-oncall-001", "sub-aishah-opsmgr-014"],
        "message_template_id": "tmpl-critical-incident-bahasa-v3",
        "deduplicate_within_seconds": 600
    })]
))
msgs.append(tool("call-40-007", "create_notification_batch", {
    "notification_batch_id": "nbatch-2026-05-21-aggrtr-77001",
    "planned_count": 2,
    "channels_planned": ["sms", "email", "voice"],
    "status": "ready"
}))

msgs.append(assistant_tool(
    "Batch sedia. Saya hantar sekarang.",
    [("call-40-008", "send_notification_batch", {
        "notification_batch_id": "nbatch-2026-05-21-aggrtr-77001",
        "send_options": {"priority": "high", "retry_on_failure": True}
    })]
))
msgs.append(tool("call-40-008", "send_notification_batch", {
    "notification_batch_id": "nbatch-2026-05-21-aggrtr-77001",
    "results": [
        {"subscriber_id": "sub-noc-oncall-001", "channel": "sms", "notification_id": "ntf-sms-aa01", "status": "sent"},
        {"subscriber_id": "sub-noc-oncall-001", "channel": "email", "notification_id": "ntf-eml-aa02", "status": "sent"},
        {"subscriber_id": "sub-noc-oncall-001", "channel": "voice", "notification_id": "ntf-voc-aa03", "status": "failed", "error": "provider_5xx_voice_gateway"},
        {"subscriber_id": "sub-aishah-opsmgr-014", "channel": "sms", "notification_id": "ntf-sms-bb01", "status": "sent"},
        {"subscriber_id": "sub-aishah-opsmgr-014", "channel": "voice", "notification_id": "ntf-voc-bb02", "status": "sent"}
    ],
    "summary": {"sent": 4, "failed": 1, "queued": 0},
    "partial_success": True
}))

msgs.append(assistant(
    "Hasil **separa berjaya** (partial success), Encik:\n"
    "- ✅ Sent: 4 (SMS + email + voice ke Cik Aishah, SMS + email ke NOC pool)\n"
    "- ❌ Failed: 1 (voice call ke NOC pool — provider_5xx_voice_gateway)\n"
    "Saya boleh retry voice call sahaja, atau Encik mahu tinggalkan kerana 2 channel lain ke NOC dah sampai?"
))

msgs.append(user(
    "Retry voice — protokol kita kena triple-confirm critical incident. Cuba sekali lagi sahaja."
))

msgs.append(assistant_tool(
    "Baik Encik, retry voice failure sahaja.",
    [("call-40-009", "retry_failed_notifications", {
        "notification_batch_id": "nbatch-2026-05-21-aggrtr-77001",
        "notification_ids": ["ntf-voc-aa03"],
        "max_attempts": 1
    })]
))
msgs.append(tool("call-40-009", "retry_failed_notifications", {
    "results": [{"notification_id": "ntf-voc-aa03", "status": "sent", "retried_at": "2026-05-21T06:54:02+08:00"}],
    "summary": {"sent": 1, "failed": 0},
    "_warning": {"X-API-Deprecated": "retry_failed_notifications v1 sunset 2026-11-01. Migrate to v2 batch endpoint.", "sunset_date": "2026-11-01"}
}))

msgs.append(assistant(
    "Retry voice berjaya pada 06:54:02 MYT, Encik. Triple-confirm tercapai.\n\n"
    "⚠️ **Amaran deprecation proaktif:** API `retry_failed_notifications` v1 akan disunset pada **1 November 2026**. "
    "Saya cadangkan pasukan platform Encik rancang migrasi ke v2 batch endpoint."
))

# OOC turn 1
msgs.append(user(
    "Noted, saya akan forward ke platform team. Eh sebelum saya lupa — kafeteria HQ kita ada bukak ke jam 7 pagi? "
    "Saya nak grab nasi lemak sebelum standup."
))

msgs.append(assistant(
    "Maaf Encik Ahmad Faiz, hal makan dan operasi kafeteria adalah di luar skop khidmat assurance saya. "
    "Untuk maklumat tersebut, sila rujuk **portal Workplace Services** atau channel Slack `#facilities`. "
    "Kembali kepada incident — adakah Encik mahu saya pantau status notification, atau teruskan dengan acknowledge alarm?"
))

msgs.append(user(
    "Acknowledge la alarm tu — saya yang on-shift, saya yang ambil ownership. Tapi sebelum tu, "
    "check dulu status semua notification yang dah dihantar. Saya nak pastikan Cik Aishah dah dapat."
))

msgs.append(assistant_tool(
    "Baik, saya semak status notification semasa.",
    [("call-40-010", "get_notification_status", {
        "notification_ids": ["ntf-sms-aa01", "ntf-eml-aa02", "ntf-voc-aa03", "ntf-sms-bb01", "ntf-voc-bb02"]
    })]
))
msgs.append(tool("call-40-010", "get_notification_status", {
    "statuses": [
        {"notification_id": "ntf-sms-aa01", "status": "delivered", "delivered_at": "2026-05-21T06:50:14+08:00"},
        {"notification_id": "ntf-eml-aa02", "status": "delivered", "delivered_at": "2026-05-21T06:50:21+08:00"},
        {"notification_id": "ntf-voc-aa03", "status": "answered", "answered_at": "2026-05-21T06:54:12+08:00", "duration_seconds": 38},
        {"notification_id": "ntf-sms-bb01", "status": "delivered", "delivered_at": "2026-05-21T06:50:18+08:00"},
        {"notification_id": "ntf-voc-bb02", "status": "answered", "answered_at": "2026-05-21T06:51:02+08:00", "duration_seconds": 22}
    ],
    "quota_remaining_today": 6,
    "_warning": "quota_remaining_today is low (6 of 500 daily voice channel calls). Plan urgently."
}))

msgs.append(assistant(
    "Semua 5 notifications **delivered/answered** Encik:\n"
    "- Cik Aishah angkat voice call pada 06:51:02 (22s) — dia dah aware\n"
    "- NOC pool angkat voice retry pada 06:54:12 (38s)\n\n"
    "⚠️ **Amaran kuota proaktif:** Hanya **6 voice calls** tinggal untuk hari ini (dari 500). Sila rancang dengan berhati-hati — "
    "incident besar lagi hari ini akan kehabisan kuota. Saya boleh proceed acknowledge alarm sekarang?"
))

msgs.append(user(
    "Wow voice quota 6 sahaja? Saya nak escalate ni ke platform team. OK proceed acknowledge dulu. Saya Encik Ahmad Faiz, ID NOC `usr-ahmad-noc-201`."
))

msgs.append(assistant_tool(
    "Baik, saya acknowledge incident ini atas nama Encik Ahmad Faiz.",
    [("call-40-011", "acknowledge_alarm_or_incident", {
        "target": {"incident_id": "inc-2026-05-21-sbj-aggrtr-44012"},
        "acknowledger": {"user_id": "usr-ahmad-noc-201", "role": "noc_engineer"},
        "comment": "Acknowledged by morning shift NOC engineer. Investigating RTR-AGG-SBJ-01 uplink failure as root cause."
    })]
))
msgs.append(tool("call-40-011", "acknowledge_alarm_or_incident", {
    "acknowledgement_id": "ack-2026-05-21-44012-cc01",
    "acknowledged_at": "2026-05-21T06:55:30+08:00",
    "incident_status": "acknowledged",
    "ownership": {"user_id": "usr-ahmad-noc-201", "since": "2026-05-21T06:55:30+08:00"}
}))

msgs.append(assistant(
    "Incident telah di-acknowledge, Encik:\n"
    "- **Ack ID:** `ack-2026-05-21-44012-cc01`\n"
    "- Ownership: Encik Ahmad Faiz sejak 06:55:30 MYT\n"
    "Adakah Encik mahu saya buka timeline incident untuk konteks tambahan?"
))

msgs.append(user(
    "Yes, timeline penting. Dan satu lagi — kalau saya start fix uplink router tu, saya nak suppress notification batch baru "
    "supaya alarm cascading downstream tak spam team semasa kita troubleshoot."
))

msgs.append(assistant_tool(
    "Bijak Encik. Saya tarik timeline dan setup suppression selari.",
    [
        ("call-40-012", "get_alarm_and_incident_timeline", {
            "incident_id": "inc-2026-05-21-sbj-aggrtr-44012",
            "include_correlated_alarms": True,
            "limit": 30
        }),
        ("call-40-013", "suppress_or_cancel_notifications", {
            "target": {"incident_id": "inc-2026-05-21-sbj-aggrtr-44012"},
            "action": "suppress",
            "suppression_window": {"from": "2026-05-21T07:00:00+08:00", "to": "2026-05-21T08:30:00+08:00"},
            "reason": "Active troubleshooting on RTR-AGG-SBJ-01; downstream BTS cascading expected.",
            "requested_by": {"user_id": "usr-ahmad-noc-201"}
        })
    ]
))
msgs.append(tool("call-40-012", "get_alarm_and_incident_timeline", {
    "incident_id": "inc-2026-05-21-sbj-aggrtr-44012",
    "entries": [
        {"timestamp": "2026-05-21T06:42:18+08:00", "kind": "alarm.raised", "alarm_id": "alm-2026-05-21-rtr-99023", "summary": "RTR-AGG-SBJ-01 critical fan failure"},
        {"timestamp": "2026-05-21T06:42:55+08:00", "kind": "alarm.raised", "alarm_id": "alm-2026-05-21-bts117-99021"},
        {"timestamp": "2026-05-21T06:43:02+08:00", "kind": "alarm.raised", "alarm_id": "alm-2026-05-21-bts118-99022"},
        {"timestamp": "2026-05-21T06:46:11+08:00", "kind": "incident.created", "incident_id": "inc-2026-05-21-sbj-aggrtr-44012"},
        {"timestamp": "2026-05-21T06:55:30+08:00", "kind": "incident.acknowledged", "actor": "***REDACTED-PII***"}
    ],
    "_warning": "Eventually consistent: timeline may lag up to 30s behind real-time events"
}))
msgs.append(tool("call-40-013", "suppress_or_cancel_notifications", {
    "suppression_id": "supr-2026-05-21-44012-dd01",
    "scope": {"incident_id": "inc-2026-05-21-sbj-aggrtr-44012"},
    "active_until": "2026-05-21T08:30:00+08:00",
    "notifications_suppressed_so_far": 0,
    "status": "active"
}))

msgs.append(assistant(
    "Kedua-dua siap, Encik:\n\n"
    "**Timeline (5 entries terkini):**\n"
    "1. 06:42:18 — RTR fan failure critical (alm-...99023)\n"
    "2. 06:42:55 — BTS-117 transport down (alm-...99021)\n"
    "3. 06:43:02 — BTS-118 transport down (alm-...99022)\n"
    "4. 06:46:11 — Incident dibuka\n"
    "5. 06:55:30 — Acknowledged oleh Encik (nama dipaparkan sebagai `***REDACTED-PII***` kerana mod query, "
    "ini tingkah laku normal redaction).\n\n"
    "**Suppression aktif:** `supr-...dd01`, sehingga 08:30 MYT. Notification batch baru akan dipendam dalam window ini.\n\n"
    "(Nota: timeline mungkin lag sehingga 30s — eventually consistent.)"
))

msgs.append(user(
    "Bagus. Hmm — kena log subscription juga? Sebelum ni alarm BTS-117 ada subscription monitoring khusus, "
    "tapi saya tak ingat list. Boleh tunjuk?"
))

msgs.append(assistant_tool(
    "Baik.",
    [("call-40-014", "list_alarm_subscriptions", {
        "filters": {"ne_id": "BTS-KL-SBJ-117", "active_only": True},
        "page_size": 10
    })]
))
msgs.append(tool("call-40-014", "list_alarm_subscriptions", {
    "data": [
        {"subscription_id": "asub-bts117-001", "subscriber_id": "sub-noc-oncall-001", "channels": ["sms", "email"]},
        {"subscription_id": "asub-bts117-002", "subscriber_id": "sub-rftcap-team-77", "channels": ["email", "webhook"]}
    ],
    "pagination": {"page_size": 10, "has_next_page": False, "total_count": 2}
}))

msgs.append(assistant(
    "2 subscription aktif untuk BTS-117, Encik:\n"
    "- `asub-bts117-001` → NOC On-call (SMS + email)\n"
    "- `asub-bts117-002` → RF Capacity team (email + webhook)\n\n"
    "Subscription RF Capacity team mungkin perlu webhook tersebut, terutamanya jika mereka monitor utilisation. "
    "Tiada tindakan diperlukan kecuali Encik mahu pinda sesuatu."
))

# OOC turn 2
msgs.append(user(
    "OK, biarkan as-is. Sebenarnya saya nak tanya — anak buah saya minta tahu macam mana nak mohon internship "
    "kat NOC. Boleh share contact HR atau apa-apa link?"
))

msgs.append(assistant(
    "Maaf Encik, urusan pengambilan dan internship adalah di luar skop khidmat assurance NOC saya. "
    "Sila rujuk **portal kerjaya** di careers.company.com.my atau email **internship@company.com.my**. "
    "Kembali kepada operasi — adakah Encik mahu saya hantar Cik Aishah satu update komen tambahan, atau "
    "kita teruskan dengan tindakan teknikal?"
))

msgs.append(user(
    "Add comment pada incident — note untuk shift handover. 'RTR-AGG-SBJ-01 fan failure, troubleshooting in progress, "
    "downstream notifications suppressed till 08:30, escalate to vendor if not resolved by 07:30.' Itu sahaja."
))

msgs.append(assistant_tool(
    "Baik, saya add komen sekarang.",
    [("call-40-015", "add_alarm_comment", {
        "target": {"incident_id": "inc-2026-05-21-sbj-aggrtr-44012"},
        "comment_text": "RTR-AGG-SBJ-01 fan failure, troubleshooting in progress, downstream notifications suppressed till 08:30, escalate to vendor if not resolved by 07:30.",
        "author": {"user_id": "usr-ahmad-noc-201", "role": "noc_engineer"},
        "visibility": "internal"
    })]
))
msgs.append(tool("call-40-015", "add_alarm_comment", {
    "comment_id": "cmt-44012-ee01",
    "incident_id": "inc-2026-05-21-sbj-aggrtr-44012",
    "created_at": "2026-05-21T06:58:11+08:00",
    "visibility": "internal"
}))

msgs.append(assistant(
    "Komen handover disimpan (`cmt-44012-ee01`) pada 06:58:11. Shift seterusnya akan dapat akses.\n"
    "Adakah ada apa-apa lagi yang Encik mahu saya bantu?"
))

msgs.append(user(
    "Last thing — boleh saya schedule satu auto-job untuk re-check status incident ni pada jam 8 pagi, "
    "kalau still open auto-notify supervisor? Just in case saya stuck dengan vendor call."
))

msgs.append(assistant(
    "Boleh, Encik. Sebelum saya teruskan, izin saya jelaskan kesan supaya betul-betul jelas:\n"
    "1. Auto-job akan **berjalan sekali** pada 08:00 MYT, query status incident\n"
    "2. Jika masih `acknowledged` atau `open` → trigger notification escalation ke supervisor pool\n"
    "3. Jika status `resolved` → no-op\n"
    "4. Job ini boleh dibatalkan via `cancel_alarm_job` jika Encik selesai awal\n"
    "Sahkan?"
))

msgs.append(user("Sahkan, schedule."))

msgs.append(assistant_tool(
    "Baik, saya schedule sekarang.",
    [("call-40-016", "schedule_alarm_job", {
        "job_type": "status_recheck_and_escalate",
        "target": {"incident_id": "inc-2026-05-21-sbj-aggrtr-44012"},
        "schedule": {"run_at": "2026-05-21T08:00:00+08:00", "timezone": "Asia/Kuala_Lumpur"},
        "action_on_match": {
            "conditions": {"status_in": ["acknowledged", "open"]},
            "action": "send_escalation_notification",
            "notification_target": {"role": "noc_supervisor"}
        },
        "requested_by": {"user_id": "usr-ahmad-noc-201"}
    })]
))
msgs.append(tool("call-40-016", "schedule_alarm_job", {
    "status": "accepted",
    "http_status": 202,
    "alarm_job_id": "ajob-2026-05-21-44012-ff01",
    "scheduled_run_at": "2026-05-21T08:00:00+08:00",
    "polling_url": "/jobs/ajob-2026-05-21-44012-ff01/status",
    "webhook_supported": True
}))

msgs.append(assistant(
    "Job dijadual sebagai background job (**HTTP 202 Accepted**), Encik:\n"
    "- **Job ID:** `ajob-2026-05-21-44012-ff01`\n"
    "- Run at: 08:00 MYT\n"
    "- Webhook supported jika Encik nak subscribe nanti.\n"
    "Selamat troubleshoot Encik. Kalau ada apa-apa lagi sila hubungi kami semula."
))

msgs.append(user(
    "Terima kasih banyak. Saya rasa cukup dah. Selamat pagi."
))

msgs.append(assistant(
    "Sama-sama Encik Ahmad Faiz. Ringkasan sesi:\n"
    "- Alarm `alm-...99021` diingest, dikorelasi → incident `inc-...44012` (critical, 3 alarms)\n"
    "- Notification batch separa-berjaya (4 sent + 1 retry sent)\n"
    "- Incident di-acknowledge oleh Encik\n"
    "- Notifications suppressed till 08:30 untuk elak cascade spam\n"
    "- Auto-job `ajob-...ff01` dijadual 08:00 untuk recheck + escalate\n"
    "- 5 ralat sistem ditangani sepanjang panggilan: 400 validation, 504 timeout, partial success, deprecation warning, quota warning\n"
    "Selamat pagi dan semoga troubleshooting berjalan lancar."
))

obj = {
    "conversation_id": "myl-fnlib-extra-40",
    "workflow_name": "alarm_notification_flow",
    "domain": "telco_assurance/alarm_management",
    "messages": msgs,
    "metadata": {
        "num_turns": sum(1 for m in msgs if m['role'] == 'user'),
        "language_profile": "malay",
        "api_errors_simulated": [
            {"http_status": 400, "service": "ingest-api", "kind": "validation_error", "recovered": True, "via": "retry-with-event-payload"},
            {"http_status": 504, "service": "correlation-api", "kind": "gateway_timeout", "recovered": True, "via": "search-fallback-and-checkpoint-retry"},
            {"http_status": 200, "service": "send-batch-api", "kind": "partial_success", "recovered": True, "via": "retry-failed-voice-only"},
            {"http_status": 200, "service": "retry-api", "kind": "deprecation_warning", "recovered": True, "via": "agent-flags-sunset-date"},
            {"http_status": 200, "service": "status-api", "kind": "quota_warning", "recovered": True, "via": "agent-proactive-warning"},
            {"http_status": 200, "service": "timeline-api", "kind": "eventually_consistent", "recovered": True, "via": "agent-explains-lag"},
            {"http_status": 200, "service": "timeline-api", "kind": "pii_redaction", "recovered": True, "via": "agent-explains-normal-behaviour"},
            {"http_status": 202, "service": "schedule-job-api", "kind": "async_accepted", "recovered": True, "via": "polling-url-webhook"}
        ],
        "out_of_context_turns": [
            {"turn": 12, "topic": "cafeteria nasi lemak operating hours"},
            {"turn": 16, "topic": "internship application for relative"}
        ],
        "agent_edges_demonstrated": [
            "self_correction_after_validation_error",
            "suggests_workaround_after_504_timeout",
            "verification_before_scheduling_recheck_job",
            "proactive_quota_warning",
            "proactive_deprecation_warning",
            "explains_pii_redaction_normal_behaviour",
            "parallel_tool_calls_search_and_correlate"
        ],
        "user_messiness_demonstrated": [
            "multitask_interrupt_child_school_drop",
            "urgency_due_to_peak_hour",
            "out_of_context_cafeteria_query",
            "out_of_context_internship_query",
            "asks_proactive_safeguard_via_schedule"
        ],
        "functions_used": [
            "ingest_alarm_event", "correlate_alarms_to_incident", "search_alarms_advanced",
            "evaluate_notification_policies", "create_notification_batch", "send_notification_batch",
            "get_notification_status", "retry_failed_notifications", "acknowledge_alarm_or_incident",
            "get_alarm_and_incident_timeline", "suppress_or_cancel_notifications",
            "list_alarm_subscriptions", "add_alarm_comment", "schedule_alarm_job"
        ],
        "language_style": "Malay-leading NOC engineer (Encik Ahmad Faiz); formal Bahasa with occasional English/Manglish technical terms",
        "generated_at": "2026-05-21T07:05:00+08:00",
        "turn_details": []
    }
}

p = save(I, obj)
print('wrote', p, 'turns', obj['metadata']['num_turns'])
