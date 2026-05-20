"""Validate a generated conversation against the library spec."""
import json
import re
import sys
from pathlib import Path

FORBIDDEN = re.compile(r"\b(Tuan|bro|boss|machi|machan|padu|syiok|cuz)\b", re.IGNORECASE)
ADDR = re.compile(r"\b(Encik|Puan|Sir|Madam)\b")


def validate(conv_path: str, lib_path: str) -> tuple[bool, list[str], dict]:
    errors = []
    with open(conv_path) as f:
        conv = json.load(f)
    with open(lib_path) as f:
        lib = json.load(f)
    fns = {fn["name"]: fn for fn in lib["functions"]}

    msgs = conv["messages"]
    user_turns = [m for m in msgs if m["role"] == "user"]
    if not (10 <= len(user_turns) <= 20):
        errors.append(f"user turns {len(user_turns)} not in 10..20")

    pending_calls: dict[str, str] = {}
    fns_used = set()
    addr_used = False
    for i, m in enumerate(msgs):
        role = m["role"]
        if role == "assistant":
            content = m.get("content", "") or ""
            if FORBIDDEN.search(content):
                errors.append(f"forbidden token in assistant[{i}]: {FORBIDDEN.search(content).group()}")
            if ADDR.search(content):
                addr_used = True
            for tc in m.get("tool_calls", []) or []:
                fname = tc["function"]["name"]
                if fname not in fns:
                    errors.append(f"unknown function {fname} in assistant[{i}]")
                try:
                    args = json.loads(tc["function"]["arguments"])
                except Exception as e:
                    errors.append(f"arguments not JSON in assistant[{i}]: {e}")
                    continue
                # check required top-level params
                schema = fns.get(fname, {}).get("parameters", {})
                required = schema.get("required", [])
                for r in required:
                    if r not in args:
                        errors.append(f"missing required '{r}' for {fname} in assistant[{i}]")
                pending_calls[tc["id"]] = fname
                fns_used.add(fname)
        elif role == "tool":
            cid = m.get("tool_call_id")
            if cid not in pending_calls:
                errors.append(f"tool[{i}] tool_call_id {cid} not matching a prior call")
            else:
                if pending_calls[cid] != m.get("name"):
                    errors.append(f"tool[{i}] name {m.get('name')} != assistant call name {pending_calls[cid]}")
            try:
                json.loads(m["content"])
            except Exception as e:
                errors.append(f"tool[{i}] content not JSON: {e}")
        elif role == "user":
            content = m.get("content", "") or ""
            if FORBIDDEN.search(content):
                errors.append(f"forbidden token in user[{i}]: {FORBIDDEN.search(content).group()}")

    if not addr_used:
        errors.append("no assistant message used Encik/Puan/Sir/Madam")
    if len(fns_used) < 8:
        errors.append(f"only {len(fns_used)} distinct functions used (need >=8): {sorted(fns_used)}")

    return (len(errors) == 0, errors, {"user_turns": len(user_turns), "fns_used": sorted(fns_used)})


if __name__ == "__main__":
    conv_path = sys.argv[1]
    lib_path = sys.argv[2]
    ok, errs, info = validate(conv_path, lib_path)
    print("OK" if ok else "FAIL")
    print(json.dumps(info, indent=2))
    for e in errs:
        print(" -", e)
    sys.exit(0 if ok else 1)
