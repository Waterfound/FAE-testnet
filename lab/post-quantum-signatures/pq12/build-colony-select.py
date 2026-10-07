import json
from pathlib import Path
from build_colony.work_selection import (
    ActiveGateClass,
    GateRelation,
    HardStopReason,
    PackageGateBinding,
    RouteControl,
    RouteState,
    WorkSelectionContract,
    select_gate_directed_work,
)

packages = (
    PackageGateBinding("static-browser-harness", GateRelation.DIRECT, "browser-route"),
    PackageGateBinding("isolated-preview-transport", GateRelation.REQUIRED_SERIAL_DEPENDENCY, "browser-route"),
    PackageGateBinding("dedicated-app-replit", GateRelation.NONE, "dedicated-app"),
    PackageGateBinding("integrate-into-live-testnet", GateRelation.NONE, "testnet-integration"),
)

routes = (
    RouteControl(
        route_id="browser-route",
        state=RouteState.ACTIVE,
        evidence_reason="Directly materializes the optional PQ-12 physical-device evidence with minimum user effort.",
    ),
    RouteControl(
        route_id="dedicated-app",
        state=RouteState.STOPPED,
        evidence_reason="Adds a persistent application without improving the requested evidence.",
        hard_stop_reason=HardStopReason.WRONG_PROJECT_PHASE,
    ),
    RouteControl(
        route_id="testnet-integration",
        state=RouteState.STOPPED,
        evidence_reason="Couples an optional evidence test to the live testnet surface unnecessarily.",
        hard_stop_reason=HardStopReason.WRONG_PROJECT_PHASE,
    ),
)

contract = WorkSelectionContract(
    active_gate_class=ActiveGateClass.EVIDENCE_ACQUISITION,
    native_progress_unit="pq12_light_physical_device_evidence_packet",
    package_bindings=packages,
    routes=routes,
    recent_run_native_deltas=(),
    repeated_unexplained_boundary=False,
    generic_development_proposed=False,
)

decision = select_gate_directed_work(
    [
        "static-browser-harness",
        "isolated-preview-transport",
        "dedicated-app-replit",
        "integrate-into-live-testnet",
    ],
    contract,
)

expected_eligible = ("isolated-preview-transport", "static-browser-harness")
if decision.eligible_domains != expected_eligible:
    raise SystemExit(f"unexpected eligible domains: {decision.eligible_domains}")
if set(decision.filtered_domains) != {"dedicated-app-replit", "integrate-into-live-testnet"}:
    raise SystemExit(f"unexpected filtered domains: {decision.filtered_domains}")

out = {
    "schema": "FAE_PQ12_LIGHT_TEST_BUILD_COLONY_RUN_V1",
    "run_kind": "REAL_WORK_SELECTION_RUN",
    "project": "FAE",
    "active_gate_class": decision.active_gate_class.value if decision.active_gate_class else None,
    "native_progress_unit": decision.native_progress_unit,
    "eligible_domains": list(decision.eligible_domains),
    "filtered_domains": list(decision.filtered_domains),
    "route_dispositions": [
        {
            "route_id": r.route_id,
            "state": r.state.value,
            "reason": r.reason,
            "saturation_suspended": r.saturation_suspended,
        }
        for r in decision.route_dispositions
    ],
    "di_escalation_recommended": decision.di_escalation_recommended,
    "di_escalation_reasons": list(decision.di_escalation_reasons),
    "campaign_decision": {
        "selected_architecture": "single static browser-only harness",
        "transport": "isolated free preview/static host",
        "persistent_backend": False,
        "fae_rpc": False,
        "wallet_import": False,
        "real_user_keys": False,
        "active_testnet_integration": False,
        "user_actions": ["open link", "tap Start", "copy result"],
        "device_load": "light",
        "algorithms": ["ML-DSA-44", "ML-DSA-65", "ML-DSA-87"],
        "iterations": {"warmup_per_set": 1, "measured_per_set": 3},
        "slh_dsa_included": False,
    },
    "stop_rule": "Do not create a dedicated app/system or modify the live testnet unless new evidence proves the static-browser route insufficient.",
}
Path("lab/post-quantum-signatures/pq12/build-colony-selection-output.json").write_text(
    json.dumps(out, indent=2) + "\n", encoding="utf-8"
)
print(json.dumps(out, indent=2))
