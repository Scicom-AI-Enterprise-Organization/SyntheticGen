"""Generate Malaysian-style multi-turn call-centre conversations per library row.

This script defines, for each of indices 0..19, a hand-crafted scenario function
that returns the conversation JSON. It then validates and writes each file.
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


def build_msg(role, content=None, tool_calls=None, tool_call_id=None, name=None):
    m = {"role": role}
    if role == "assistant":
        m["content"] = content or ""
        if tool_calls:
            m["tool_calls"] = tool_calls
    elif role == "user":
        m["content"] = content
    elif role == "tool":
        m["tool_call_id"] = tool_call_id
        m["name"] = name
        m["content"] = content if isinstance(content, str) else js(content)
    return m


def tc(cid, name, args):
    return {"id": cid, "type": "function", "function": {"name": name, "arguments": js(args)}}


def tool_resp(cid, name, content):
    return build_msg("tool", tool_call_id=cid, name=name, content=js(content))


def assistant_with_calls(content, calls):
    return {"role": "assistant", "content": content, "tool_calls": calls}


def write_conv(idx: int, conv: dict):
    out = OUT_DIR / f"{idx}.json"
    with open(out, "w") as f:
        json.dump(conv, f, ensure_ascii=False, indent=2)
    ok, errs, info = validate(str(out), str(LIB_DIR / f"{idx}.json"))
    return ok, errs, info


def load_lib(idx):
    with open(LIB_DIR / f"{idx}.json") as f:
        return json.load(f)


# Common metadata builder
def meta(num_turns, fns_used, lang_note, turn_details):
    return {
        "num_turns": num_turns,
        "functions_used": list(fns_used),
        "language_style": lang_note,
        "generated_at": "2026-05-21T09:00:00+08:00",
        "turn_details": turn_details,
    }
