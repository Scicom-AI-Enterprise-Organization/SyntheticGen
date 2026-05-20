#!/usr/bin/env python3
"""Expand rows 60..79 of test parquet into test-function/{i}.json with 30-50 functions each."""
import os, json, copy, sys
import pandas as pd

PARQUET = '/home/husein/ssd3/SyntheticGen/synthetic/test-00000-of-00001.parquet'
OUTDIR = '/home/husein/ssd3/SyntheticGen/synthetic/test-function'
os.makedirs(OUTDIR, exist_ok=True)


# Generic shared entities to add when needed across many domains.
GENERIC_EXTRAS = {
    "actor_ref": {
        "type": "object",
        "description": "Reference to the actor (human user or system) performing an action.",
        "properties": {
            "actor_id": {"type": "string"},
            "actor_type": {"type": "string", "enum": ["user", "service", "automation", "vendor"]},
            "tenant_id": {"type": "string"},
            "roles": {"type": "array", "items": {"type": "string"}},
            "session_id": {"type": "string"},
        },
        "required": ["actor_id", "actor_type"],
    },
    "time_range": {
        "type": "object",
        "description": "Inclusive/exclusive time range.",
        "properties": {
            "from": {"type": "string", "format": "date-time"},
            "to": {"type": "string", "format": "date-time"},
            "timezone": {"type": "string"},
            "inclusive_from": {"type": "boolean", "default": True},
            "inclusive_to": {"type": "boolean", "default": False},
        },
        "required": ["from", "to"],
    },
    "pagination": {
        "type": "object",
        "description": "Pagination parameters for list/search endpoints.",
        "properties": {
            "limit": {"type": "integer", "minimum": 1, "maximum": 500, "default": 50},
            "offset": {"type": "integer", "minimum": 0, "default": 0},
            "cursor": {"type": "string"},
            "sort": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "field": {"type": "string"},
                        "direction": {"type": "string", "enum": ["asc", "desc"]},
                    },
                    "required": ["field"],
                },
            },
        },
    },
    "webhook_subscription": {
        "type": "object",
        "description": "Webhook subscription details.",
        "properties": {
            "subscription_id": {"type": "string"},
            "target_url": {"type": "string", "format": "uri"},
            "secret": {"type": "string"},
            "event_types": {"type": "array", "items": {"type": "string"}},
            "headers": {"type": "object", "additionalProperties": {"type": "string"}},
            "active": {"type": "boolean", "default": True},
        },
        "required": ["target_url", "event_types"],
    },
    "attachment_ref": {
        "type": "object",
        "description": "Attachment reference: file or external link.",
        "properties": {
            "attachment_id": {"type": "string"},
            "kind": {"type": "string", "enum": ["file", "link", "evidence", "screenshot", "log"]},
            "mime_type": {"type": "string"},
            "uri": {"type": "string"},
            "size_bytes": {"type": "integer"},
            "checksum": {
                "type": "object",
                "properties": {"algorithm": {"type": "string"}, "value": {"type": "string"}},
            },
        },
        "required": ["kind"],
    },
    "tag_filter": {
        "type": "object",
        "description": "Tag-based filter with key/value match and operators.",
        "properties": {
            "all_of": {"type": "array", "items": {"type": "string"}},
            "any_of": {"type": "array", "items": {"type": "string"}},
            "none_of": {"type": "array", "items": {"type": "string"}},
            "kv": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "key": {"type": "string"},
                        "op": {"type": "string", "enum": ["eq", "ne", "in", "nin", "exists"]},
                        "values": {"type": "array", "items": {"type": "string"}},
                    },
                    "required": ["key", "op"],
                },
            },
        },
    },
    "schedule_spec": {
        "type": "object",
        "description": "Recurring schedule specification (cron or RRULE).",
        "properties": {
            "kind": {"type": "string", "enum": ["cron", "rrule", "interval", "one_shot"]},
            "cron_expression": {"type": "string"},
            "rrule": {"type": "string"},
            "interval_seconds": {"type": "integer", "minimum": 1},
            "starts_at": {"type": "string", "format": "date-time"},
            "ends_at": {"type": "string", "format": "date-time"},
            "timezone": {"type": "string"},
            "max_occurrences": {"type": "integer"},
        },
        "required": ["kind"],
    },
}


def ref(name):
    return {"$ref": f"#/shared_entities/{name}"}


def make_fn(name, description, stage, properties, required=None, returns=""):
    fn = {
        "name": name,
        "description": description,
        "stage": stage,
        "parameters": {
            "type": "object",
            "properties": properties,
        },
        "returns": returns,
    }
    if required:
        fn["parameters"]["required"] = required
    return fn


# ---------- Common building blocks for new functions ----------

def common_filter_props(extra=None, entity_ref_keys=None):
    """Build a common filter set referencing tag_filter + time_range + pagination."""
    props = {
        "filters": {
            "type": "object",
            "properties": {
                "tags": ref("tag_filter"),
                "created_in": ref("time_range"),
                "updated_in": ref("time_range"),
                "status_in": {"type": "array", "items": {"type": "string"}},
                "free_text": {"type": "string"},
            },
        },
        "pagination": ref("pagination"),
        "actor": ref("actor_ref"),
    }
    if extra:
        props.update(extra)
    if entity_ref_keys:
        for k in entity_ref_keys:
            props.setdefault("entity_filter", {"type": "object", "properties": {}})
            props["entity_filter"]["properties"][k] = ref(k)
    return props


# Library of generic functions to inject per workflow.
def generic_function_library(shared_entities, primary_entity_keys, workflow_token):
    """Return a list of generic functions parameterized for this workflow.

    workflow_token is used to namespace function names (e.g., 'tariff', 'swap').
    primary_entity_keys: list of shared entity refs that name 'primary' entities.
    """
    fns = []
    tok = workflow_token

    # Choose a primary entity for entity-bound ops.
    primary = primary_entity_keys[0] if primary_entity_keys else None
    secondary = primary_entity_keys[1] if len(primary_entity_keys) > 1 else primary

    # 1) Search / list with rich filters
    fns.append(make_fn(
        f"search_{tok}_entities",
        f"Faceted search across {tok} entities supporting tag filters, time windows, full-text, status, and pagination.",
        "discovery",
        {
            "query": {
                "type": "object",
                "properties": {
                    "free_text": {"type": "string"},
                    "facets": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string"},
                                "values": {"type": "array", "items": {"type": "string"}},
                                "operator": {"type": "string", "enum": ["any", "all", "none"]},
                            },
                            "required": ["name", "values"],
                        },
                    },
                    "tags": ref("tag_filter"),
                    "created_in": ref("time_range"),
                    "updated_in": ref("time_range"),
                    "status_in": {"type": "array", "items": {"type": "string"}},
                },
            },
            "projection": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Optional list of fields to project in the response.",
            },
            "include_facet_counts": {"type": "boolean", "default": False},
            "highlight": {
                "type": "object",
                "properties": {
                    "enabled": {"type": "boolean", "default": False},
                    "fields": {"type": "array", "items": {"type": "string"}},
                    "fragment_size": {"type": "integer", "default": 100},
                },
            },
            "pagination": ref("pagination"),
            "actor": ref("actor_ref"),
        },
        ["query"],
        f"Paginated list of matching {tok} entities, optional facet counts, and pagination cursors.",
    ))

    # 2) Bulk create
    if primary:
        fns.append(make_fn(
            f"bulk_create_{tok}_records",
            f"Bulk-create up to N {tok} records in a single atomic-or-best-effort batch with per-item validation results.",
            "bulk",
            {
                "records": {
                    "type": "array",
                    "minItems": 1,
                    "maxItems": 500,
                    "items": {
                        "type": "object",
                        "properties": {
                            "external_ref": {"type": "string"},
                            "payload": {"type": "object"},
                            "tags": {"type": "array", "items": {"type": "string"}},
                            "idempotency_key": {"type": "string"},
                        },
                        "required": ["payload"],
                    },
                },
                "mode": {"type": "string", "enum": ["atomic", "best_effort", "fail_fast"], "default": "best_effort"},
                "dry_run": {"type": "boolean", "default": False},
                "validate_only": {"type": "boolean", "default": False},
                "on_conflict": {"type": "string", "enum": ["error", "skip", "upsert"], "default": "error"},
                "correlation_id": {"type": "string"},
                "actor": ref("actor_ref"),
            },
            ["records"],
            f"Per-record outcome with assigned ids or validation errors, plus an overall batch summary.",
        ))

    # 3) Bulk update
    if primary:
        fns.append(make_fn(
            f"bulk_update_{tok}_records",
            f"Apply a partial update patch to many {tok} records, optionally with optimistic concurrency checks.",
            "bulk",
            {
                "updates": {
                    "type": "array",
                    "minItems": 1,
                    "maxItems": 500,
                    "items": {
                        "type": "object",
                        "properties": {
                            "target_id": {"type": "string"},
                            "patch": {"type": "object"},
                            "expected_version": {"type": "integer"},
                            "tag_changes": {
                                "type": "object",
                                "properties": {
                                    "add": {"type": "array", "items": {"type": "string"}},
                                    "remove": {"type": "array", "items": {"type": "string"}},
                                },
                            },
                        },
                        "required": ["target_id", "patch"],
                    },
                },
                "concurrency_mode": {"type": "string", "enum": ["optimistic", "last_writer_wins"], "default": "optimistic"},
                "dry_run": {"type": "boolean", "default": False},
                "stop_on_error": {"type": "boolean", "default": False},
                "actor": ref("actor_ref"),
            },
            ["updates"],
            f"Per-update result with new version ids and a count of successes/failures.",
        ))

    # 4) Bulk delete
    if primary:
        fns.append(make_fn(
            f"bulk_delete_{tok}_records",
            f"Delete or soft-delete many {tok} records in one call, with cascade and dry-run options.",
            "bulk",
            {
                "target_ids": {"type": "array", "minItems": 1, "items": {"type": "string"}},
                "mode": {"type": "string", "enum": ["soft", "hard"], "default": "soft"},
                "cascade": {
                    "type": "object",
                    "properties": {
                        "related_entities": {"type": "array", "items": {"type": "string"}},
                        "strategy": {"type": "string", "enum": ["block", "detach", "cascade"], "default": "block"},
                    },
                },
                "reason": {"type": "string"},
                "dry_run": {"type": "boolean", "default": False},
                "actor": ref("actor_ref"),
            },
            ["target_ids"],
            "Per-id deletion outcome and references to any cascaded entities.",
        ))

    # 5) Export
    fns.append(make_fn(
        f"export_{tok}_dataset",
        f"Schedule or stream an export of {tok} data to CSV/JSONL/Parquet, with field selection and filters.",
        "report",
        {
            "format": {"type": "string", "enum": ["csv", "jsonl", "parquet", "xlsx"], "default": "csv"},
            "filters": {
                "type": "object",
                "properties": {
                    "tags": ref("tag_filter"),
                    "created_in": ref("time_range"),
                    "status_in": {"type": "array", "items": {"type": "string"}},
                    "ids": {"type": "array", "items": {"type": "string"}},
                },
            },
            "fields": {"type": "array", "items": {"type": "string"}},
            "destination": {
                "type": "object",
                "properties": {
                    "kind": {"type": "string", "enum": ["download", "s3", "gcs", "azure_blob", "sftp"]},
                    "uri": {"type": "string"},
                    "credentials_ref": {"type": "string"},
                },
                "required": ["kind"],
            },
            "compression": {"type": "string", "enum": ["none", "gzip", "zstd"], "default": "none"},
            "include_pii": {"type": "boolean", "default": False},
            "actor": ref("actor_ref"),
        },
        ["destination"],
        "Export job id, estimated row count, and status tracking endpoint.",
    ))

    # 6) Import
    fns.append(make_fn(
        f"import_{tok}_dataset",
        f"Validate and import a {tok} dataset from a remote URI; supports dry-run and conflict handling.",
        "bulk",
        {
            "source": {
                "type": "object",
                "properties": {
                    "uri": {"type": "string"},
                    "format": {"type": "string", "enum": ["csv", "jsonl", "parquet", "xlsx"]},
                    "credentials_ref": {"type": "string"},
                    "header_row": {"type": "boolean", "default": True},
                    "delimiter": {"type": "string"},
                },
                "required": ["uri", "format"],
            },
            "mapping": {
                "type": "object",
                "additionalProperties": {"type": "string"},
                "description": "Source column to target field mapping.",
            },
            "dry_run": {"type": "boolean", "default": True},
            "on_conflict": {"type": "string", "enum": ["error", "skip", "upsert"], "default": "error"},
            "max_errors": {"type": "integer", "default": 100},
            "actor": ref("actor_ref"),
        },
        ["source"],
        "Import job id, row counts (succeeded/failed/skipped), and a sample of validation errors.",
    ))

    # 7) Snapshot create
    if primary:
        fns.append(make_fn(
            f"snapshot_{tok}_state",
            f"Create a point-in-time snapshot of one or more {tok} entities for later restore or comparison.",
            "snapshot",
            {
                "target_ids": {"type": "array", "items": {"type": "string"}},
                "scope": {"type": "string", "enum": ["entity", "tenant", "workflow"], "default": "entity"},
                "label": {"type": "string"},
                "retention_days": {"type": "integer", "minimum": 1, "default": 30},
                "include_children": {"type": "boolean", "default": True},
                "encryption": {
                    "type": "object",
                    "properties": {
                        "enabled": {"type": "boolean", "default": True},
                        "kms_key_id": {"type": "string"},
                    },
                },
                "actor": ref("actor_ref"),
            },
            ["target_ids"],
            "Snapshot id, size estimate, and retention expiry timestamp.",
        ))

    # 8) Snapshot restore
    if primary:
        fns.append(make_fn(
            f"restore_{tok}_snapshot",
            f"Restore {tok} state from a prior snapshot with dry-run preview and conflict resolution.",
            "recovery",
            {
                "snapshot_id": {"type": "string"},
                "target_ids": {"type": "array", "items": {"type": "string"}},
                "mode": {"type": "string", "enum": ["overwrite", "merge", "side_by_side"], "default": "merge"},
                "dry_run": {"type": "boolean", "default": True},
                "conflict_strategy": {"type": "string", "enum": ["keep_current", "keep_snapshot", "prompt"], "default": "keep_current"},
                "reason": {"type": "string"},
                "actor": ref("actor_ref"),
            },
            ["snapshot_id"],
            "Restore plan or actual restore result with per-entity status.",
        ))

    # 9) Metrics / KPIs
    fns.append(make_fn(
        f"get_{tok}_metrics",
        f"Query aggregated metrics/KPIs for the {tok} workflow with grouping, filters, and time ranges.",
        "monitoring",
        {
            "metrics": {"type": "array", "minItems": 1, "items": {"type": "string"}},
            "group_by": {"type": "array", "items": {"type": "string"}},
            "filters": {
                "type": "object",
                "properties": {
                    "tags": ref("tag_filter"),
                    "status_in": {"type": "array", "items": {"type": "string"}},
                },
            },
            "time_range": ref("time_range"),
            "bucket": {
                "type": "object",
                "properties": {
                    "kind": {"type": "string", "enum": ["minute", "hour", "day", "week", "month"]},
                    "size": {"type": "integer", "minimum": 1, "default": 1},
                },
                "required": ["kind"],
            },
            "limit_series": {"type": "integer", "default": 50},
            "actor": ref("actor_ref"),
        },
        ["metrics", "time_range"],
        "Time-series points per metric and group, with totals and percentiles.",
    ))

    # 10) Dashboard
    fns.append(make_fn(
        f"build_{tok}_dashboard",
        f"Compose a dashboard view across {tok} metrics, with panels, filters, and a shareable link.",
        "report",
        {
            "title": {"type": "string"},
            "panels": {
                "type": "array",
                "minItems": 1,
                "items": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string"},
                        "kind": {"type": "string", "enum": ["timeseries", "table", "single_stat", "heatmap", "histogram"]},
                        "metric_id": {"type": "string"},
                        "filters": {"type": "object"},
                        "options": {"type": "object"},
                    },
                    "required": ["kind"],
                },
            },
            "default_time_range": ref("time_range"),
            "visibility": {"type": "string", "enum": ["private", "team", "tenant", "public"], "default": "team"},
            "actor": ref("actor_ref"),
        },
        ["title", "panels"],
        "Dashboard id, share URL, and resolved layout metadata.",
    ))

    # 11) Audit trail query
    fns.append(make_fn(
        f"query_{tok}_audit_events",
        f"Search the {tok} audit/change log with filters across actors, actions, resources, and time windows.",
        "audit",
        {
            "filters": {
                "type": "object",
                "properties": {
                    "actor_ids": {"type": "array", "items": {"type": "string"}},
                    "action_types": {"type": "array", "items": {"type": "string"}},
                    "resource_ids": {"type": "array", "items": {"type": "string"}},
                    "tags": ref("tag_filter"),
                    "occurred_in": ref("time_range"),
                    "severity_in": {"type": "array", "items": {"type": "string", "enum": ["info", "warn", "error", "critical"]}},
                },
            },
            "pagination": ref("pagination"),
            "include_diff": {"type": "boolean", "default": False},
            "actor": ref("actor_ref"),
        },
        ["filters"],
        "Paginated audit events with optional before/after diffs.",
    ))

    # 12) Webhook subscribe
    fns.append(make_fn(
        f"subscribe_{tok}_events",
        f"Create a webhook subscription that delivers {tok} workflow events to a target URL with retries and signing.",
        "subscribe",
        {
            "subscription": ref("webhook_subscription"),
            "filters": {
                "type": "object",
                "properties": {
                    "resource_ids": {"type": "array", "items": {"type": "string"}},
                    "tags": ref("tag_filter"),
                    "min_severity": {"type": "string", "enum": ["info", "warn", "error", "critical"]},
                },
            },
            "delivery": {
                "type": "object",
                "properties": {
                    "max_retries": {"type": "integer", "default": 5},
                    "retry_backoff": {"type": "string", "enum": ["linear", "exponential"], "default": "exponential"},
                    "timeout_seconds": {"type": "integer", "default": 30},
                },
            },
            "actor": ref("actor_ref"),
        },
        ["subscription"],
        "Subscription id, verification challenge if applicable, and active flag.",
    ))

    # 13) Webhook list
    fns.append(make_fn(
        f"list_{tok}_subscriptions",
        f"List webhook subscriptions for {tok} events with filters and status counts.",
        "subscribe",
        {
            "filters": {
                "type": "object",
                "properties": {
                    "active": {"type": "boolean"},
                    "event_type_in": {"type": "array", "items": {"type": "string"}},
                    "tags": ref("tag_filter"),
                },
            },
            "pagination": ref("pagination"),
            "actor": ref("actor_ref"),
        },
        None,
        "Paginated list of subscriptions with last delivery status.",
    ))

    # 14) Webhook delete
    fns.append(make_fn(
        f"delete_{tok}_subscription",
        f"Remove a webhook subscription for {tok} events.",
        "subscribe",
        {
            "subscription_id": {"type": "string"},
            "reason": {"type": "string"},
            "actor": ref("actor_ref"),
        },
        ["subscription_id"],
        "Confirmation with final delivery counters.",
    ))

    # 15) Schedule
    fns.append(make_fn(
        f"schedule_{tok}_job",
        f"Schedule a recurring or one-off {tok} job (cron/rrule/interval) with arguments and an owner.",
        "schedule",
        {
            "job_kind": {"type": "string"},
            "arguments": {"type": "object"},
            "schedule": ref("schedule_spec"),
            "owner": ref("actor_ref"),
            "tags": {"type": "array", "items": {"type": "string"}},
            "max_concurrent_runs": {"type": "integer", "default": 1},
            "on_failure": {
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["retry", "skip", "page", "open_incident"], "default": "retry"},
                    "max_retries": {"type": "integer", "default": 3},
                },
            },
        },
        ["job_kind", "schedule"],
        "Schedule id and next computed run time.",
    ))

    # 16) Schedule list / cancel
    fns.append(make_fn(
        f"list_{tok}_schedules",
        f"List scheduled {tok} jobs with filters and pagination.",
        "schedule",
        {
            "filters": {
                "type": "object",
                "properties": {
                    "job_kinds": {"type": "array", "items": {"type": "string"}},
                    "owners": {"type": "array", "items": {"type": "string"}},
                    "active": {"type": "boolean"},
                    "tags": ref("tag_filter"),
                },
            },
            "pagination": ref("pagination"),
            "actor": ref("actor_ref"),
        },
        None,
        "Paginated list of schedules with last/next run timestamps.",
    ))

    fns.append(make_fn(
        f"cancel_{tok}_schedule",
        f"Cancel or pause a scheduled {tok} job.",
        "schedule",
        {
            "schedule_id": {"type": "string"},
            "mode": {"type": "string", "enum": ["pause", "cancel"], "default": "cancel"},
            "reason": {"type": "string"},
            "actor": ref("actor_ref"),
        },
        ["schedule_id"],
        "Updated schedule state.",
    ))

    # 17) Dry-run / simulate
    fns.append(make_fn(
        f"simulate_{tok}_operation",
        f"Run a what-if simulation of a {tok} operation without committing side effects, returning predicted outcomes.",
        "simulate",
        {
            "operation": {
                "type": "object",
                "properties": {
                    "kind": {"type": "string"},
                    "payload": {"type": "object"},
                    "target_ids": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["kind"],
            },
            "what_if": {
                "type": "object",
                "properties": {
                    "policy_overrides": {"type": "object"},
                    "feature_flags": {"type": "object", "additionalProperties": {"type": "boolean"}},
                    "assume_inputs": {"type": "object"},
                },
            },
            "include_warnings": {"type": "boolean", "default": True},
            "actor": ref("actor_ref"),
        },
        ["operation"],
        "Predicted outcomes, side-effect summary, warnings, and policy hits.",
    ))

    # 18) Approval request
    fns.append(make_fn(
        f"request_{tok}_approval",
        f"Open an approval request for a {tok} action, routing to the right approvers and policies.",
        "approval",
        {
            "subject": {
                "type": "object",
                "properties": {
                    "kind": {"type": "string"},
                    "target_id": {"type": "string"},
                    "change_summary": {"type": "string"},
                    "payload": {"type": "object"},
                },
                "required": ["kind"],
            },
            "approvers": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "actor_id": {"type": "string"},
                        "role": {"type": "string"},
                        "required": {"type": "boolean", "default": True},
                    },
                    "required": ["actor_id"],
                },
            },
            "policy_id": {"type": "string"},
            "due_at": {"type": "string", "format": "date-time"},
            "context_attachments": {"type": "array", "items": ref("attachment_ref")},
            "actor": ref("actor_ref"),
        },
        ["subject"],
        "Approval request id, routed approver list, and SLA timer.",
    ))

    fns.append(make_fn(
        f"decide_{tok}_approval",
        f"Record an approve/reject/abstain decision on a {tok} approval request with required justification.",
        "approval",
        {
            "approval_id": {"type": "string"},
            "decision": {"type": "string", "enum": ["approve", "reject", "abstain", "request_changes"]},
            "justification": {"type": "string"},
            "constraints": {
                "type": "object",
                "properties": {
                    "valid_until": {"type": "string", "format": "date-time"},
                    "applies_to_versions": {"type": "array", "items": {"type": "string"}},
                },
            },
            "attachments": {"type": "array", "items": ref("attachment_ref")},
            "actor": ref("actor_ref"),
        },
        ["approval_id", "decision"],
        "Updated approval state and downstream effects (e.g., gate releases).",
    ))

    # 19) Comments
    fns.append(make_fn(
        f"add_{tok}_comment",
        f"Add a threaded comment or annotation to any {tok} entity, supporting mentions and attachments.",
        "collaborate",
        {
            "target": {
                "type": "object",
                "properties": {
                    "entity_kind": {"type": "string"},
                    "entity_id": {"type": "string"},
                    "anchor": {"type": "string"},
                },
                "required": ["entity_kind", "entity_id"],
            },
            "body": {"type": "string"},
            "mentions": {"type": "array", "items": {"type": "string"}},
            "attachments": {"type": "array", "items": ref("attachment_ref")},
            "in_reply_to": {"type": "string"},
            "visibility": {"type": "string", "enum": ["public", "internal", "private"], "default": "internal"},
            "actor": ref("actor_ref"),
        },
        ["target", "body"],
        "Comment id, thread id, and updated thread state.",
    ))

    fns.append(make_fn(
        f"list_{tok}_comments",
        f"List comments/annotations attached to a {tok} entity with pagination and filters.",
        "collaborate",
        {
            "target": {
                "type": "object",
                "properties": {
                    "entity_kind": {"type": "string"},
                    "entity_id": {"type": "string"},
                },
                "required": ["entity_kind", "entity_id"],
            },
            "filters": {
                "type": "object",
                "properties": {
                    "author_in": {"type": "array", "items": {"type": "string"}},
                    "created_in": ref("time_range"),
                    "visibility_in": {"type": "array", "items": {"type": "string"}},
                    "has_attachments": {"type": "boolean"},
                },
            },
            "pagination": ref("pagination"),
            "actor": ref("actor_ref"),
        },
        ["target"],
        "Paginated comment threads with author/timestamp/mentions.",
    ))

    # 20) Policy / rule mgmt
    fns.append(make_fn(
        f"upsert_{tok}_policy",
        f"Create or update a policy/rule controlling {tok} behavior, with conditions, effects, and a priority.",
        "policy",
        {
            "policy_id": {"type": "string"},
            "name": {"type": "string"},
            "description": {"type": "string"},
            "scope": {
                "type": "object",
                "properties": {
                    "tenants": {"type": "array", "items": {"type": "string"}},
                    "tags": ref("tag_filter"),
                    "applies_to": {"type": "array", "items": {"type": "string"}},
                },
            },
            "conditions": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "field": {"type": "string"},
                        "op": {"type": "string", "enum": ["eq", "ne", "in", "nin", "gt", "lt", "regex"]},
                        "value": {},
                    },
                    "required": ["field", "op"],
                },
            },
            "effects": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "kind": {"type": "string", "enum": ["allow", "deny", "require_approval", "throttle", "tag"]},
                        "params": {"type": "object"},
                    },
                    "required": ["kind"],
                },
            },
            "priority": {"type": "integer", "default": 100},
            "active": {"type": "boolean", "default": True},
            "actor": ref("actor_ref"),
        },
        ["name", "conditions", "effects"],
        "Policy id, version, and any conflicts with existing policies.",
    ))

    fns.append(make_fn(
        f"list_{tok}_policies",
        f"List {tok} policies/rules with filters and active flags.",
        "policy",
        {
            "filters": {
                "type": "object",
                "properties": {
                    "active": {"type": "boolean"},
                    "tags": ref("tag_filter"),
                    "applies_to": {"type": "array", "items": {"type": "string"}},
                },
            },
            "pagination": ref("pagination"),
            "actor": ref("actor_ref"),
        },
        None,
        "Paginated list of policies with priority and last-modified info.",
    ))

    # 21) Dependency / link mgmt
    if primary:
        fns.append(make_fn(
            f"link_{tok}_entities",
            f"Create a typed relationship between two {tok}-related entities (parent/child, depends_on, references).",
            "dependency",
            {
                "from": {
                    "type": "object",
                    "properties": {
                        "kind": {"type": "string"},
                        "id": {"type": "string"},
                    },
                    "required": ["kind", "id"],
                },
                "to": {
                    "type": "object",
                    "properties": {
                        "kind": {"type": "string"},
                        "id": {"type": "string"},
                    },
                    "required": ["kind", "id"],
                },
                "relationship": {"type": "string", "enum": ["depends_on", "parent_of", "references", "blocks", "duplicates"]},
                "metadata": {"type": "object"},
                "actor": ref("actor_ref"),
            },
            ["from", "to", "relationship"],
            "Link id and a graph delta showing newly-created relationships.",
        ))

        fns.append(make_fn(
            f"get_{tok}_dependency_graph",
            f"Return the dependency/relationship graph rooted at a {tok} entity, up to N hops, with cycle detection.",
            "dependency",
            {
                "root": {
                    "type": "object",
                    "properties": {
                        "kind": {"type": "string"},
                        "id": {"type": "string"},
                    },
                    "required": ["kind", "id"],
                },
                "max_depth": {"type": "integer", "minimum": 1, "maximum": 10, "default": 3},
                "edge_kinds": {"type": "array", "items": {"type": "string"}},
                "direction": {"type": "string", "enum": ["downstream", "upstream", "both"], "default": "both"},
                "detect_cycles": {"type": "boolean", "default": True},
                "actor": ref("actor_ref"),
            },
            ["root"],
            "Nodes/edges of the dependency graph and any cycles detected.",
        ))

    # 22) Tagging
    fns.append(make_fn(
        f"tag_{tok}_entities",
        f"Add, remove, or replace tags on one or many {tok} entities.",
        "manage",
        {
            "target_ids": {"type": "array", "minItems": 1, "items": {"type": "string"}},
            "entity_kind": {"type": "string"},
            "add": {"type": "array", "items": {"type": "string"}},
            "remove": {"type": "array", "items": {"type": "string"}},
            "replace": {"type": "array", "items": {"type": "string"}},
            "actor": ref("actor_ref"),
        },
        ["target_ids", "entity_kind"],
        "Updated tag set per entity and count of changes applied.",
    ))

    # 23) Attachments upload
    fns.append(make_fn(
        f"attach_{tok}_evidence",
        f"Upload or link an evidence artifact (log, screenshot, document) to a {tok} entity for traceability.",
        "evidence",
        {
            "target": {
                "type": "object",
                "properties": {
                    "entity_kind": {"type": "string"},
                    "entity_id": {"type": "string"},
                },
                "required": ["entity_kind", "entity_id"],
            },
            "attachment": ref("attachment_ref"),
            "description": {"type": "string"},
            "sensitivity": {"type": "string", "enum": ["public", "internal", "confidential", "restricted"], "default": "internal"},
            "actor": ref("actor_ref"),
        },
        ["target", "attachment"],
        "Attachment id, sensitivity classification, and storage URI.",
    ))

    # 24) Notification preferences
    fns.append(make_fn(
        f"update_{tok}_notification_prefs",
        f"Update which {tok} workflow events a user/role should be notified about and through which channels.",
        "preferences",
        {
            "actor": ref("actor_ref"),
            "channels": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "kind": {"type": "string", "enum": ["email", "sms", "push", "slack", "teams", "webhook"]},
                        "address": {"type": "string"},
                        "active": {"type": "boolean", "default": True},
                    },
                    "required": ["kind"],
                },
            },
            "event_subscriptions": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "event_type": {"type": "string"},
                        "min_severity": {"type": "string", "enum": ["info", "warn", "error", "critical"]},
                        "quiet_hours": {
                            "type": "object",
                            "properties": {
                                "start": {"type": "string"},
                                "end": {"type": "string"},
                                "timezone": {"type": "string"},
                            },
                        },
                    },
                    "required": ["event_type"],
                },
            },
        },
        ["actor"],
        "Updated preferences and a preview of which upcoming events would notify.",
    ))

    # 25) Health check
    fns.append(make_fn(
        f"healthcheck_{tok}_service",
        f"Probe the {tok} subsystem health (dependencies, queues, error rates) and return a structured status.",
        "monitoring",
        {
            "checks": {"type": "array", "items": {"type": "string"}},
            "deep": {"type": "boolean", "default": False},
            "timeout_ms": {"type": "integer", "default": 5000},
            "actor": ref("actor_ref"),
        },
        None,
        "Per-check status, latency, and overall service health.",
    ))

    # 26) Escalation
    fns.append(make_fn(
        f"escalate_{tok}_case",
        f"Escalate a {tok} case or request to a higher tier of support/approver with context attached.",
        "escalation",
        {
            "case_id": {"type": "string"},
            "to_tier": {"type": "string", "enum": ["tier_1", "tier_2", "tier_3", "vendor", "exec"]},
            "reason": {"type": "string"},
            "urgency": {"type": "string", "enum": ["low", "medium", "high", "critical"], "default": "medium"},
            "include_attachments": {"type": "boolean", "default": True},
            "notify": {"type": "array", "items": {"type": "string"}},
            "actor": ref("actor_ref"),
        },
        ["case_id", "to_tier", "reason"],
        "Updated case state and recipients notified.",
    ))

    # 27) Bulk export by ids
    fns.append(make_fn(
        f"bulk_fetch_{tok}_records",
        f"Fetch many {tok} records by id in one call, returning per-id payloads or errors.",
        "query",
        {
            "ids": {"type": "array", "minItems": 1, "maxItems": 500, "items": {"type": "string"}},
            "fields": {"type": "array", "items": {"type": "string"}},
            "include_related": {"type": "array", "items": {"type": "string"}},
            "actor": ref("actor_ref"),
        },
        ["ids"],
        "Per-id payload or NotFound/error.",
    ))

    # 28) Compare versions
    if primary:
        fns.append(make_fn(
            f"compare_{tok}_versions",
            f"Compare two versions of a {tok} entity and return a structured diff with field-level changes.",
            "review",
            {
                "entity_id": {"type": "string"},
                "from_version": {"type": "string"},
                "to_version": {"type": "string"},
                "include_fields": {"type": "array", "items": {"type": "string"}},
                "ignore_fields": {"type": "array", "items": {"type": "string"}},
                "actor": ref("actor_ref"),
            },
            ["entity_id", "from_version", "to_version"],
            "Structured field-level diff and a human-readable summary.",
        ))

    return fns


def validate_output(out, original):
    fns = out["functions"]
    names = [f["name"] for f in fns]
    assert 30 <= len(fns) <= 50, f"function count {len(fns)} out of range"
    assert len(set(names)) == len(names), "duplicate function names"
    # required keys
    shared_keys = set(out["shared_entities"].keys())
    for f in fns:
        for k in ("name", "description", "stage", "parameters", "returns"):
            assert k in f, f"missing {k} in {f.get('name')}"
        assert f["parameters"].get("type") == "object", f"params type not object in {f['name']}"
        # check $ref strings
        def walk(o):
            if isinstance(o, dict):
                if "$ref" in o and isinstance(o["$ref"], str):
                    s = o["$ref"]
                    if s.startswith("#/shared_entities/"):
                        key = s.split("/")[-1]
                        assert key in shared_keys, f"$ref to missing entity {key} in {f['name']}"
                for v in o.values():
                    walk(v)
            elif isinstance(o, list):
                for it in o:
                    walk(it)
        walk(f["parameters"])
    # originals preserved
    orig_names = [f["name"] for f in original["functions"]]
    for n in orig_names:
        assert n in names, f"original function missing: {n}"
    # preserved fields
    for k in ("workflow_name", "description", "domain"):
        assert out[k] == original[k], f"{k} changed"


def expand_row(original, workflow_token, primary_entity_keys):
    out = copy.deepcopy(original)
    # add generic shared entities (additive only)
    for k, v in GENERIC_EXTRAS.items():
        if k not in out["shared_entities"]:
            out["shared_entities"][k] = v
    existing_names = {f["name"] for f in out["functions"]}
    extras = generic_function_library(out["shared_entities"], primary_entity_keys, workflow_token)
    for fn in extras:
        if fn["name"] in existing_names:
            continue
        out["functions"].append(fn)
        existing_names.add(fn["name"])
        if len(out["functions"]) >= 40:
            break
    # If we are below 30, add filler with namespaced names.
    suffix = 1
    while len(out["functions"]) < 32:
        f = make_fn(
            f"{workflow_token}_misc_op_{suffix}",
            f"Auxiliary operation {suffix} for the {workflow_token} workflow with structured inputs.",
            "manage",
            {
                "payload": {"type": "object"},
                "options": {
                    "type": "object",
                    "properties": {
                        "dry_run": {"type": "boolean", "default": False},
                        "force": {"type": "boolean", "default": False},
                    },
                },
                "actor": ref("actor_ref"),
            },
            None,
            "Operation result with structured status and any warnings.",
        )
        out["functions"].append(f)
        existing_names.add(f["name"])
        suffix += 1
    return out


# Per-row config: (workflow_token, primary_entity_keys)
ROW_CFG = {
    60: ("email_review", ["email_submission_id", "moderation_request_id"]),
    61: ("lpwan_campaign", ["campaign_id", "deployment_id"]),
    62: ("interconnect_migration", ["migration_id", "batch_id"]),
    63: ("udm_subscriber", ["subscriber_id", "profile_id"]),
    64: ("tariff_change", ["tariff_id", "change_request_id"]),
    65: ("telco_notification", ["notification_event_id", "notification_batch_id"]),
    66: ("lpwan_fraud", ["fraud_case_id", "alert_id"]),
    67: ("core_optimization", ["optimization_plan_id", "change_order_id"]),
    68: ("prepaid_charging", ["session_id", "transaction_id"]),
    69: ("uc_billing", ["invoice_id", "subscription_id"]),
    70: ("device_swap", ["swap_request_id", "device_id"]),
    71: ("noc_governance", ["dataset_id", "policy_id"]),
    72: ("lpwan_reservation", ["reservation_id", "order_id"]),
    73: ("rcs_incident", ["incident_id", "campaign_id"]),
    74: ("tariff_analytics", ["metric_id", "report_id"]),
    75: ("revenue_assurance", ["discrepancy_case_id", "remediation_plan_id"]),
    76: ("change_review", ["change_id", "approval_id"]),
    77: ("udm_moderation", ["moderation_request_id", "subscriber_id"]),
    78: ("prepaid_booking", ["booking_id", "session_id"]),
    79: ("change_calendar", ["change_id", "maintenance_window_id"]),
}


def main():
    df = pd.read_parquet(PARQUET)
    written, skipped, errors = [], [], []
    sample = None
    for i in range(60, 80):
        out_path = os.path.join(OUTDIR, f"{i}.json")
        if os.path.exists(out_path):
            skipped.append(i)
            continue
        try:
            original = json.loads(df.iloc[i]['functions'])
            tok, primary = ROW_CFG[i]
            # Filter primary keys to those actually in shared_entities of this row
            primary = [k for k in primary if k in original["shared_entities"]]
            out = expand_row(original, tok, primary)
            validate_output(out, original)
            with open(out_path, "w") as fh:
                json.dump(out, fh, indent=2)
            written.append((i, len(out["functions"])))
            if sample is None:
                sample = out_path
        except Exception as e:
            errors.append((i, str(e)))
    print("WRITTEN:")
    for i, n in written:
        print(f"  {i}: {n} functions")
    print("SKIPPED:", skipped)
    print("ERRORS:", errors)
    print("SAMPLE:", sample)

if __name__ == "__main__":
    main()
