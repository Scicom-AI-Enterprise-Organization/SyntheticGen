"""Verify the scaffold function name templates exist in every library."""
import json
PFX = {
    0: "reconciliation_run", 1: "deployment", 2: "sd_wan_incident", 3: "edge_deployment",
    4: "retention_case", 5: "retention_case", 6: "campaign", 7: "udr_fault",
    8: "sim_swap_case", 9: "sd_wan_migration", 10: "sase_service_request",
    11: "exposure_session", 12: "naas_order", 13: "sim_swap_case",
    14: "campaign", 15: "entitlement", 16: "sd_wan_order", 17: "uc_resource_group",
    18: "device_swap_request", 19: "verification_order"
}
SCAFFOLD = [
    "simulate_{p}_changes", "evaluate_{p}_policy",
    "get_{p}_metrics", "get_{p}_audit_history",
    "create_{p}_snapshot", "tag_{p}s", "assign_{p}_owner",
    "request_{p}_approval", "decide_{p}_approval",
    "link_{p}_to_related", "add_{p}_comment", "upload_{p}_attachment",
    "check_{p}_health", "configure_{p}_retry_policy",
    "compare_{p}_versions", "generate_{p}_report"
]
for i, pfx in PFX.items():
    with open(f'/home/husein/ssd3/SyntheticGen/synthetic/test-function/{i}.json') as f:
        lib = json.load(f)
    have = {fn['name'] for fn in lib['functions']}
    missing = []
    for tmpl in SCAFFOLD:
        n = tmpl.format(p=pfx)
        if n not in have:
            missing.append(n)
    if missing:
        print(f"{i:3d} MISSING: {missing}")
    else:
        print(f"{i:3d} OK")
