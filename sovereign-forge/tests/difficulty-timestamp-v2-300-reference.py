#!/usr/bin/env python3
import json
from pathlib import Path

RADIX = 65536
MAX_HASH = (1 << 256) - 1
POW_LIMIT = MAX_HASH >> 12


def trunc_div(numerator: int, denominator: int) -> int:
    if denominator == 0:
        raise ZeroDivisionError("division_by_zero")
    if numerator >= 0:
        return numerator // denominator
    return -((-numerator) // denominator)


def asert_target(*, anchor_target: int, anchor_height: int, anchor_parent_time_seconds: int,
                 evaluation_height: int, evaluation_time_seconds: int,
                 target_seconds: int, half_life_seconds: int, pow_limit: int = POW_LIMIT) -> int:
    if evaluation_height < anchor_height:
        raise ValueError("evaluation_before_anchor")
    if not (0 < anchor_target <= pow_limit <= MAX_HASH):
        raise ValueError("invalid_target_bounds")

    time_delta = evaluation_time_seconds - anchor_parent_time_seconds
    height_delta = evaluation_height - anchor_height
    exponent = trunc_div(
        (time_delta - target_seconds * (height_delta + 1)) * RADIX,
        half_life_seconds,
    )

    # Python // is floor division, matching the JS candidate's floorDivRadix.
    num_shifts = exponent // RADIX
    exponent -= num_shifts * RADIX

    factor = (
        (
            195766423245049 * exponent
            + 971821376 * exponent * exponent
            + 5127 * exponent * exponent * exponent
            + (1 << 47)
        )
        >> 48
    ) + RADIX

    next_target = anchor_target * factor
    if num_shifts < 0:
        next_target >>= -num_shifts
    else:
        next_target <<= num_shifts
    next_target >>= 16

    if next_target <= 0:
        return 1
    return min(next_target, pow_limit)


def target_hex(target: int) -> str:
    if not (0 < target <= MAX_HASH):
        raise ValueError("target_out_of_range")
    return f"{target:064x}"


def median_time_past(timestamps, window=11):
    values = sorted(timestamps[-window:])
    if not values:
        return None
    return values[len(values) // 2]


def validate_timestamp(timestamps, timestamp_ms, *, now_ms, window=11, future_drift_ms=90_000):
    previous = timestamps[-1] if timestamps else None
    mtp = median_time_past(timestamps, window)
    max_future = now_ms + future_drift_ms
    if previous is not None and timestamp_ms < previous:
        return {"ok": False, "error": "timestamp_before_parent"}
    if mtp is not None and timestamp_ms <= mtp:
        return {"ok": False, "error": "timestamp_not_above_mtp"}
    if timestamp_ms > max_future:
        return {"ok": False, "error": "timestamp_too_far_future"}
    return {"ok": True}


vectors_path = Path(__file__).resolve().parents[1] / "protocol" / "DIFFICULTY_TIMESTAMP_V2_300_VECTORS.json"
vectors = json.loads(vectors_path.read_text())
params = vectors["parameters"]
assert vectors["status"] == "candidate-not-active-consensus"
assert params["target_seconds"] == 300
assert params["mtp_window"] == 11
assert params["future_drift_ms"] == 90_000
assert params["half_life_seconds"] == 21_600

a = vectors["asert"]
anchor_target = int(a["anchor_target_hex"], 16)
for vector in a["vectors"]:
    result = asert_target(
        anchor_target=anchor_target,
        anchor_height=a["anchor_height"],
        anchor_parent_time_seconds=a["anchor_parent_time_seconds"],
        evaluation_height=a["evaluation_height"],
        evaluation_time_seconds=vector["evaluation_time_seconds"],
        target_seconds=params["target_seconds"],
        half_life_seconds=params["half_life_seconds"],
    )
    assert target_hex(result) == vector["expected_target_hex"], vector["name"]

t = vectors["timestamp"]
timestamps = t["recent_chain_timestamps_ms"]
assert median_time_past(timestamps, params["mtp_window"]) == t["expected_mtp_ms"]
for vector in t["vectors"]:
    result = validate_timestamp(
        timestamps,
        vector["timestamp_ms"],
        now_ms=t["now_ms"],
        window=params["mtp_window"],
        future_drift_ms=params["future_drift_ms"],
    )
    assert result["ok"] == vector["ok"], vector["name"]
    if not vector["ok"]:
        assert result["error"] == vector["error"], vector["name"]

assert a["on_schedule_time_seconds"] - a["anchor_parent_time_seconds"] == 300 * (
    a["evaluation_height"] - a["anchor_height"] + 1
)

print("difficulty-timestamp-v2-300-reference: PASS")
