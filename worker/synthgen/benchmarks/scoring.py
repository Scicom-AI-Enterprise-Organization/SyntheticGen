"""Scoring logic for the function-call benchmark.

Direct port from
https://github.com/Scicom-AI-Enterprise-Organization/small-ablation/blob/main/function-call-benchmark/main.py
so results are directly comparable. The benchmark scores predicted vs. expected
tool_calls turn-by-turn and rolls up to per-split + overall metrics.

This module is deliberately self-contained — `evaluate_multiple_tool_calls`
takes plain Python data structures (lists of {function: {name, arguments}}
dicts), not OpenAI SDK objects, so the rest of the worker can use any HTTP
client.
"""
from __future__ import annotations

import json
from collections import defaultdict
from difflib import SequenceMatcher
from typing import Any


def calc_similarity(expected: Any, actual: Any) -> float:
    """Recursive structural similarity. Mirrors main.py:calc_similarity."""
    if type(expected) != type(actual):
        return 0.0
    if isinstance(expected, dict):
        if not expected and not actual:
            return 1.0
        keys = set(expected.keys()) | set(actual.keys())
        if not keys:
            return 1.0
        score = 0.0
        for k in keys:
            if k in expected and k in actual:
                score += calc_similarity(expected[k], actual[k])
        return score / len(keys)
    if isinstance(expected, list):
        if not expected and not actual:
            return 1.0
        if len(expected) != len(actual):
            max_len = max(len(expected), len(actual))
            min_len = min(len(expected), len(actual))
            if min_len == 0:
                return 0.0
            score = sum(calc_similarity(expected[i], actual[i]) for i in range(min_len))
            return score / max_len
        if not expected:
            return 1.0
        total = sum(calc_similarity(e, a) for e, a in zip(expected, actual))
        return total / len(expected)
    if expected == actual:
        return 1.0
    if isinstance(expected, str) and isinstance(actual, str):
        return SequenceMatcher(None, expected.lower(), actual.lower()).ratio()
    return 0.0


def calc_param_accuracy(expected_params: dict, predicted_params: dict) -> tuple[float, int, int]:
    if not expected_params:
        return 1.0, 0, 0
    correct = 0
    total = len(expected_params)
    for key in expected_params:
        if key in predicted_params and expected_params[key] == predicted_params[key]:
            correct += 1
    return correct / total, correct, total


def _parse_args(s: Any) -> dict:
    if isinstance(s, dict):
        return s
    if not isinstance(s, str):
        return {}
    try:
        return json.loads(s)
    except (ValueError, TypeError):
        return {}


def evaluate_multiple_tool_calls(
    expected_calls: list[dict],
    predicted_calls: list[dict],
    api_failed: bool = False,
) -> list[dict]:
    """Score one turn's predicted vs expected tool calls.

    Each input call is a dict like {function: {name, arguments}} where arguments
    is a JSON string (OpenAI shape). Returns one result dict per evaluated call,
    with type ∈ {match, missing, extra}.
    """
    results: list[dict] = []

    if api_failed:
        for call in expected_calls:
            func_name = call.get("function", {}).get("name", "")
            exp_params = _parse_args(call.get("function", {}).get("arguments", ""))
            results.append(
                {
                    "type": "missing",
                    "function": func_name,
                    "func_match": False,
                    "param_accuracy": 0.0,
                    "correct_params": 0,
                    "total_params": len(exp_params),
                    "similarity": 0.0,
                    "expected_func": func_name,
                    "predicted_func": None,
                    "expected_params": exp_params,
                    "predicted_params": {},
                    "api_failed": True,
                }
            )
        return results

    # Compare positionally up to max length, then mark trailing extras/missing.
    max_len = max(len(expected_calls), len(predicted_calls))
    for i in range(max_len):
        if i < len(expected_calls) and i < len(predicted_calls):
            exp = expected_calls[i]
            pred = predicted_calls[i]
            exp_func = exp.get("function", {}).get("name", "")
            pred_func = pred.get("function", {}).get("name", "")
            exp_params = _parse_args(exp.get("function", {}).get("arguments", ""))
            pred_params = _parse_args(pred.get("function", {}).get("arguments", ""))

            func_match = exp_func == pred_func
            param_acc, correct, total = calc_param_accuracy(exp_params, pred_params)
            similarity = calc_similarity(exp_params, pred_params) if func_match else 0.0

            results.append(
                {
                    "type": "match",
                    "function": exp_func,
                    "func_match": func_match,
                    "param_accuracy": param_acc if func_match else 0.0,
                    "correct_params": correct if func_match else 0,
                    "total_params": total,
                    "similarity": similarity,
                    "expected_func": exp_func,
                    "predicted_func": pred_func,
                    "expected_params": exp_params,
                    "predicted_params": pred_params,
                    "api_failed": False,
                }
            )
        elif i < len(expected_calls):
            # Model produced fewer calls than expected — every missing slot scores zero.
            exp = expected_calls[i]
            func_name = exp.get("function", {}).get("name", "")
            exp_params = _parse_args(exp.get("function", {}).get("arguments", ""))
            results.append(
                {
                    "type": "missing",
                    "function": func_name,
                    "func_match": False,
                    "param_accuracy": 0.0,
                    "correct_params": 0,
                    "total_params": len(exp_params),
                    "similarity": 0.0,
                    "expected_func": func_name,
                    "predicted_func": None,
                    "expected_params": exp_params,
                    "predicted_params": {},
                    "api_failed": False,
                }
            )
        else:
            # Model produced extra calls.
            pred = predicted_calls[i]
            func_name = pred.get("function", {}).get("name", "")
            pred_params = _parse_args(pred.get("function", {}).get("arguments", ""))
            results.append(
                {
                    "type": "extra",
                    "function": func_name,
                    "func_match": False,
                    "param_accuracy": 0.0,
                    "correct_params": 0,
                    "total_params": 0,
                    "similarity": 0.0,
                    "expected_func": None,
                    "predicted_func": func_name,
                    "expected_params": {},
                    "predicted_params": pred_params,
                    "api_failed": False,
                }
            )

    return results


def aggregate_metrics(results: list[dict]) -> dict[str, Any]:
    """Roll per-call results into the metrics dict the UI displays."""
    if not results:
        return {
            "total_calls": 0,
            "total_turns": 0,
            "total_params": 0,
            "function_accuracy": 0.0,
            "parameter_accuracy": 0.0,
            "turn_level_parameter_accuracy": 0.0,
            "argument_similarity": 0.0,
        }

    valid = [r for r in results if not r.get("api_failed")]
    if not valid:
        return {
            "total_calls": 0,
            "total_calls_including_failures": len(results),
            "total_turns": 0,
            "total_params": 0,
            "function_accuracy": 0.0,
            "parameter_accuracy": 0.0,
            "turn_level_parameter_accuracy": 0.0,
            "argument_similarity": 0.0,
            "api_failed_calls": len(results),
        }

    total_calls = len(valid)
    correct_functions = sum(1 for r in valid if r["func_match"])
    total_params = sum(r["total_params"] for r in valid)
    correct_params = sum(r["correct_params"] for r in valid)
    total_similarity = sum(r["similarity"] for r in valid)

    turn_groups: dict[tuple[int, int], list[dict]] = defaultdict(list)
    for r in valid:
        turn_groups[(r["row"], r["turn"])].append(r)
    perfect_turns = sum(
        1
        for tr in turn_groups.values()
        if all(r["type"] == "match" and r["param_accuracy"] == 1.0 for r in tr)
    )
    turn_level = perfect_turns / len(turn_groups) if turn_groups else 0.0

    return {
        "total_calls": total_calls,
        "total_calls_including_failures": len(results),
        "total_turns": len(turn_groups),
        "total_params": total_params,
        "function_accuracy": correct_functions / total_calls if total_calls > 0 else 0.0,
        "parameter_accuracy": correct_params / total_params if total_params > 0 else 0.0,
        "turn_level_parameter_accuracy": turn_level,
        "perfect_parameter_turns": perfect_turns,
        "argument_similarity": total_similarity / total_calls if total_calls > 0 else 0.0,
        "api_failed_calls": len(results) - len(valid),
    }
