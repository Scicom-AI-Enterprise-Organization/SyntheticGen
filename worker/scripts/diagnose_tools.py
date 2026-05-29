"""Diagnose tool-call extraction against a provider credential.

Loads a ProviderCredential by id, decrypts its key, and runs the same
streaming + non-streaming chat-completions path the worker uses — with a
small synthetic tool catalog. Prints whether structured tool_calls were
recovered and the raw content text. Useful when a model (e.g. Mistral on
vLLM) returns the raw `[TOOL_CALLS]` sentinel in content instead of
populating delta.tool_calls.

Run from the repo root:

    python worker/scripts/diagnose_tools.py <providerCredentialId> [model]

If `model` is omitted, the credential's defaultModel is used.
"""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

# Make the `synthgen` package importable when run as a script.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from synthgen import db
from synthgen.crypto import decrypt_secret
from synthgen.providers import (
    chat_completion,
    chat_completion_stream,
    parse_inline_tool_calls,
)


TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "Get the current weather in a given location",
            "parameters": {
                "type": "object",
                "properties": {
                    "location": {
                        "type": "string",
                        "description": "The city and state, e.g. Kuala Lumpur, MY",
                    },
                    "unit": {"type": "string", "enum": ["celsius", "fahrenheit"]},
                },
                "required": ["location"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "calculate",
            "description": "Evaluate a math expression and return the result",
            "parameters": {
                "type": "object",
                "properties": {
                    "expression": {"type": "string", "description": "A math expression"},
                },
                "required": ["expression"],
            },
        },
    },
]

PROMPTS = [
    "What's the weather in KL right now?",
    "What's 17 * 23 + 41?",
]


async def main(provider_id: str, override_model: str | None) -> None:
    row = await db.fetch_one(
        """SELECT name, kind, "baseUrl", "encryptedApiKey", headers,
                  "defaultModel", "reasoningEffort", "chatTemplateKwargs"
           FROM "ProviderCredential" WHERE id = $1""",
        provider_id,
    )
    if not row:
        print(f"provider {provider_id} not found")
        sys.exit(2)
    provider = dict(row)

    name = provider["name"]
    kind = provider["kind"]
    model = override_model or provider["defaultModel"]
    if not model:
        print(f"provider {name} has no defaultModel; pass one as argv[2]")
        sys.exit(2)
    base_url = provider["baseUrl"]
    api_key = decrypt_secret(provider["encryptedApiKey"]) if provider.get("encryptedApiKey") else ""
    extra_headers = provider.get("headers") if isinstance(provider.get("headers"), dict) else None
    reasoning = provider.get("reasoningEffort")
    chat_kwargs = provider.get("chatTemplateKwargs")
    if isinstance(chat_kwargs, str):
        try:
            chat_kwargs = json.loads(chat_kwargs)
        except json.JSONDecodeError:
            chat_kwargs = None

    print(f"== Provider: {name} ({kind})  base={base_url}  model={model}")
    print(f"   reasoningEffort={reasoning!r}  chatTemplateKwargs={chat_kwargs!r}")
    print()

    # Simulator-shape test: large system prompt + transcript-style user, no
    # tools. This reproduces the exact shape `_simulate_user_turn` sends.
    sim_system = (
        "You are role-playing the USER side of a Malaysian customer-support "
        "conversation. Reply ONLY with the user's next utterance. " * 30
    )
    sim_user = "Transcript so far:\n[USER] Hi.\n[ASSISTANT] Sila berikan MyKad."
    print("--- simulator-shape (no tools, large system)")
    try:
        async for ev in chat_completion_stream(
            base_url=base_url,
            api_key=api_key,
            model=model,
            messages=[
                {"role": "system", "content": sim_system},
                {"role": "user", "content": sim_user},
            ],
            tools=None,
            temperature=0.8,
            max_tokens=300,
            extra_headers=extra_headers,
            reasoning_effort=None,            # simulator passes None
            chat_template_kwargs={},          # simulator passes empty dict
        ):
            if ev.done:
                print(f"  [stream simulator] done tokens_in={ev.tokens_in} tokens_out={ev.tokens_out} content_len={len(ev.full_text)}")
                print(f"    text[:200]={ev.full_text[:200]!r}")
                break
    except Exception as e:  # noqa: BLE001
        print(f"  [stream simulator] ERROR: {e!r}")
    print()

    for prompt in PROMPTS:
        print(f"--- prompt: {prompt!r}")
        # 1) Non-streaming
        try:
            r = await chat_completion(
                base_url=base_url,
                api_key=api_key,
                model=model,
                messages=[{"role": "user", "content": prompt}],
                tools=TOOLS,
                temperature=0.2,
                max_tokens=512,
                extra_headers=extra_headers,
                reasoning_effort=reasoning,
                chat_template_kwargs=chat_kwargs,
            )
            print(f"  [non-stream] tool_calls={len(r.tool_calls) if r.tool_calls else 0}, "
                  f"content_len={len(r.content)}, finish={r.finish_reason}")
            if r.tool_calls:
                for tc in r.tool_calls:
                    print(f"    -> {tc['function']['name']}({tc['function']['arguments']})")
            elif r.content:
                snippet = r.content[:240].replace("\n", " ")
                print(f"    content[:240]={snippet!r}")
                # Was a sentinel buried in there?
                fb, _ = parse_inline_tool_calls(r.content)
                if fb:
                    print(f"    !! inline sentinel recoverable; {len(fb)} call(s)")
        except Exception as e:  # noqa: BLE001
            print(f"  [non-stream] ERROR: {e!r}")

        # 2) Streaming
        try:
            collected_text: list[str] = []
            structured: list[dict] | None = None
            async for ev in chat_completion_stream(
                base_url=base_url,
                api_key=api_key,
                model=model,
                messages=[{"role": "user", "content": prompt}],
                tools=TOOLS,
                temperature=0.2,
                max_tokens=512,
                extra_headers=extra_headers,
                reasoning_effort=reasoning,
                chat_template_kwargs=chat_kwargs,
            ):
                if ev.delta and not ev.reasoning:
                    collected_text.append(ev.delta)
                if ev.done:
                    structured = ev.tool_calls
                    final_text = ev.full_text
                    print(f"  [stream]     tool_calls={len(structured) if structured else 0}, "
                          f"full_text_len={len(final_text)}, tokens_in={ev.tokens_in}, "
                          f"tokens_out={ev.tokens_out}")
                    if structured:
                        for tc in structured:
                            print(f"    -> {tc['function']['name']}({tc['function']['arguments']})")
                    else:
                        snippet = final_text[:240].replace("\n", " ")
                        print(f"    full_text[:240]={snippet!r}")
                        fb, _ = parse_inline_tool_calls(final_text)
                        if fb:
                            print(f"    !! inline sentinel recoverable; {len(fb)} call(s)")
        except Exception as e:  # noqa: BLE001
            print(f"  [stream]     ERROR: {e!r}")

        print()

    await db.close_pool()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    asyncio.run(main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None))
