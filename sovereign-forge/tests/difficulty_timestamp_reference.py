#!/usr/bin/env python3
"""Independent FAE Difficulty + Timestamp reference implementation.

This file intentionally does not import or execute the JavaScript candidate. It
reimplements the frozen candidate arithmetic from the protocol vectors so CI can
catch cross-runtime or language-semantics divergence before activation.
"""
from __future__ import annotations

import json
from pathlib import Path

RADIX = 65536
MAX_HASH = (1 << 256) - 1


def trunc_div(numerator: int, denominator: int) -> int:
    if denominator == 0:
        raise ZeroDivisionError("division_by_zero")
    quotient = abs(numerator) // abs(denominator)
    return -quotient if (numerator < 0) != (denominator < 0) else quotient


def floor_div_radix(value: int) -> int:
    return value // RADIX


def target_from_hex(value: str) -> int:
    if len(value) != 64:
        raise ValueError("invalid_target_hex")
    target = int(value, 16)
    if target <= 0 or target > MAX_HASH:
        raise ValueError("target_out_of_range")
    return target


def target_hex(target: int) -> str:
    if target <= 0 or target > MAX_HASH:
        raise ValueError("target_out_of_range")
    return f"{target:064x}"


def asert_target(*, anchor_target: int, anchor_height: int, anchor_parent_time_seconds: int,
                 evaluation_height: int, evaluation_time_seconds: int,
                 target_seconds: int, half_life_seconds: int, pow_limit: int) -> int:
    if evaluation_height < anchor_height:
        raise ValueError("evaluation_before_anchor")
    if not (0 < anchor_target <= pow_limit <= MAX_HASH):
        raise ValueError("invalid_target_bounds")
    time_delta = evaluation_time_seconds - anchor_parent_time_seconds
    height_delta = evaluation_height - anchor_height
    exponent = trunc_div((time_delta - target_seconds * (height_delta + 1)) * RADIX, half_life_seconds)
    shifts = floor_div_radix(exponent)
    exponent -= shifts * RADIX
    factor = ((195766423245049 * exponent + 971821376 * exponent * exponent +
               5127 * exponent * exponent * exponent + (1 << 47)) >> 48) + RADIX
    target = anchor_target * factor
    if shifts < 0:
        target >>= -shifts
    else:
        target <<= shifts
    target >>= 16
    if target <= 0:
        return 1
    return min(target, pow_limit)


def median_time_past(timestamps: list[int], window: int) -> int | None:
    if not timestamps:
        return None
    values = sorted(timestamps[-window:])
    return values[len(values) // 2]


def validate_timestamp(timestamps: list[int], timestamp: int, *, now_ms: int,
                       window: int, future_drift_ms: int) -> tuple[bool, str | None]:
    parent = timestamps[-1] if timestamps else None
    mtp = median_time_past(timestamps, window)
    if parent is not None and timestamp < parent:
        return False, "timestamp_before_parent"
    if mtp is not None and timestamp <= mtp:
        return False, "timestamp_not_above_mtp"
    if timestamp > now_ms + future_drift_ms:
        return False, "timestamp_too_far_future"
    return True, None


def main() -> None:
    vector_path = Path(__file__).resolve().parents[1] / "protocol" / "DIFFICULTY_TIMESTAMP_VECTORS.json"
    vectors = json.loads(vector_path.read_text(encoding="utf-8"))
    params = vectors["parameters"]
    assert vectors["status"] == "candidate-not-active-consensus"
    assert params == {
        "target_seconds": 180,
        "mtp_window": 11,
        "future_drift_ms": 90000,
        "testnet_candidate_half_life_seconds": 21600,
        "half_life_candidates_seconds": [21600, 43200, 86400, 172800],
        "candidate_min_leading_zero_bits": 12,
    }

    a = vectors["asert"]
    anchor = target_from_hex(a["anchor_target_hex"])
    pow_limit = MAX_HASH >> params["candidate_min_leading_zero_bits"]
    for vector in a["vectors"]:
        actual = asert_target(
            anchor_target=anchor,
            anchor_height=a["anchor_height"],
            anchor_parent_time_seconds=a["anchor_parent_time_seconds"],
            evaluation_height=a["evaluation_height"],
            evaluation_time_seconds=vector["evaluation_time_seconds"],
            target_seconds=params["target_seconds"],
            half_life_seconds=a["half_life_seconds"],
            pow_limit=pow_limit,
        )
        assert target_hex(actual) == vector["expected_target_hex"], vector["name"]

    t = vectors["timestamp"]
    timestamps = t["recent_chain_timestamps_ms"]
    assert median_time_past(timestamps, params["mtp_window"]) == t["expected_mtp_ms"]
    for vector in t["vectors"]:
        ok, error = validate_timestamp(
            timestamps,
            vector["timestamp_ms"],
            now_ms=t["now_ms"],
            window=params["mtp_window"],
            future_drift_ms=params["future_drift_ms"],
        )
        assert ok is vector["ok"], vector["name"]
        if not ok:
            assert error == vector["error"], vector["name"]

    print("independent-python-reference: PASS")


if __name__ == "__main__":
    main()
