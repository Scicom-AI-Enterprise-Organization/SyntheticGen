"""
Expander for test parquet rows 20..39.

Reads each row, expands `functions` to 30-50 entries, validates, writes to
/home/husein/ssd3/SyntheticGen/synthetic/test-function/{i}.json.
"""

import json
import os
import sys
from copy import deepcopy

import pandas as pd

PARQUET = "/home/husein/ssd3/SyntheticGen/synthetic/test-00000-of-00001.parquet"
OUT_DIR = "/home/husein/ssd3/SyntheticGen/synthetic/test-function"
os.makedirs(OUT_DIR, exist_ok=True)


def ref(key):
    return {"$ref": f"#/shared_entities/{key}"}


def pagination_props():
    return {
        "page": {"type": "integer", "minimum": 1, "description": "1-based page index"},
        "page_size": {"type": "integer", "minimum": 1, "maximum": 500, "description": "Records per page"},
        "sort": {
            "type": "array",
            "description": "Ordered sort directives",
            "items": {
                "type": "object",
                "properties": {
                    "field": {"type": "string", "description": "Sort field name"},
                    "direction": {"type": "string", "enum": ["asc", "desc"], "description": "Sort direction"},
                },
                "required": ["field"],
            },
        },
        "cursor": {"type": "string", "description": "Opaque continuation token for stable pagination"},
    }


def time_range_prop():
    return {
        "type": "object",
        "description": "Inclusive UTC time window",
        "properties": {
            "from": {"type": "string", "format": "date-time", "description": "Start of window (UTC, ISO8601)"},
            "to": {"type": "string", "format": "date-time", "description": "End of window (UTC, ISO8601)"},
            "timezone": {"type": "string", "description": "Reporting timezone (IANA name)"},
        },
        "required": ["from", "to"],
    }


def actor_prop():
    return {
        "type": "object",
        "description": "Caller identity used for audit and authorization",
        "properties": {
            "actor_id": {"type": "string", "description": "Stable identifier for the caller"},
            "actor_type": {"type": "string", "enum": ["user", "service", "scheduler", "system"], "description": "Caller principal kind"},
            "roles": {"type": "array", "items": {"type": "string"}, "description": "Roles asserted by the caller"},
            "session_id": {"type": "string", "description": "Session correlation id"},
            "ip_address": {"type": "string", "description": "Source IP address"},
            "user_agent": {"type": "string", "description": "Client user-agent string"},
        },
        "required": ["actor_id", "actor_type"],
    }


def notification_channel_prop():
    return {
        "type": "object",
        "description": "Channel-specific delivery configuration",
        "properties": {
            "type": {"type": "string", "enum": ["email", "sms", "webhook", "push", "voice", "chat"], "description": "Channel kind"},
            "address": {"type": "string", "description": "Destination address for the channel"},
            "locale": {"type": "string", "description": "BCP-47 locale for template rendering"},
            "headers": {
                "type": "object",
                "description": "Optional headers when channel is webhook",
                "additionalProperties": {"type": "string"},
            },
            "retry_policy": {
                "type": "object",
                "description": "Per-channel retry settings",
                "properties": {
                    "max_attempts": {"type": "integer", "minimum": 1, "description": "Maximum delivery attempts"},
                    "backoff_strategy": {"type": "string", "enum": ["fixed", "linear", "exponential"], "description": "Backoff curve between attempts"},
                    "initial_delay_ms": {"type": "integer", "minimum": 0, "description": "Initial delay before first retry"},
                },
            },
        },
        "required": ["type"],
    }


def schedule_prop():
    return {
        "type": "object",
        "description": "Recurring schedule specification",
        "properties": {
            "cadence": {"type": "string", "enum": ["one_off", "hourly", "daily", "weekly", "monthly", "cron"], "description": "Recurrence cadence"},
            "cron_expression": {"type": "string", "description": "Required when cadence=cron, 5- or 6-field cron"},
            "timezone": {"type": "string", "description": "IANA timezone for evaluation"},
            "start_at": {"type": "string", "format": "date-time", "description": "Earliest run time"},
            "end_at": {"type": "string", "format": "date-time", "description": "Latest run time (optional)"},
            "max_occurrences": {"type": "integer", "minimum": 1, "description": "Cap on total executions"},
            "jitter_seconds": {"type": "integer", "minimum": 0, "description": "Random delay applied per run"},
        },
        "required": ["cadence"],
    }


def filter_clause_prop():
    return {
        "type": "object",
        "description": "Boolean filter tree with nested AND/OR support",
        "properties": {
            "combinator": {"type": "string", "enum": ["and", "or"], "description": "How to combine clauses"},
            "predicates": {
                "type": "array",
                "description": "Leaf predicates at this level",
                "items": {
                    "type": "object",
                    "properties": {
                        "field": {"type": "string", "description": "Field path being filtered"},
                        "op": {"type": "string", "enum": ["eq", "ne", "gt", "gte", "lt", "lte", "in", "nin", "contains", "regex", "exists"], "description": "Comparison operator"},
                        "value": {"description": "Comparison value, type depends on op"},
                    },
                    "required": ["field", "op"],
                },
            },
            "groups": {
                "type": "array",
                "description": "Nested clause groups",
                "items": {"type": "object"},
            },
        },
    }


# ---------------------------------------------------------------------------
# Generic capability functions: parameterized by row context.
# Each builder receives a `ctx` dict with:
#   shared_entities (list of key names), primary_entity (str), workflow_name, domain
# It must return a function dict (without enforcing uniqueness; the outer loop names them).
# ---------------------------------------------------------------------------


def pick_entity(ctx, prefer):
    """Pick a shared entity reference key. Use the first preferred one that exists, else primary."""
    for p in prefer:
        if p in ctx["shared_entities"]:
            return p
    return ctx["primary_entity"]


def make_search(ctx):
    ent = ctx["primary_entity"]
    return {
        "name": f"search_{ctx['entity_slug']}s",
        "description": f"Faceted search across {ctx['entity_slug']} records with rich filters, full-text query, and faceted aggregations for {ctx['workflow_name']}.",
        "stage": "query",
        "parameters": {
            "type": "object",
            "properties": {
                "query_text": {"type": "string", "description": "Optional full-text query string"},
                "filters": filter_clause_prop(),
                "facets": {
                    "type": "array",
                    "description": "Facet definitions returned alongside results",
                    "items": {
                        "type": "object",
                        "properties": {
                            "field": {"type": "string", "description": "Facet field"},
                            "size": {"type": "integer", "minimum": 1, "maximum": 100, "description": "Top buckets to return"},
                            "include_other": {"type": "boolean", "description": "Whether to include an 'other' bucket"},
                        },
                        "required": ["field"],
                    },
                },
                "time_window": time_range_prop(),
                "include_archived": {"type": "boolean", "description": "Include archived records"},
                "highlight": {"type": "boolean", "description": "Return highlighted snippets when matching text"},
                **pagination_props(),
                "actor": actor_prop(),
            },
            "required": ["filters"],
        },
        "returns": f"A paginated result set of {ctx['entity_slug']} records with facet buckets, total count, and continuation cursor.",
    }


def make_list_by_status(ctx):
    ent = ctx["primary_entity"]
    return {
        "name": f"list_{ctx['entity_slug']}s_by_status",
        "description": f"List {ctx['entity_slug']} records filtered by lifecycle status with stable cursor pagination.",
        "stage": "query",
        "parameters": {
            "type": "object",
            "properties": {
                "statuses": {
                    "type": "array",
                    "description": "Statuses to include",
                    "items": {"type": "string", "enum": ["draft", "pending", "active", "blocked", "failed", "completed", "archived"]},
                    "minItems": 1,
                },
                "owner_ids": {"type": "array", "items": {"type": "string"}, "description": "Optional owner filter"},
                "tags": {"type": "array", "items": {"type": "string"}, "description": "Tag membership filter (any-of)"},
                "created_window": time_range_prop(),
                "updated_window": time_range_prop(),
                "include_metrics": {"type": "boolean", "description": "Attach summary metrics per record"},
                **pagination_props(),
                "actor": actor_prop(),
            },
            "required": ["statuses"],
        },
        "returns": f"A paginated list of {ctx['entity_slug']} records matching the requested statuses, optionally with summary metrics.",
    }


def make_get(ctx):
    ent = ctx["primary_entity"]
    return {
        "name": f"get_{ctx['entity_slug']}_detail",
        "description": f"Fetch a single {ctx['entity_slug']} record with optional expansion of related entities and versioned snapshots.",
        "stage": "query",
        "parameters": {
            "type": "object",
            "properties": {
                ent: ref(ent),
                "expand": {
                    "type": "array",
                    "description": "Related entity collections to inline",
                    "items": {"type": "string", "enum": ["history", "policies", "approvals", "comments", "attachments", "dependencies", "metrics"]},
                },
                "as_of": {"type": "string", "format": "date-time", "description": "Read the record as of this point in time"},
                "version_id": {"type": "string", "description": "Specific version to retrieve when versioning is enabled"},
                "fields": {"type": "array", "items": {"type": "string"}, "description": "Sparse fieldset selection"},
                "actor": actor_prop(),
            },
            "required": [ent],
        },
        "returns": f"A {ctx['entity_slug']} record with the requested expansions and version metadata.",
    }


def make_bulk_create(ctx):
    ent = ctx["primary_entity"]
    return {
        "name": f"bulk_create_{ctx['entity_slug']}s",
        "description": f"Submit a batch of {ctx['entity_slug']} records for creation, with idempotency keys and partial-success reporting.",
        "stage": "bulk",
        "parameters": {
            "type": "object",
            "properties": {
                "items": {
                    "type": "array",
                    "minItems": 1,
                    "maxItems": 500,
                    "description": "Records to create",
                    "items": {
                        "type": "object",
                        "properties": {
                            "idempotency_key": {"type": "string", "description": "Caller-generated dedupe key"},
                            "payload": {"type": "object", "description": "Free-form record body validated server-side"},
                            "tags": {"type": "array", "items": {"type": "string"}, "description": "Tags applied to the new record"},
                        },
                        "required": ["idempotency_key", "payload"],
                    },
                },
                "on_error": {"type": "string", "enum": ["abort", "skip", "isolate"], "description": "Batch error handling strategy"},
                "dry_run": {"type": "boolean", "description": "Validate only, do not persist"},
                "trace_id": {"type": "string", "description": "Correlation id propagated across the batch"},
                "actor": actor_prop(),
            },
            "required": ["items"],
        },
        "returns": "A per-item outcome list with created identifiers, validation errors, and batch-level statistics.",
    }


def make_bulk_update(ctx):
    ent = ctx["primary_entity"]
    return {
        "name": f"bulk_update_{ctx['entity_slug']}s",
        "description": f"Apply partial updates to many {ctx['entity_slug']} records in a single transactional batch.",
        "stage": "bulk",
        "parameters": {
            "type": "object",
            "properties": {
                "selector": filter_clause_prop(),
                "patch": {
                    "type": "object",
                    "description": "JSON merge-patch applied to every matched record",
                    "additionalProperties": True,
                },
                "expected_version": {"type": "integer", "minimum": 0, "description": "Optimistic concurrency token"},
                "max_records": {"type": "integer", "minimum": 1, "maximum": 10000, "description": "Safety cap on affected rows"},
                "dry_run": {"type": "boolean", "description": "Compute affected count without applying changes"},
                "reason": {"type": "string", "description": "Audit-visible reason for the change"},
                "actor": actor_prop(),
            },
            "required": ["selector", "patch", "reason"],
        },
        "returns": "Affected record count, sampled previews, and any per-record errors.",
    }


def make_bulk_delete(ctx):
    return {
        "name": f"bulk_archive_{ctx['entity_slug']}s",
        "description": f"Soft-archive {ctx['entity_slug']} records matching a selector with optional grace period before purge.",
        "stage": "bulk",
        "parameters": {
            "type": "object",
            "properties": {
                "selector": filter_clause_prop(),
                "grace_period_days": {"type": "integer", "minimum": 0, "maximum": 365, "description": "Days before records become purge-eligible"},
                "preserve_audit": {"type": "boolean", "description": "Keep audit trail even after purge"},
                "reason_code": {"type": "string", "enum": ["obsolete", "duplicate", "compliance", "manual"], "description": "Standardised archive reason"},
                "reason_notes": {"type": "string", "description": "Free-form notes attached to audit"},
                "dry_run": {"type": "boolean", "description": "Compute affected count without applying"},
                "actor": actor_prop(),
            },
            "required": ["selector", "reason_code"],
        },
        "returns": "Archive operation summary including matched count, scheduled purge date, and any blockers.",
    }


def make_bulk_export(ctx):
    return {
        "name": f"export_{ctx['entity_slug']}s",
        "description": f"Asynchronously export a filtered slice of {ctx['entity_slug']} records to the configured object store.",
        "stage": "bulk",
        "parameters": {
            "type": "object",
            "properties": {
                "selector": filter_clause_prop(),
                "format": {"type": "string", "enum": ["json", "ndjson", "csv", "parquet"], "description": "Output encoding"},
                "compression": {"type": "string", "enum": ["none", "gzip", "zstd"], "description": "Compression algorithm"},
                "destination": {
                    "type": "object",
                    "description": "Where the export should be delivered",
                    "properties": {
                        "type": {"type": "string", "enum": ["s3", "gcs", "azure_blob", "sftp", "http"], "description": "Destination kind"},
                        "uri": {"type": "string", "description": "Destination URI"},
                        "credentials_ref": {"type": "string", "description": "Pointer to stored credentials"},
                        "encryption": {
                            "type": "object",
                            "description": "Optional encryption settings",
                            "properties": {
                                "algorithm": {"type": "string", "enum": ["aes256", "kms", "pgp"], "description": "Algorithm to use"},
                                "key_ref": {"type": "string", "description": "Key reference"},
                            },
                            "required": ["algorithm"],
                        },
                    },
                    "required": ["type", "uri"],
                },
                "include_fields": {"type": "array", "items": {"type": "string"}, "description": "Sparse field projection"},
                "max_records": {"type": "integer", "minimum": 1, "description": "Optional cap on rows exported"},
                "actor": actor_prop(),
            },
            "required": ["selector", "format", "destination"],
        },
        "returns": "An export job descriptor with status, destination URI, and progress callbacks.",
    }


def make_subscribe_webhook(ctx):
    return {
        "name": f"subscribe_{ctx['entity_slug']}_events",
        "description": f"Register a webhook subscription for {ctx['entity_slug']} lifecycle events with HMAC signing and replay protection.",
        "stage": "subscribe",
        "parameters": {
            "type": "object",
            "properties": {
                "event_types": {
                    "type": "array",
                    "minItems": 1,
                    "items": {"type": "string"},
                    "description": "Event type names to receive",
                },
                "filter": filter_clause_prop(),
                "endpoint": {
                    "type": "object",
                    "description": "Receiving endpoint configuration",
                    "properties": {
                        "url": {"type": "string", "description": "HTTPS endpoint that receives events"},
                        "signing_secret_ref": {"type": "string", "description": "Reference to the HMAC signing secret"},
                        "tls_verify": {"type": "boolean", "description": "Whether to validate the server certificate"},
                        "headers": {"type": "object", "additionalProperties": {"type": "string"}, "description": "Extra headers per delivery"},
                    },
                    "required": ["url"],
                },
                "delivery": {
                    "type": "object",
                    "description": "Delivery semantics",
                    "properties": {
                        "ordering": {"type": "string", "enum": ["best_effort", "ordered_per_key", "global_order"], "description": "Required ordering guarantee"},
                        "deduplicate_window_seconds": {"type": "integer", "minimum": 0, "description": "Duplicate-suppression window"},
                        "max_in_flight": {"type": "integer", "minimum": 1, "description": "Concurrency cap"},
                    },
                },
                "labels": {"type": "object", "additionalProperties": {"type": "string"}, "description": "Subscription labels"},
                "actor": actor_prop(),
            },
            "required": ["event_types", "endpoint"],
        },
        "returns": "A subscription handle including subscription_id, verification status, and current delivery health.",
    }


def make_unsubscribe(ctx):
    return {
        "name": f"unsubscribe_{ctx['entity_slug']}_events",
        "description": f"Disable or delete a previously created {ctx['entity_slug']} event subscription.",
        "stage": "subscribe",
        "parameters": {
            "type": "object",
            "properties": {
                "subscription_id": {"type": "string", "description": "Subscription to terminate"},
                "mode": {"type": "string", "enum": ["pause", "resume", "delete"], "description": "Lifecycle transition"},
                "drain_seconds": {"type": "integer", "minimum": 0, "description": "Grace period to flush in-flight events"},
                "reason": {"type": "string", "description": "Audit-visible reason"},
                "actor": actor_prop(),
            },
            "required": ["subscription_id", "mode"],
        },
        "returns": "Final subscription state and any undelivered event counts at the time of termination.",
    }


def make_audit_history(ctx):
    ent = ctx["primary_entity"]
    return {
        "name": f"get_{ctx['entity_slug']}_audit_history",
        "description": f"Retrieve the chronological audit log for a {ctx['entity_slug']} including who changed what and when.",
        "stage": "audit",
        "parameters": {
            "type": "object",
            "properties": {
                ent: ref(ent),
                "time_window": time_range_prop(),
                "event_categories": {
                    "type": "array",
                    "items": {"type": "string", "enum": ["create", "update", "delete", "approve", "reject", "execute", "rollback", "access"]},
                    "description": "Audit event categories to include",
                },
                "include_payload_diff": {"type": "boolean", "description": "Inline before/after field diffs"},
                "actor_filter": {"type": "array", "items": {"type": "string"}, "description": "Restrict to specific actor ids"},
                **pagination_props(),
                "actor": actor_prop(),
            },
            "required": [ent],
        },
        "returns": "An ordered list of audit entries with diffs, actor metadata, and correlation ids.",
    }


def make_changelog_query(ctx):
    return {
        "name": f"query_{ctx['entity_slug']}_changelog",
        "description": f"Query the cross-record changelog for {ctx['workflow_name']} with field-level filters.",
        "stage": "audit",
        "parameters": {
            "type": "object",
            "properties": {
                "selector": filter_clause_prop(),
                "fields_changed": {"type": "array", "items": {"type": "string"}, "description": "Restrict to changes touching these fields"},
                "time_window": time_range_prop(),
                "group_by": {"type": "string", "enum": ["actor", "entity", "day", "field"], "description": "Aggregation dimension"},
                **pagination_props(),
                "actor": actor_prop(),
            },
            "required": ["time_window"],
        },
        "returns": "Aggregated changelog rows or detail entries depending on group_by, plus totals.",
    }


def make_schedule_create(ctx):
    return {
        "name": f"schedule_{ctx['entity_slug']}_job",
        "description": f"Create a recurring or one-off scheduled job that runs a {ctx['workflow_name']} operation.",
        "stage": "schedule",
        "parameters": {
            "type": "object",
            "properties": {
                "operation": {"type": "string", "description": "Operation name to invoke when the schedule fires"},
                "input_template": {"type": "object", "description": "Parameters passed to the operation, with templating", "additionalProperties": True},
                "schedule": schedule_prop(),
                "owner_id": {"type": "string", "description": "Owning principal for the schedule"},
                "labels": {"type": "object", "additionalProperties": {"type": "string"}, "description": "Schedule labels"},
                "failure_policy": {
                    "type": "object",
                    "description": "What to do when a run fails",
                    "properties": {
                        "on_failure": {"type": "string", "enum": ["retry", "skip", "halt", "alert"], "description": "Per-failure action"},
                        "max_failures": {"type": "integer", "minimum": 1, "description": "Pause schedule after this many failures"},
                        "alert_channel": {"type": "string", "description": "Channel id to alert on failure"},
                    },
                },
                "actor": actor_prop(),
            },
            "required": ["operation", "schedule"],
        },
        "returns": "A schedule descriptor including schedule_id, next run time, and validation issues.",
    }


def make_schedule_pause(ctx):
    return {
        "name": f"pause_{ctx['entity_slug']}_schedule",
        "description": f"Temporarily pause a scheduled {ctx['workflow_name']} job without deleting its history.",
        "stage": "schedule",
        "parameters": {
            "type": "object",
            "properties": {
                "schedule_id": {"type": "string", "description": "Schedule to pause"},
                "until": {"type": "string", "format": "date-time", "description": "Optional auto-resume time"},
                "reason": {"type": "string", "description": "Audit-visible reason"},
                "actor": actor_prop(),
            },
            "required": ["schedule_id", "reason"],
        },
        "returns": "Updated schedule status and prior pause history.",
    }


def make_dry_run(ctx):
    return {
        "name": f"simulate_{ctx['entity_slug']}_execution",
        "description": f"Run a dry-run simulation of a {ctx['workflow_name']} execution path without producing side effects.",
        "stage": "simulate",
        "parameters": {
            "type": "object",
            "properties": {
                "scenario": {
                    "type": "object",
                    "description": "Scenario inputs",
                    "properties": {
                        "name": {"type": "string", "description": "Scenario label"},
                        "seed": {"type": "integer", "description": "Deterministic seed for stochastic steps"},
                        "fixtures": {"type": "object", "description": "Stubbed external responses", "additionalProperties": True},
                    },
                    "required": ["name"],
                },
                "target_steps": {"type": "array", "items": {"type": "string"}, "description": "Optional restriction to specific steps"},
                "max_steps": {"type": "integer", "minimum": 1, "description": "Cap on simulated steps"},
                "include_side_effect_plan": {"type": "boolean", "description": "Return the side effects that would have been emitted"},
                "actor": actor_prop(),
            },
            "required": ["scenario"],
        },
        "returns": "Simulation transcript with predicted outcome, side-effect plan, and assertions checked.",
    }


def make_preview(ctx):
    return {
        "name": f"preview_{ctx['entity_slug']}_change",
        "description": f"Compute a preview of how a proposed change would affect a {ctx['entity_slug']} prior to commit.",
        "stage": "simulate",
        "parameters": {
            "type": "object",
            "properties": {
                ctx["primary_entity"]: ref(ctx["primary_entity"]),
                "proposed_patch": {"type": "object", "description": "Merge-patch to apply for preview", "additionalProperties": True},
                "show_dependencies": {"type": "boolean", "description": "Whether to compute downstream impact"},
                "evaluate_policies": {"type": "boolean", "description": "Run policy engine against the proposed state"},
                "actor": actor_prop(),
            },
            "required": [ctx["primary_entity"], "proposed_patch"],
        },
        "returns": "A preview document with field diffs, policy verdicts, and dependency impact.",
    }


def make_approval_submit(ctx):
    return {
        "name": f"submit_{ctx['entity_slug']}_for_approval",
        "description": f"Submit a {ctx['entity_slug']} for review with configurable approver routing and SLA targets.",
        "stage": "approval",
        "parameters": {
            "type": "object",
            "properties": {
                ctx["primary_entity"]: ref(ctx["primary_entity"]),
                "approval_chain": {
                    "type": "array",
                    "minItems": 1,
                    "description": "Ordered approval steps",
                    "items": {
                        "type": "object",
                        "properties": {
                            "step_name": {"type": "string", "description": "Human-readable step label"},
                            "approver_group": {"type": "string", "description": "Group or role authorised at this step"},
                            "quorum": {"type": "integer", "minimum": 1, "description": "Approvals required at this step"},
                            "sla_minutes": {"type": "integer", "minimum": 1, "description": "SLA before escalation"},
                            "escalation_policy_id": {"type": "string", "description": "Policy invoked on SLA breach"},
                        },
                        "required": ["step_name", "approver_group", "quorum"],
                    },
                },
                "justification": {"type": "string", "description": "Reason the change is required"},
                "evidence_refs": {"type": "array", "items": {"type": "string"}, "description": "Attached evidence document ids"},
                "deadline": {"type": "string", "format": "date-time", "description": "Hard deadline for approval"},
                "actor": actor_prop(),
            },
            "required": [ctx["primary_entity"], "approval_chain", "justification"],
        },
        "returns": "Approval workflow handle with approval_id, current step, and projected completion time.",
    }


def make_approval_decision(ctx):
    return {
        "name": f"record_{ctx['entity_slug']}_approval_decision",
        "description": f"Record an approve/reject/recuse decision for a pending {ctx['entity_slug']} approval step.",
        "stage": "approval",
        "parameters": {
            "type": "object",
            "properties": {
                "approval_id": {"type": "string", "description": "Approval workflow id"},
                "step_name": {"type": "string", "description": "Step being decided"},
                "decision": {"type": "string", "enum": ["approve", "reject", "recuse", "request_changes"], "description": "Decision outcome"},
                "comments": {"type": "string", "description": "Free-form comments"},
                "conditions": {
                    "type": "array",
                    "description": "Conditions attached to a conditional approval",
                    "items": {
                        "type": "object",
                        "properties": {
                            "code": {"type": "string", "description": "Condition code"},
                            "due_by": {"type": "string", "format": "date-time", "description": "Deadline for the condition"},
                            "owner_id": {"type": "string", "description": "Owner accountable for the condition"},
                        },
                        "required": ["code"],
                    },
                },
                "actor": actor_prop(),
            },
            "required": ["approval_id", "step_name", "decision"],
        },
        "returns": "Updated approval state, next pending step, and any triggered automations.",
    }


def make_escalate(ctx):
    return {
        "name": f"escalate_{ctx['entity_slug']}",
        "description": f"Escalate a stuck or breached {ctx['entity_slug']} to a higher tier with paging and audit.",
        "stage": "escalate",
        "parameters": {
            "type": "object",
            "properties": {
                ctx["primary_entity"]: ref(ctx["primary_entity"]),
                "severity": {"type": "string", "enum": ["sev1", "sev2", "sev3", "sev4"], "description": "Escalation severity"},
                "target_team": {"type": "string", "description": "Team or rota receiving the escalation"},
                "reason": {"type": "string", "description": "Why the escalation is happening"},
                "sla_breach_minutes": {"type": "integer", "minimum": 0, "description": "Minutes past SLA, if applicable"},
                "page_oncall": {"type": "boolean", "description": "Trigger paging vs. just notification"},
                "context_refs": {"type": "array", "items": {"type": "string"}, "description": "Related artifact ids attached for context"},
                "actor": actor_prop(),
            },
            "required": [ctx["primary_entity"], "severity", "target_team", "reason"],
        },
        "returns": "Escalation record id, paged responders, and acknowledgement timer.",
    }


def make_comment_add(ctx):
    return {
        "name": f"add_{ctx['entity_slug']}_comment",
        "description": f"Append a comment, optionally with @mentions and visibility scope, to a {ctx['entity_slug']}.",
        "stage": "collaborate",
        "parameters": {
            "type": "object",
            "properties": {
                ctx["primary_entity"]: ref(ctx["primary_entity"]),
                "body": {"type": "string", "description": "Comment text in Markdown"},
                "mentions": {"type": "array", "items": {"type": "string"}, "description": "User ids mentioned in the body"},
                "visibility": {"type": "string", "enum": ["public", "internal", "restricted"], "description": "Audience scope"},
                "parent_comment_id": {"type": "string", "description": "Comment id this one replies to"},
                "labels": {"type": "array", "items": {"type": "string"}, "description": "Labels on the comment"},
                "attachments": {
                    "type": "array",
                    "description": "Inline attachments",
                    "items": {
                        "type": "object",
                        "properties": {
                            "kind": {"type": "string", "enum": ["file", "link", "snippet"], "description": "Attachment kind"},
                            "uri": {"type": "string", "description": "Pointer to the attachment payload"},
                            "media_type": {"type": "string", "description": "RFC 6838 media type"},
                        },
                        "required": ["kind"],
                    },
                },
                "actor": actor_prop(),
            },
            "required": [ctx["primary_entity"], "body"],
        },
        "returns": "Newly created comment record including comment_id and resolved mentions.",
    }


def make_attachment_upload(ctx):
    return {
        "name": f"attach_{ctx['entity_slug']}_evidence",
        "description": f"Upload an evidence file or link as an attachment to a {ctx['entity_slug']} with content hash and retention.",
        "stage": "evidence",
        "parameters": {
            "type": "object",
            "properties": {
                ctx["primary_entity"]: ref(ctx["primary_entity"]),
                "name": {"type": "string", "description": "Display name of the attachment"},
                "source": {
                    "type": "object",
                    "description": "Where the bytes come from",
                    "properties": {
                        "type": {"type": "string", "enum": ["inline", "object_store", "url"], "description": "Source kind"},
                        "content_base64": {"type": "string", "description": "Inline base64 bytes when type=inline"},
                        "uri": {"type": "string", "description": "Pointer when type=object_store or url"},
                        "media_type": {"type": "string", "description": "RFC 6838 media type"},
                        "sha256": {"type": "string", "description": "Pre-computed content hash"},
                    },
                    "required": ["type"],
                },
                "classification": {"type": "string", "enum": ["public", "internal", "confidential", "restricted"], "description": "Data classification"},
                "retention_days": {"type": "integer", "minimum": 1, "description": "Retention before automatic purge"},
                "tags": {"type": "array", "items": {"type": "string"}, "description": "Attachment tags"},
                "actor": actor_prop(),
            },
            "required": [ctx["primary_entity"], "name", "source"],
        },
        "returns": "Attachment descriptor including attachment_id, content hash, and stored URI.",
    }


def make_snapshot(ctx):
    return {
        "name": f"snapshot_{ctx['entity_slug']}_state",
        "description": f"Capture a point-in-time snapshot of a {ctx['entity_slug']} and its dependencies for restore or audit.",
        "stage": "snapshot",
        "parameters": {
            "type": "object",
            "properties": {
                ctx["primary_entity"]: ref(ctx["primary_entity"]),
                "include_dependencies": {"type": "boolean", "description": "Capture linked entities transitively"},
                "max_depth": {"type": "integer", "minimum": 1, "maximum": 10, "description": "Dependency traversal depth"},
                "purpose": {"type": "string", "enum": ["audit", "restore_point", "diff", "export"], "description": "Snapshot intent"},
                "retention_days": {"type": "integer", "minimum": 1, "description": "Retention before automatic purge"},
                "labels": {"type": "object", "additionalProperties": {"type": "string"}, "description": "Snapshot labels"},
                "actor": actor_prop(),
            },
            "required": [ctx["primary_entity"], "purpose"],
        },
        "returns": "Snapshot descriptor with snapshot_id, captured size, and storage URI.",
    }


def make_restore(ctx):
    return {
        "name": f"restore_{ctx['entity_slug']}_from_snapshot",
        "description": f"Restore a {ctx['entity_slug']} (and optionally dependencies) from a previously captured snapshot.",
        "stage": "recovery",
        "parameters": {
            "type": "object",
            "properties": {
                "snapshot_id": {"type": "string", "description": "Snapshot to restore from"},
                "target": {
                    "type": "object",
                    "description": "Where to restore",
                    "properties": {
                        "mode": {"type": "string", "enum": ["in_place", "new_record", "shadow"], "description": "Restore target mode"},
                        "new_owner_id": {"type": "string", "description": "Owner of the restored record when mode=new_record"},
                    },
                    "required": ["mode"],
                },
                "merge_strategy": {"type": "string", "enum": ["replace", "merge", "fail_on_conflict"], "description": "Conflict resolution"},
                "skip_validation": {"type": "boolean", "description": "Skip post-restore validators"},
                "dry_run": {"type": "boolean", "description": "Compute restore plan without applying"},
                "actor": actor_prop(),
            },
            "required": ["snapshot_id", "target"],
        },
        "returns": "Restore job descriptor with conflicts surfaced and final record id.",
    }


def make_metrics_summary(ctx):
    return {
        "name": f"get_{ctx['entity_slug']}_metrics_summary",
        "description": f"Compute summary KPIs for {ctx['workflow_name']} over a time window with optional segmentation.",
        "stage": "report",
        "parameters": {
            "type": "object",
            "properties": {
                "time_window": time_range_prop(),
                "granularity": {"type": "string", "enum": ["minute", "hour", "day", "week", "month"], "description": "Bucket size"},
                "segment_by": {"type": "array", "items": {"type": "string"}, "description": "Dimensions to break out"},
                "metrics": {
                    "type": "array",
                    "minItems": 1,
                    "items": {"type": "string"},
                    "description": "Metric names to compute (e.g. throughput, p95_latency, failure_rate)",
                },
                "filters": filter_clause_prop(),
                "compare_to_previous_period": {"type": "boolean", "description": "Include delta vs the previous equal-length window"},
                "actor": actor_prop(),
            },
            "required": ["time_window", "metrics"],
        },
        "returns": "A metrics document with per-bucket values, totals, and optional period-over-period deltas.",
    }


def make_dashboard_create(ctx):
    return {
        "name": f"create_{ctx['entity_slug']}_dashboard",
        "description": f"Define a dashboard layout combining charts and tables for {ctx['workflow_name']}.",
        "stage": "report",
        "parameters": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Dashboard display name"},
                "owner_id": {"type": "string", "description": "Owning user or team"},
                "panels": {
                    "type": "array",
                    "minItems": 1,
                    "description": "Panels to render",
                    "items": {
                        "type": "object",
                        "properties": {
                            "title": {"type": "string", "description": "Panel title"},
                            "type": {"type": "string", "enum": ["line", "bar", "stat", "table", "heatmap"], "description": "Visualisation type"},
                            "query": {"type": "object", "description": "Query spec, polymorphic by panel type", "additionalProperties": True},
                            "position": {
                                "type": "object",
                                "description": "Grid placement",
                                "properties": {
                                    "x": {"type": "integer", "minimum": 0, "description": "Column index"},
                                    "y": {"type": "integer", "minimum": 0, "description": "Row index"},
                                    "w": {"type": "integer", "minimum": 1, "description": "Width in columns"},
                                    "h": {"type": "integer", "minimum": 1, "description": "Height in rows"},
                                },
                                "required": ["x", "y", "w", "h"],
                            },
                        },
                        "required": ["title", "type", "query", "position"],
                    },
                },
                "shared_with": {"type": "array", "items": {"type": "string"}, "description": "Principal ids that can view"},
                "default_time_range": time_range_prop(),
                "actor": actor_prop(),
            },
            "required": ["name", "panels"],
        },
        "returns": "Dashboard descriptor including dashboard_id and resolved share list.",
    }


def make_policy_define(ctx):
    return {
        "name": f"define_{ctx['entity_slug']}_policy",
        "description": f"Create or version a policy controlling allowed {ctx['workflow_name']} behaviour.",
        "stage": "policy",
        "parameters": {
            "type": "object",
            "properties": {
                "policy_name": {"type": "string", "description": "Human-readable policy name"},
                "scope": {
                    "type": "object",
                    "description": "Where the policy applies",
                    "properties": {
                        "tenants": {"type": "array", "items": {"type": "string"}, "description": "Tenant ids"},
                        "environments": {"type": "array", "items": {"type": "string"}, "description": "Environment ids"},
                        "labels": {"type": "object", "additionalProperties": {"type": "string"}, "description": "Label matchers"},
                    },
                },
                "rules": {
                    "type": "array",
                    "minItems": 1,
                    "description": "Ordered rule list, first match wins",
                    "items": {
                        "type": "object",
                        "properties": {
                            "name": {"type": "string", "description": "Rule label"},
                            "when": filter_clause_prop(),
                            "effect": {"type": "string", "enum": ["allow", "deny", "require_approval", "rate_limit"], "description": "Rule effect"},
                            "params": {"type": "object", "additionalProperties": True, "description": "Effect parameters"},
                        },
                        "required": ["name", "when", "effect"],
                    },
                },
                "enforcement_mode": {"type": "string", "enum": ["enforce", "audit_only", "advisory"], "description": "How strictly the policy is applied"},
                "effective_from": {"type": "string", "format": "date-time", "description": "Earliest activation time"},
                "actor": actor_prop(),
            },
            "required": ["policy_name", "rules"],
        },
        "returns": "Policy version descriptor with policy_id, version_id, and validation report.",
    }


def make_policy_evaluate(ctx):
    return {
        "name": f"evaluate_{ctx['entity_slug']}_policies",
        "description": f"Evaluate the active {ctx['workflow_name']} policies against a candidate input and return verdicts.",
        "stage": "policy",
        "parameters": {
            "type": "object",
            "properties": {
                "candidate": {"type": "object", "description": "Input under evaluation", "additionalProperties": True},
                "policy_ids": {"type": "array", "items": {"type": "string"}, "description": "Optional explicit policy set"},
                "context": {
                    "type": "object",
                    "description": "Evaluation context",
                    "properties": {
                        "tenant_id": {"type": "string", "description": "Tenant scope"},
                        "environment_id": {"type": "string", "description": "Environment scope"},
                        "labels": {"type": "object", "additionalProperties": {"type": "string"}, "description": "Contextual labels"},
                    },
                },
                "explain": {"type": "boolean", "description": "Return per-rule trace"},
                "actor": actor_prop(),
            },
            "required": ["candidate"],
        },
        "returns": "Aggregate verdict, per-rule outcomes, and any obligations attached to the decision.",
    }


def make_dependency_link(ctx):
    return {
        "name": f"link_{ctx['entity_slug']}_dependencies",
        "description": f"Declare typed dependency links between a {ctx['entity_slug']} and related artifacts to drive impact analysis.",
        "stage": "manage",
        "parameters": {
            "type": "object",
            "properties": {
                ctx["primary_entity"]: ref(ctx["primary_entity"]),
                "links": {
                    "type": "array",
                    "minItems": 1,
                    "description": "Links to upsert",
                    "items": {
                        "type": "object",
                        "properties": {
                            "target_type": {"type": "string", "description": "Target entity type"},
                            "target_id": {"type": "string", "description": "Target entity id"},
                            "relation": {"type": "string", "enum": ["depends_on", "blocks", "supersedes", "duplicates", "related_to"], "description": "Relation kind"},
                            "metadata": {"type": "object", "additionalProperties": True, "description": "Free-form link metadata"},
                        },
                        "required": ["target_type", "target_id", "relation"],
                    },
                },
                "replace_existing": {"type": "boolean", "description": "Replace prior links of the same relations"},
                "actor": actor_prop(),
            },
            "required": [ctx["primary_entity"], "links"],
        },
        "returns": "Resulting link set with created, updated, and removed entries.",
    }


def make_dependency_get(ctx):
    return {
        "name": f"get_{ctx['entity_slug']}_dependency_graph",
        "description": f"Walk the dependency graph rooted at a {ctx['entity_slug']} up to a configurable depth.",
        "stage": "query",
        "parameters": {
            "type": "object",
            "properties": {
                ctx["primary_entity"]: ref(ctx["primary_entity"]),
                "max_depth": {"type": "integer", "minimum": 1, "maximum": 10, "description": "Traversal depth"},
                "direction": {"type": "string", "enum": ["upstream", "downstream", "both"], "description": "Traversal direction"},
                "relation_filter": {"type": "array", "items": {"type": "string"}, "description": "Restrict to given relation kinds"},
                "include_metrics": {"type": "boolean", "description": "Attach health metrics per node"},
                "actor": actor_prop(),
            },
            "required": [ctx["primary_entity"], "max_depth", "direction"],
        },
        "returns": "Dependency graph with nodes, edges, and aggregated impact summary.",
    }


def make_tag_management(ctx):
    return {
        "name": f"update_{ctx['entity_slug']}_tags",
        "description": f"Add, remove, or replace tags on a {ctx['entity_slug']} with idempotent semantics.",
        "stage": "manage",
        "parameters": {
            "type": "object",
            "properties": {
                ctx["primary_entity"]: ref(ctx["primary_entity"]),
                "add": {"type": "array", "items": {"type": "string"}, "description": "Tags to add"},
                "remove": {"type": "array", "items": {"type": "string"}, "description": "Tags to remove"},
                "replace": {"type": "array", "items": {"type": "string"}, "description": "If set, fully replaces existing tags"},
                "reason": {"type": "string", "description": "Audit-visible reason"},
                "actor": actor_prop(),
            },
            "required": [ctx["primary_entity"]],
        },
        "returns": "Final tag set after the operation.",
    }


def make_assign_owner(ctx):
    return {
        "name": f"assign_{ctx['entity_slug']}_owner",
        "description": f"Reassign primary ownership of a {ctx['entity_slug']} to a user or group with optional handoff notes.",
        "stage": "manage",
        "parameters": {
            "type": "object",
            "properties": {
                ctx["primary_entity"]: ref(ctx["primary_entity"]),
                "new_owner": {
                    "type": "object",
                    "description": "New owner reference",
                    "properties": {
                        "type": {"type": "string", "enum": ["user", "group", "service"], "description": "Owner kind"},
                        "id": {"type": "string", "description": "Owner id"},
                    },
                    "required": ["type", "id"],
                },
                "effective_from": {"type": "string", "format": "date-time", "description": "When the new ownership takes effect"},
                "handoff_notes": {"type": "string", "description": "Notes captured for the new owner"},
                "notify_previous_owner": {"type": "boolean", "description": "Send notification to the prior owner"},
                "actor": actor_prop(),
            },
            "required": [ctx["primary_entity"], "new_owner"],
        },
        "returns": "Updated ownership record and notification fan-out result.",
    }


def make_notification_send(ctx):
    return {
        "name": f"send_{ctx['entity_slug']}_notification",
        "description": f"Send a templated notification about a {ctx['entity_slug']} event across one or more channels.",
        "stage": "notify",
        "parameters": {
            "type": "object",
            "properties": {
                ctx["primary_entity"]: ref(ctx["primary_entity"]),
                "template_id": {"type": "string", "description": "Notification template id"},
                "variables": {"type": "object", "additionalProperties": True, "description": "Variables for template rendering"},
                "channels": {
                    "type": "array",
                    "minItems": 1,
                    "items": notification_channel_prop(),
                    "description": "Channels to deliver on",
                },
                "audience": {
                    "type": "object",
                    "description": "Who receives the notification",
                    "properties": {
                        "user_ids": {"type": "array", "items": {"type": "string"}, "description": "Explicit recipient user ids"},
                        "group_ids": {"type": "array", "items": {"type": "string"}, "description": "Recipient groups"},
                        "role_names": {"type": "array", "items": {"type": "string"}, "description": "Roles to expand at send time"},
                    },
                },
                "priority": {"type": "string", "enum": ["low", "normal", "high", "urgent"], "description": "Delivery priority"},
                "deduplicate_key": {"type": "string", "description": "Suppress duplicates with the same key"},
                "actor": actor_prop(),
            },
            "required": [ctx["primary_entity"], "template_id", "channels"],
        },
        "returns": "Per-channel delivery report with message ids and failure reasons where applicable.",
    }


def make_health_check(ctx):
    return {
        "name": f"healthcheck_{ctx['entity_slug']}",
        "description": f"Run synthetic health checks against a {ctx['entity_slug']} and aggregate probe results.",
        "stage": "monitor",
        "parameters": {
            "type": "object",
            "properties": {
                ctx["primary_entity"]: ref(ctx["primary_entity"]),
                "probes": {
                    "type": "array",
                    "minItems": 1,
                    "description": "Probes to execute",
                    "items": {
                        "type": "object",
                        "properties": {
                            "name": {"type": "string", "description": "Probe label"},
                            "kind": {"type": "string", "enum": ["http", "tcp", "dns", "synthetic_flow", "custom"], "description": "Probe kind"},
                            "timeout_ms": {"type": "integer", "minimum": 1, "description": "Per-probe timeout"},
                            "parameters": {"type": "object", "additionalProperties": True, "description": "Kind-specific parameters"},
                        },
                        "required": ["name", "kind"],
                    },
                },
                "parallelism": {"type": "integer", "minimum": 1, "maximum": 32, "description": "Concurrent probe execution"},
                "fail_fast": {"type": "boolean", "description": "Stop on first failed probe"},
                "actor": actor_prop(),
            },
            "required": [ctx["primary_entity"], "probes"],
        },
        "returns": "Per-probe results with latency, status, and an aggregate health verdict.",
    }


def make_rollback(ctx):
    return {
        "name": f"rollback_{ctx['entity_slug']}_change",
        "description": f"Revert a {ctx['entity_slug']} to a previous known-good version with optional dependency rollback.",
        "stage": "recovery",
        "parameters": {
            "type": "object",
            "properties": {
                ctx["primary_entity"]: ref(ctx["primary_entity"]),
                "target_version_id": {"type": "string", "description": "Version to roll back to"},
                "include_dependents": {"type": "boolean", "description": "Cascade rollback to dependents when safe"},
                "verify_after": {"type": "boolean", "description": "Run post-rollback verifiers"},
                "reason": {"type": "string", "description": "Audit-visible reason"},
                "approval_id": {"type": "string", "description": "Linked approval record, if required"},
                "actor": actor_prop(),
            },
            "required": [ctx["primary_entity"], "target_version_id", "reason"],
        },
        "returns": "Rollback job descriptor with verification status and post-state version id.",
    }


def make_import(ctx):
    return {
        "name": f"import_{ctx['entity_slug']}s",
        "description": f"Bulk import {ctx['entity_slug']} records from a source file with mapping and validation.",
        "stage": "bulk",
        "parameters": {
            "type": "object",
            "properties": {
                "source": {
                    "type": "object",
                    "description": "Where the import payload comes from",
                    "properties": {
                        "type": {"type": "string", "enum": ["object_store", "url", "inline"], "description": "Source kind"},
                        "uri": {"type": "string", "description": "Source URI when not inline"},
                        "content_base64": {"type": "string", "description": "Inline base64 payload"},
                        "format": {"type": "string", "enum": ["csv", "ndjson", "json", "parquet"], "description": "Payload encoding"},
                    },
                    "required": ["type", "format"],
                },
                "mapping": {
                    "type": "array",
                    "description": "Field mapping from source columns to target fields",
                    "items": {
                        "type": "object",
                        "properties": {
                            "source_field": {"type": "string", "description": "Source column or path"},
                            "target_field": {"type": "string", "description": "Target field name"},
                            "transform": {"type": "string", "enum": ["none", "lower", "upper", "trim", "iso_date", "json_parse"], "description": "Inline transformation"},
                        },
                        "required": ["source_field", "target_field"],
                    },
                },
                "on_error": {"type": "string", "enum": ["abort", "skip", "quarantine"], "description": "Error handling"},
                "dry_run": {"type": "boolean", "description": "Validate without writing"},
                "owner_id": {"type": "string", "description": "Owner assigned to imported records"},
                "actor": actor_prop(),
            },
            "required": ["source", "mapping"],
        },
        "returns": "Import job descriptor with row counts, sample errors, and quarantine location.",
    }


def make_dashboard_share(ctx):
    return {
        "name": f"share_{ctx['entity_slug']}_dashboard",
        "description": f"Adjust the share list and permissions on an existing {ctx['workflow_name']} dashboard.",
        "stage": "report",
        "parameters": {
            "type": "object",
            "properties": {
                "dashboard_id": {"type": "string", "description": "Dashboard to update"},
                "grants": {
                    "type": "array",
                    "description": "Grants to add",
                    "items": {
                        "type": "object",
                        "properties": {
                            "principal_type": {"type": "string", "enum": ["user", "group", "role", "public_link"], "description": "Grantee kind"},
                            "principal_id": {"type": "string", "description": "Grantee id (omit for public_link)"},
                            "permission": {"type": "string", "enum": ["view", "edit", "admin"], "description": "Permission level"},
                            "expires_at": {"type": "string", "format": "date-time", "description": "Optional grant expiry"},
                        },
                        "required": ["principal_type", "permission"],
                    },
                },
                "revoke": {"type": "array", "items": {"type": "string"}, "description": "Grant ids to remove"},
                "actor": actor_prop(),
            },
            "required": ["dashboard_id"],
        },
        "returns": "Updated share matrix and any expired grants pruned in the process.",
    }


def make_quota_set(ctx):
    return {
        "name": f"set_{ctx['entity_slug']}_quota",
        "description": f"Configure quota and rate-limit envelopes for {ctx['entity_slug']} usage per tenant or scope.",
        "stage": "policy",
        "parameters": {
            "type": "object",
            "properties": {
                "scope": {
                    "type": "object",
                    "description": "Quota scope",
                    "properties": {
                        "tenant_id": {"type": "string", "description": "Tenant id (omit for global)"},
                        "label_selector": {"type": "object", "additionalProperties": {"type": "string"}, "description": "Label-based scope"},
                    },
                },
                "limits": {
                    "type": "array",
                    "minItems": 1,
                    "description": "Limits to enforce",
                    "items": {
                        "type": "object",
                        "properties": {
                            "metric": {"type": "string", "description": "Metric to limit"},
                            "window_seconds": {"type": "integer", "minimum": 1, "description": "Sliding window length"},
                            "max_value": {"type": "number", "description": "Hard ceiling within window"},
                            "burst": {"type": "number", "description": "Allowed burst above sustained rate"},
                            "action_on_breach": {"type": "string", "enum": ["throttle", "reject", "queue", "alert_only"], "description": "Response when breached"},
                        },
                        "required": ["metric", "window_seconds", "max_value"],
                    },
                },
                "effective_from": {"type": "string", "format": "date-time", "description": "Activation time"},
                "actor": actor_prop(),
            },
            "required": ["limits"],
        },
        "returns": "Effective quota record with id, computed reset timestamps, and conflict warnings.",
    }


def make_dryrun_bulk(ctx):
    return {
        "name": f"validate_{ctx['entity_slug']}_batch",
        "description": f"Validate a batch of {ctx['entity_slug']} candidates against schema and policy without persisting them.",
        "stage": "simulate",
        "parameters": {
            "type": "object",
            "properties": {
                "candidates": {
                    "type": "array",
                    "minItems": 1,
                    "items": {"type": "object", "additionalProperties": True},
                    "description": "Candidate records to validate",
                },
                "rules": {"type": "array", "items": {"type": "string"}, "description": "Named validators to run"},
                "stop_on_first_error": {"type": "boolean", "description": "Halt on the first failing candidate"},
                "include_warnings": {"type": "boolean", "description": "Surface warning-level issues alongside errors"},
                "actor": actor_prop(),
            },
            "required": ["candidates"],
        },
        "returns": "Per-candidate validation outcome with errors, warnings, and policy verdicts.",
    }


def make_purge(ctx):
    return {
        "name": f"purge_{ctx['entity_slug']}_archive",
        "description": f"Permanently purge archived {ctx['entity_slug']} records beyond their retention with legal-hold awareness.",
        "stage": "cleanup",
        "parameters": {
            "type": "object",
            "properties": {
                "older_than": {"type": "string", "format": "date-time", "description": "Purge records archived before this time"},
                "scope": filter_clause_prop(),
                "respect_legal_hold": {"type": "boolean", "description": "Skip records under legal hold"},
                "dry_run": {"type": "boolean", "description": "Compute candidate set without purging"},
                "approval_id": {"type": "string", "description": "Linked approval id"},
                "actor": actor_prop(),
            },
            "required": ["older_than"],
        },
        "returns": "Purge summary including counts purged, skipped due to legal hold, and persisted audit refs.",
    }


def make_acknowledge(ctx):
    return {
        "name": f"acknowledge_{ctx['entity_slug']}_alert",
        "description": f"Acknowledge an open alert linked to a {ctx['entity_slug']} and optionally suppress duplicate alerts.",
        "stage": "monitor",
        "parameters": {
            "type": "object",
            "properties": {
                "alert_id": {"type": "string", "description": "Alert to acknowledge"},
                ctx["primary_entity"]: ref(ctx["primary_entity"]),
                "ack_note": {"type": "string", "description": "Operator note attached to the ack"},
                "suppress_for_minutes": {"type": "integer", "minimum": 0, "maximum": 1440, "description": "Suppress similar alerts for this many minutes"},
                "snooze_until": {"type": "string", "format": "date-time", "description": "Alternative to suppress_for_minutes"},
                "owner_handover_id": {"type": "string", "description": "User id taking ownership"},
                "actor": actor_prop(),
            },
            "required": ["alert_id"],
        },
        "returns": "Updated alert state, suppression window, and owner assignment.",
    }


def make_resolve_incident(ctx):
    return {
        "name": f"resolve_{ctx['entity_slug']}_incident",
        "description": f"Mark a {ctx['entity_slug']}-linked incident as resolved with root-cause classification.",
        "stage": "recovery",
        "parameters": {
            "type": "object",
            "properties": {
                "incident_id": {"type": "string", "description": "Incident to resolve"},
                ctx["primary_entity"]: ref(ctx["primary_entity"]),
                "root_cause": {
                    "type": "object",
                    "description": "Structured root cause",
                    "properties": {
                        "category": {"type": "string", "enum": ["software", "hardware", "config", "process", "third_party", "unknown"], "description": "Cause category"},
                        "summary": {"type": "string", "description": "One-line root-cause summary"},
                        "details": {"type": "string", "description": "Detailed explanation"},
                        "contributing_factors": {"type": "array", "items": {"type": "string"}, "description": "Contributing factor codes"},
                    },
                    "required": ["category", "summary"],
                },
                "follow_up_actions": {
                    "type": "array",
                    "description": "Actions to track after resolution",
                    "items": {
                        "type": "object",
                        "properties": {
                            "description": {"type": "string", "description": "What to do"},
                            "owner_id": {"type": "string", "description": "Owner"},
                            "due_by": {"type": "string", "format": "date-time", "description": "Due date"},
                        },
                        "required": ["description", "owner_id"],
                    },
                },
                "resolution_time": {"type": "string", "format": "date-time", "description": "When the incident was resolved"},
                "actor": actor_prop(),
            },
            "required": ["incident_id", "root_cause"],
        },
        "returns": "Closed incident record and any follow-up action ids created.",
    }


def make_compare_versions(ctx):
    return {
        "name": f"compare_{ctx['entity_slug']}_versions",
        "description": f"Compute a field-level diff between two versions of a {ctx['entity_slug']}.",
        "stage": "audit",
        "parameters": {
            "type": "object",
            "properties": {
                ctx["primary_entity"]: ref(ctx["primary_entity"]),
                "base_version_id": {"type": "string", "description": "Base version"},
                "target_version_id": {"type": "string", "description": "Version to compare against base"},
                "include_unchanged": {"type": "boolean", "description": "Include fields with no change"},
                "ignore_fields": {"type": "array", "items": {"type": "string"}, "description": "Fields to omit from the diff"},
                "actor": actor_prop(),
            },
            "required": [ctx["primary_entity"], "base_version_id", "target_version_id"],
        },
        "returns": "Structured diff with added, removed, and modified field entries.",
    }


def make_transfer(ctx):
    return {
        "name": f"transfer_{ctx['entity_slug']}_between_tenants",
        "description": f"Transfer a {ctx['entity_slug']} (and optionally related data) from one tenant to another with audit and approval.",
        "stage": "manage",
        "parameters": {
            "type": "object",
            "properties": {
                ctx["primary_entity"]: ref(ctx["primary_entity"]),
                "source_tenant_id": {"type": "string", "description": "Originating tenant"},
                "target_tenant_id": {"type": "string", "description": "Receiving tenant"},
                "include_dependencies": {"type": "boolean", "description": "Transfer linked entities together"},
                "consent_evidence_ref": {"type": "string", "description": "Pointer to recorded consent for the transfer"},
                "approval_id": {"type": "string", "description": "Linked approval record"},
                "dry_run": {"type": "boolean", "description": "Compute transfer plan only"},
                "actor": actor_prop(),
            },
            "required": [ctx["primary_entity"], "source_tenant_id", "target_tenant_id"],
        },
        "returns": "Transfer plan/result with mapped ids and any conflicts surfaced.",
    }


GENERIC_BUILDERS = [
    make_search,
    make_list_by_status,
    make_get,
    make_bulk_create,
    make_bulk_update,
    make_bulk_delete,
    make_bulk_export,
    make_subscribe_webhook,
    make_unsubscribe,
    make_audit_history,
    make_changelog_query,
    make_schedule_create,
    make_schedule_pause,
    make_dry_run,
    make_preview,
    make_approval_submit,
    make_approval_decision,
    make_escalate,
    make_comment_add,
    make_attachment_upload,
    make_snapshot,
    make_restore,
    make_metrics_summary,
    make_dashboard_create,
    make_policy_define,
    make_policy_evaluate,
    make_dependency_link,
    make_dependency_get,
    make_tag_management,
    make_assign_owner,
    make_notification_send,
    make_health_check,
    make_rollback,
    make_import,
    make_dashboard_share,
    make_quota_set,
    make_dryrun_bulk,
    make_purge,
    make_acknowledge,
    make_resolve_incident,
    make_compare_versions,
    make_transfer,
]


def derive_entity_slug(primary_entity):
    """Make a noun slug from the primary entity key (e.g. swap_order_id -> swap_order)."""
    if primary_entity.endswith("_id"):
        return primary_entity[:-3]
    return primary_entity


def add_shared_entities_if_missing(data):
    """Ensure shared_entities has alert_id / version_id-like keys when builders need them."""
    se = data.setdefault("shared_entities", {})
    additions = {
        "audit_event_id": {"type": "string", "description": "Identifier of an audit log entry."},
        "approval_id": {"type": "string", "description": "Identifier of an approval workflow."},
        "subscription_id": {"type": "string", "description": "Identifier of a webhook or notification subscription."},
        "snapshot_id": {"type": "string", "description": "Identifier of a captured state snapshot."},
        "alert_id": {"type": "string", "description": "Identifier of a monitoring alert."},
        "incident_id": {"type": "string", "description": "Identifier of an incident record."},
        "policy_id": {"type": "string", "description": "Identifier of a policy record."},
        "dashboard_id": {"type": "string", "description": "Identifier of a dashboard definition."},
        "schedule_id": {"type": "string", "description": "Identifier of a scheduled job."},
    }
    for key, value in additions.items():
        if key not in se:
            se[key] = value


def expand_row(data):
    primary_entity = next(iter(data["shared_entities"].keys()))
    ctx = {
        "shared_entities": list(data["shared_entities"].keys()) + [
            "audit_event_id", "approval_id", "subscription_id", "snapshot_id",
            "alert_id", "incident_id", "policy_id", "dashboard_id", "schedule_id",
        ],
        "primary_entity": primary_entity,
        "entity_slug": derive_entity_slug(primary_entity),
        "workflow_name": data["workflow_name"],
        "domain": data["domain"],
    }

    out = deepcopy(data)
    add_shared_entities_if_missing(out)

    existing_names = {f["name"] for f in out["functions"]}
    new_funcs = []
    target_total = 40
    needed = target_total - len(out["functions"])

    for builder in GENERIC_BUILDERS:
        if len(new_funcs) >= needed:
            break
        func = builder(ctx)
        # ensure uniqueness
        base = func["name"]
        suffix = 1
        while func["name"] in existing_names or func["name"] in {f["name"] for f in new_funcs}:
            suffix += 1
            func["name"] = f"{base}_{suffix}"
        new_funcs.append(func)

    out["functions"].extend(new_funcs)
    return out


def validate(out, original_names):
    funcs = out["functions"]
    assert 30 <= len(funcs) <= 50, f"function count {len(funcs)} out of range"
    names = set()
    se_keys = set(out["shared_entities"].keys())

    def walk_refs(node):
        if isinstance(node, dict):
            if "$ref" in node and isinstance(node["$ref"], str):
                ref_path = node["$ref"]
                if ref_path.startswith("#/shared_entities/"):
                    key = ref_path.split("/")[-1]
                    if key not in se_keys:
                        raise AssertionError(f"dangling $ref {ref_path}")
            for v in node.values():
                walk_refs(v)
        elif isinstance(node, list):
            for v in node:
                walk_refs(v)

    for f in funcs:
        for required in ("name", "description", "stage", "parameters", "returns"):
            assert required in f, f"function missing {required}: {f.get('name')}"
        assert f["name"] not in names, f"duplicate name {f['name']}"
        names.add(f["name"])
        assert isinstance(f["parameters"], dict) and f["parameters"].get("type") == "object", f"bad parameters for {f['name']}"
        walk_refs(f["parameters"])
    for n in original_names:
        assert n in names, f"original function lost: {n}"


def main():
    df = pd.read_parquet(PARQUET)
    indices = list(range(20, 40))
    report = {"written": [], "skipped": [], "counts": {}, "failures": []}
    sample_path = None

    for i in indices:
        out_path = os.path.join(OUT_DIR, f"{i}.json")
        if os.path.exists(out_path):
            report["skipped"].append(i)
            try:
                with open(out_path) as fh:
                    existing = json.load(fh)
                report["counts"][i] = len(existing["functions"])
            except Exception:
                pass
            continue
        try:
            data = json.loads(df.iloc[i]["functions"])
            original_names = [f["name"] for f in data["functions"]]
            out = expand_row(data)
            validate(out, original_names)
            with open(out_path, "w") as fh:
                json.dump(out, fh, indent=2)
            report["written"].append(i)
            report["counts"][i] = len(out["functions"])
            if sample_path is None:
                sample_path = out_path
        except Exception as e:
            report["failures"].append({"index": i, "error": str(e)})

    print(json.dumps({"report": report, "sample_path": sample_path}, indent=2))


if __name__ == "__main__":
    main()
