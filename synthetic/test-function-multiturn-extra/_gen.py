#!/usr/bin/env python3
"""Generate multiturn-extra conversations for indices 40-59.
Each conversation is hand-designed but built with helpers."""
import json, os, sys

OUT_DIR = '/home/husein/ssd3/SyntheticGen/synthetic/test-function-multiturn-extra'
LIB_DIR = '/home/husein/ssd3/SyntheticGen/synthetic/test-function'


def js(obj):
    return json.dumps(obj, ensure_ascii=False)


def assistant_tool(content, calls):
    return {"role": "assistant", "content": content, "tool_calls": [
        {"id": cid, "type": "function", "function": {"name": fn, "arguments": js(args)}}
        for (cid, fn, args) in calls
    ]}


def assistant(content):
    return {"role": "assistant", "content": content}


def user(content):
    return {"role": "user", "content": content}


def tool(cid, name, content):
    return {"role": "tool", "tool_call_id": cid, "name": name, "content": js(content)}


def save(i, obj):
    p = os.path.join(OUT_DIR, f'{i}.json')
    with open(p, 'w') as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
    return p
