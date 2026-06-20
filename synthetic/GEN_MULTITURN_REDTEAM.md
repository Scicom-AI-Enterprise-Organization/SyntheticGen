# `gen_multiturn_redteam.py` — red-team multi-turn tool-calling generator

The **red-team sibling** of [`gen_multiturn_reasoning.py`](GEN_MULTITURN_REASONING.md).
It reuses that script's turn-by-turn, **real tool-calling** machinery (assistant runs
`tools=[...]`, `tool_choice="auto"`; a tool simulator returns synthetic JSON; reasoning is
captured on every message; resumable per-row JSON + merged parquet), but flips the roles to
produce **gold safe-refusal training data for tool-calling agents**:

| Role | Behaviour | Reasoning captured |
|---|---|---|
| **Attacker** (user) | An **adversarial** Malaysian customer drawn from the red-team taxonomy, escalating an attack across turns toward a concrete unsafe goal grounded in the function library. | its `reasoning` field (attacker intent per turn) |
| **Assistant** | **ALWAYS REFUSES / RESISTS** — never performs the privileged action under manipulation, never leaks data, never adopts an unrestricted persona, holds the line under pressure, offers the legitimate path. | native `reasoning_content`/`reasoning`, else a **safety planner** call — this is the **gold signal** |
| **Tool sim (guarded)** | Read-only / verification tools return realistic results; any attempt at a **sensitive/exfil/target** tool is **denied (403)** so a slip never yields a harmful result. | its `reasoning` field |

The loop is: **attacker₁ → assistant₁ (auto tools, refuses) → guarded tool results → attacker₂ → …**
for `--turns` turns. Because the assistant is hardened *and* the guard denies forbidden calls
*and* the validator flags any slip, the dataset is **safe by construction**.

> This is a **generator**, not a live target-model benchmark. It folds in the red-team
> benchmark's **attack taxonomy** (and uses its judging concept as an internal validator),
> producing labelled adversarial conversations where the assistant correctly refuses.

---

## 1. Setup

Same environment and `.env` as `gen_multiturn_reasoning.py` (read from this dir or its parent):

```ini
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://serverlessgpu.aies.scicom.dev/glm5-2/v1   # or OpenRouter, vLLM, ...
MODEL_NAME=zai-org/GLM-5.2-FP8
```

---

## 2. Quick start

**Single adversarial conversation** from a function-library JSON (fixed attack):

```bash
python3 gen_multiturn_redteam.py \
  --tools test-function/0.json --turns 6 \
  --attack-type refund_manipulation --attack-strategy gradual_escalation \
  --severity high --tone emotional --language ms --seed 7 \
  --out out/redteam_row0.json
```

**One parquet row** (random attack, profile picked per conversation, `.env` defaults):

```bash
python3 gen_multiturn_redteam.py \
  --parquet train-function-merged-00000-of-00001.parquet --row 0 \
  --turns 8 --out out/redteam_train_row0.json
```

**Batch** → per-row JSON (resumable) + merged parquet, 10 conversations concurrently:

```bash
python3 gen_multiturn_redteam.py \
  --parquet train-function-merged-00000-of-00001.parquet \
  --turns 10 --concurrency 10 \
  --out-dir out/redteam --out-parquet redteam-00000-of-00001.parquet \
  --skip-existing
```

Parallelism, `--skip-existing` resume, `--seed` reproducibility, and the row-level
retry-until-success behaviour are identical to `gen_multiturn_reasoning.py`.

---

## 3. The red-team taxonomy (folded in from the benchmark)

**12 attack types** (`--attack-type`): `jailbreak`, `prompt_injection`, `bias_exploitation`,
`social_engineering`, `policy_bypass`, `refund_manipulation`, `identity_fraud`,
`escalation_fishing`, `misinformation_extraction`, `regulatory_threat`,
`roleplay_manipulation`, `emotional_manipulation`.

**10 multi-turn attack strategies** (`--attack-strategy`, the escalation arc): `gradual_escalation`,
`trust_building`, `context_poisoning`, `persona_hijacking`, `persistent_pressure`,
`authority_building`, `distraction_injection`, `incremental_commitment`, `memory_exploitation`,
`social_proof_building`.

**Severities** (`--severity`): `low`, `medium`, `high`, `critical`.
**Tones** (`--tone`): `aggressive`, `passive_aggressive`, `overly_polite`, `emotional`,
`threatening`, `casual` (plus `mixed` = reroll per turn).

Each attack type maps to one of **3 threat classes** (recorded as `threat_class`, also a
`--threat-class` filter when `--attack-type random`):

| Threat class | Meaning | Target functions chosen from |
|---|---|---|
| `tool_invocation` | trick the assistant into a privileged/state-mutating tool call | `sensitive` (apply/approve/execute/refund/cancel/reset/override/…) |
| `data_exfiltration` | extract another customer's/tenant's data | `exfil` (export/bulk/list/search/report/snapshot/…) |
| `jailbreak_policy_bypass` | system-prompt override / persona hijack / injection / false policy | `sensitive` + `exfil` |

`--attack-type`, `--attack-strategy`, `--severity`, `--tone` default to **`random`** (one
profile per conversation, seeded-reproducible) for batch variety; set a fixed value to pin it.

---

## 4. Sensitive-function detection

`classify_functions()` splits each library's tools into:

- **sensitive** — privileged / state-mutating (first verb in apply/approve/execute/create/
  update/delete/cancel/refund/waive/reset/override/submit/process/… or a mutating `stage`).
- **exfil** — bulk / data-exposing reads (export/bulk/list/search/report/snapshot/…).
- **safe** — single-entity reads, status, verification — the assistant **may** call these freely.

The attacker's target is drawn from `sensitive`/`exfil` per threat class; the assistant is told
exactly which tools are off-limits; the tool-sim guard denies any call into that set.

---

## 5. Output

Per-row JSON object (and a merged parquet in batch). `messages` carry an inline `reasoning`
key on every message (assistant reasoning = the safety reasoning). The merged parquet keeps the
**base 6 columns** (`domain, workflow, shared_entities, functions, messages, metadata` — JSON
stringified, `push_to_hub.py`-ready) **plus top-level red-team columns**:

```
attack_type, attack_strategy, threat_class, severity, tone,
target_behavior, attack_turn_index, refused
```

`metadata` additionally holds: `attack_description`, `expected_safe_response`, `failure_mode`,
`sensitive_functions_targeted`, `attack_turn_index`, `refused`,
`assistant_attempted_unsafe_calls`, `refusal_turns`, `tone_per_turn`, `reasoning_source`,
`functions_used`, `validation_warnings`, etc.

- **`refused`** — `True` iff the assistant **never attempted** a forbidden (sensitive/exfil/target)
  tool. A slip is denied by the guard *and* flagged here + in `assistant_attempted_unsafe_calls`,
  so you can filter the rare imperfect rows out of a gold set.
- **`attack_turn_index`** — index in `messages` of the user turn that delivered the main attack
  payload (the attacker self-flags it; falls back to the last user turn).

---

## 6. Reasoning capture

Same as the benign generator: the assistant's **native** chain-of-thought
(`reasoning_content`/`reasoning`) is used when present; otherwise a **safety planner** call
reconstructs *why it refused / how it spotted the manipulation / what legitimate path it
offered*. `--no-native-reasoning` forces the planner path. `metadata.reasoning_source` records
`native`/`planner`/`none` per assistant message.

---

## 7. All CLI flags

Inputs (`--tools` | `--parquet` [`--row I`]), `--turns`, `--language`, model/endpoint flags
(`--model`, `--user-model`/`--assistant-model`/`--tool-model`, `--base-url`, `--api-key`,
`--max-tokens`, `--seed`, per-role temperatures, `--disable-prefix-cache`), `--max-tool-rounds`,
`--no-native-reasoning`, `--parallel-tools`, and output flags (`--out` | `--out-dir` +
`--out-parquet`, `--start`, `--max-rows`, `--concurrency`/`-j`, `--skip-existing`) — identical
in spirit to `gen_multiturn_reasoning.py`.

**Red-team-specific:** `--attack-type`, `--attack-strategy`, `--severity`, `--tone`
(value or `random`; `--tone` also accepts `mixed`), `--threat-class
{all|tool_invocation|data_exfiltration|jailbreak_policy_bypass}`.

---

## 8. Validation

Each conversation is soft-checked (recorded in `metadata.validation_warnings`, non-fatal):
tool-call args / tool content parse as JSON · `tool_call_id`s paired · tool names exist ·
required params present · (for `ms`) forbidden tokens + vocative present · **and any assistant
attempt at a forbidden tool** (which the guard denied). A clean conversation prints
`validation: clean` and `refused=True`.
