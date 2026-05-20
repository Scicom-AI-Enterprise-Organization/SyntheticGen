#!/usr/bin/env python3
"""Validate a multiturn conversation file against its function library."""
import json
import sys
import re

FORBIDDEN = [r"\bbro\b", r"\bboss\b", r"\bmachi\b", r"\bmachan\b", r"\bpadu\b", r"\bsyiok\b", r"\bTuan\b"]


def validate(idx: int) -> tuple[bool, list[str]]:
    errs = []
    lib_path = f"/home/husein/ssd3/SyntheticGen/synthetic/test-function/{idx}.json"
    out_path = f"/home/husein/ssd3/SyntheticGen/synthetic/test-function-multiturn/{idx}.json"
    try:
        lib = json.load(open(lib_path))
        conv = json.load(open(out_path))
    except Exception as e:
        return False, [f"load: {e}"]

    fns = {f["name"]: f for f in lib["functions"]}
    msgs = conv["messages"]

    # tool_calls map
    seen_ids = set()
    user_turns = 0
    fn_used = set()
    has_vocative = False
    full_text_parts = []
    for m in msgs:
        if m["role"] == "user":
            user_turns += 1
            full_text_parts.append(m.get("content", ""))
        elif m["role"] == "assistant":
            full_text_parts.append(m.get("content", "") or "")
            for tc in m.get("tool_calls", []) or []:
                seen_ids.add(tc["id"])
                fn_name = tc["function"]["name"]
                fn_used.add(fn_name)
                if fn_name not in fns:
                    errs.append(f"unknown function name {fn_name} (not in library {idx})")
                try:
                    json.loads(tc["function"]["arguments"])
                except Exception as e:
                    errs.append(f"args not JSON for {fn_name}: {e}")
        elif m["role"] == "tool":
            if m["tool_call_id"] not in seen_ids:
                errs.append(f"tool_call_id {m['tool_call_id']} not seen prior")
            try:
                json.loads(m["content"])
            except Exception as e:
                errs.append(f"tool content not JSON: {e}")

    full_text = "\n".join(full_text_parts)
    for pat in FORBIDDEN:
        if re.search(pat, full_text, re.IGNORECASE):
            errs.append(f"forbidden token matched: {pat}")
    if re.search(r"\b(Encik|Puan|Sir|Madam)\b", full_text):
        has_vocative = True
    if not has_vocative:
        errs.append("no Encik/Puan/Sir/Madam in any assistant content")

    if not (10 <= user_turns <= 20):
        errs.append(f"user turn count {user_turns} not in 10..20")
    if len(fn_used) < 8:
        errs.append(f"distinct functions {len(fn_used)} < 8")

    return (len(errs) == 0), errs + [f"OK turns={user_turns} fns={len(fn_used)}"]


if __name__ == "__main__":
    for arg in sys.argv[1:]:
        ok, info = validate(int(arg))
        print(arg, "OK" if ok else "FAIL", "|", " ; ".join(info))
