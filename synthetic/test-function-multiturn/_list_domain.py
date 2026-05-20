"""List the domain-specific (non-scaffold) functions per library."""
import json

SCAFFOLD_TEMPLATES = [
    "simulate_{p}_changes", "evaluate_{p}_policy",
    "get_{p}_metrics", "get_{p}_audit_history", "get_{p}_dashboard",
    "create_{p}_snapshot", "restore_{p}_from_snapshot",
    "tag_{p}s", "assign_{p}_owner",
    "request_{p}_approval", "decide_{p}_approval",
    "link_{p}_to_related", "add_{p}_comment", "upload_{p}_attachment",
    "check_{p}_health", "configure_{p}_retry_policy",
    "compare_{p}_versions", "generate_{p}_report",
    "escalate_{p}",
    "search_{p}s", "bulk_create_{p}s", "bulk_update_{p}s", "bulk_archive_{p}s",
    "export_{p}s", "import_{p}s", "subscribe_to_{p}_events",
    "schedule_recurring_{p}_job",
    "get_{p}_dependency_graph", "clone_{p}",
    "create_{p}_policy",
]
PFX = {
    0: "reconciliation_run", 1: "deployment", 2: "sd_wan_incident", 3: "edge_deployment",
    4: "retention_case", 5: "retention_case", 6: "campaign", 7: "udr_fault",
    8: "sim_swap_case", 9: "sd_wan_migration", 10: "sase_service_request",
    11: "exposure_session", 12: "naas_order", 13: "sim_swap_case",
    14: "campaign", 15: "entitlement", 16: "sd_wan_order", 17: "uc_resource_group",
    18: "device_swap_request", 19: "verification_order"
}
import sys
indices = [int(x) for x in sys.argv[1:]] if len(sys.argv) > 1 else list(range(20))

for i in indices:
    pfx = PFX[i]
    scaffold = set()
    for tmpl in SCAFFOLD_TEMPLATES:
        scaffold.add(tmpl.format(p=pfx))
    with open(f'/home/husein/ssd3/SyntheticGen/synthetic/test-function/{i}.json') as f:
        lib = json.load(f)
    print(f"\n===== {i} {lib['workflow_name']} ({lib['domain']}) pfx={pfx} =====")
    for fn in lib['functions']:
        if fn['name'] not in scaffold:
            req = fn.get('parameters', {}).get('required', [])
            print(f"  [{fn.get('stage','-'):14s}] {fn['name']:55s} REQ={req}")
