"""Tiny OpenAI-compatible /chat/completions stub for end-to-end smoke tests.

Returns a fixed Formal Malay formal MS reply so register-compliance validates clean,
plus a Manglish reply when the request body asks for it via a magic word.
"""
from __future__ import annotations

import json
import time
import uuid

from fastapi import FastAPI, Request


app = FastAPI()


CLEAN_REPLY = (
    "Selamat sejahtera. Untuk menyemak bil router anda, sila log masuk ke portal "
    "pelanggan kami menggunakan email berdaftar. Sekiranya anda menghadapi masalah, "
    "sila hubungi pasukan sokongan kami untuk bantuan lanjut."
)

DIRTY_REPLY = (
    "Boleh tak check bil router saya lah? Tak boleh login dah. Tolong bantu eh."
)


@app.post("/v1/chat/completions")
async def chat(req: Request):
    body = await req.json()
    messages = body.get("messages", [])
    user_text = " ".join(m.get("content", "") for m in messages if m.get("role") == "user")
    is_dirty = "manglish" in user_text.lower()

    content = DIRTY_REPLY if is_dirty else CLEAN_REPLY
    tokens_in = sum(len((m.get("content") or "").split()) for m in messages)
    tokens_out = len(content.split())

    return {
        "id": "chatcmpl-" + uuid.uuid4().hex[:12],
        "object": "chat.completion",
        "created": int(time.time()),
        "model": body.get("model", "stub-model"),
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": content},
                "finish_reason": "stop",
            }
        ],
        "usage": {
            "prompt_tokens": tokens_in,
            "completion_tokens": tokens_out,
            "total_tokens": tokens_in + tokens_out,
        },
    }


def run() -> None:
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8765, log_level="warning")


if __name__ == "__main__":
    run()
