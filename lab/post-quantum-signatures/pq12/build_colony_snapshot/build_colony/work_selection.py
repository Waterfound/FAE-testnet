from __future__ import annotations

import re
from dataclasses import dataclass
from enum import Enum
from typing import Iterable


class WorkSelectionError(ValueError):
    """Raised when an AGDWS contract cannot be evaluated safely."""


class ActiveGateClass(str, Enum):
    ENGINEERING_DEFECT = "engineering_defect"
    EVIDENCE_MATERIALIZATION = "evidence_materialization"
    EVIDENCE_ACQUISITION = "evidence_acquisition"
    EXTERNAL_DEPENDENCY = "external_dependency"
    RUNTIME_ENVIRONMENT_FAILURE = "runtime_environment_failure"
    VALIDATION_ADMISSION = "validation_admission"
    AUTHORITY_HUMAN_GATE = "authority_human_gate"
    CAPABILITY_GAP = "capability_gap"


class GateRelation(str, Enum):
    DIRECT = "direct"
    REQUIRED_SERIAL_DEPENDENCY = "required_serial_dependency"
    NONE = "none"


class RouteState(str, Enum):
    ACTIVE = "active"
    DEFERRED = "deferred"
    STOPPED = "stopped"


class HardStopReason(str, Enum):
    INACCESSIBLE_OR_PRIVATE = "inaccessible_or_private_under_current_authority"
    INSUFFICIENT_HISTORY = "insufficient_history"
    SEMANTICALLY_INSUFFICIENT_PROXY = "semantically_insufficient_proxy"
    DUPLICATE_ROUTE_OR_EVIDENCE = "duplicate_route_or_evidence"
    AUTHORITY_OR_HUMAN_GATE = "authority_or_human_gate_reached"
    WRONG_PROJECT_PHASE = "wrong_project_phase_or_no_plausible_active_gate_contribution"


def _immutable_evidence_ref(value: str | None) -> bool:
    """Return whether a capability-gap reference is immutable enough for admission.

    This is a provenance floor, not a sufficiency judgment. Target-owned evidence
    policy remains responsible for deciding whether the referenced evidence is
    adequate to classify a capability gap.
    """
    if value is None:
        return False
    candidate = value.strip()
    if not candidate:
        return False
    if re.fullmatch(r"sha256:[0-9a-f]{64}", candidate):
        return True
    if re.search(r"@[0-9a-f]{40}(?::|$)", candidate):
        return True
    return candidate.startswith("artifact:") and len(candidate) > len("artifact:")


@dataclass(frozen=True)
class RouteAttempt:
    attempt_id: str
    boundary: str
    native_progress_delta: int | float

    def __post_init__(self) -> None:
        if not self.attempt_id.strip():
            raise WorkSelectionError("route attempt_id must be non-empty")
        if not self.boundary.strip():
            raise WorkSelectionError("route boundary must be non-empty")
        if self.native_progress_delta < 0:
            raise WorkSelectionError("native_progress_delta cannot be negative")


@dataclass(frozen=True)
class RouteControl:
    route_id: str
    state: RouteState
    evidence_reason: str
    attempts: tuple[RouteAttempt, ...] = ()
    hard_stop_reason: HardStopReason | None = None
    reopen_basis: str | None = None

    def __post_init__(self) -> None:
        if not self.route_id.strip():
            raise WorkSelectionError("route_id must be non-empty")
        if not self.evidence_reason.strip():
            raise WorkSelectionError("route evidence_reason must be non-empty")
        if self.state is RouteState.STOPPED and self.hard_stop_reason is None:
            raise WorkSelectionError("stopped route requires hard_stop_reason")
        if self.hard_stop_reason is not None and self.state is not RouteState.STOPPED:
            raise WorkSelectionError("hard_stop_reason is valid only for stopped routes")
        if self.reopen_basis is not None and not self.reopen_basis.strip():
            raise WorkSelectionError("reopen_basis must be non-empty when present")
        ids = [attempt.attempt_id for attempt in self.attempts]
        if len(ids) != len(set(ids)):
            raise WorkSelectionError(f"duplicate attempt_id in route {self.route_id}")


@dataclass(frozen=True)
class PackageGateBinding:
    domain_id: str
    relation: GateRelation
    route_id: str | None = None

    def __post_init__(self) -> None:
        if not self.domain_id.strip():
            raise WorkSelectionError("domain_id must be non-empty")
        if self.route_id is not None and not self.route_id.strip():
            raise WorkSelectionError("route_id must be non-empty when present")


@dataclass(frozen=True)
class WorkSelectionContract:
    active_gate_class: ActiveGateClass | None
    native_progress_unit: str
    package_bindings: tuple[PackageGateBinding, ...]
    routes: tuple[RouteControl, ...] = ()
    recent_run_native_deltas: tuple[int | float, ...] = ()
    repeated_unexplained_boundary: bool = False
    generic_development_proposed: bool = False
    active_gate_evidence_ref: str | None = None

    def __post_init__(self) -> None:
        if not self.native_progress_unit.strip():
            raise WorkSelectionError("native_progress_unit must be non-empty")
        if (
            self.active_gate_class is ActiveGateClass.CAPABILITY_GAP
            and not _immutable_evidence_ref(self.active_gate_evidence_ref)
        ):
            raise WorkSelectionError("capability_gap_requires_immutable_evidence_ref")
        domains = [binding.domain_id for binding in self.package_bindings]
        if len(domains) != len(set(domains)):
            raise WorkSelectionError("package_bindings must be unique by domain_id")
        route_ids = [route.route_id for route in self.routes]
        if len(route_ids) != len(set(route_ids)):
            raise WorkSelectionError("routes must be unique by route_id")
        known_routes = set(route_ids)
        for binding in self.package_bindings:
            if binding.route_id is not None and binding.route_id not in known_routes:
                raise WorkSelectionError(
                    f"package {binding.domain_id} references unknown route {binding.route_id}"
                )
        if any(delta < 0 for delta in self.recent_run_native_deltas):
            raise WorkSelectionError("recent native progress deltas cannot be negative")


@dataclass(frozen=True)
class RouteDisposition:
    route_id: str
    state: RouteState
    reason: str
    saturation_suspended: bool


@dataclass(frozen=True)
class WorkSelectionDecision:
    active_gate_class: ActiveGateClass | None
    native_progress_unit: str
    eligible_domains: tuple[str, ...]
    filtered_domains: tuple[str, ...]
    route_dispositions: tuple[RouteDisposition, ...]
    di_escalation_recommended: bool
    di_escalation_reasons: tuple[str, ...]


def _saturation_suspended(route: RouteControl) -> bool:
    if route.reopen_basis:
        return False
    if len(route.attempts) < 2:
        return False
    left, right = route.attempts[-2:]
    return (
        left.attempt_id != right.attempt_id
        and left.boundary == right.boundary
        and left.native_progress_delta == 0
        and right.native_progress_delta == 0
    )


def effective_route_state(route: RouteControl) -> RouteDisposition:
    if route.state is RouteState.STOPPED:
        return RouteDisposition(
            route_id=route.route_id,
            state=RouteState.STOPPED,
            reason=f"hard_stop:{route.hard_stop_reason.value}",
            saturation_suspended=False,
        )
    if route.reopen_basis:
        return RouteDisposition(
            route_id=route.route_id,
            state=RouteState.ACTIVE,
            reason=f"reopened:{route.reopen_basis}",
            saturation_suspended=False,
        )
    if _saturation_suspended(route):
        return RouteDisposition(
            route_id=route.route_id,
            state=RouteState.DEFERRED,
            reason="saturation_suspend:two_distinct_same_boundary_zero_delta_attempts",
            saturation_suspended=True,
        )
    return RouteDisposition(
        route_id=route.route_id,
        state=route.state,
        reason=route.evidence_reason,
        saturation_suspended=False,
    )


def _di_escalation_reasons(contract: WorkSelectionContract) -> tuple[str, ...]:
    reasons: list[str] = []
    if contract.active_gate_class is None:
        reasons.append("active_gate_unclassified")
    if (
        len(contract.recent_run_native_deltas) >= 2
        and contract.recent_run_native_deltas[-1] == 0
        and contract.recent_run_native_deltas[-2] == 0
        and not any(route.state is RouteState.STOPPED for route in contract.routes)
    ):
        reasons.append("two_consecutive_zero_yield_runs_without_hard_external_gate")
    if contract.repeated_unexplained_boundary:
        reasons.append("independent_workers_repeat_unexplained_boundary")
    if (
        contract.generic_development_proposed
        and contract.active_gate_class
        not in {ActiveGateClass.ENGINEERING_DEFECT, ActiveGateClass.CAPABILITY_GAP}
    ):
        reasons.append("generic_development_without_demonstrated_engineering_defect")
    return tuple(reasons)


def select_gate_directed_work(
    dispatchable_domains: Iterable[str],
    contract: WorkSelectionContract,
) -> WorkSelectionDecision:
    """Apply AGDWS before the existing Build Colony deterministic planner.

    This function only filters the candidate frontier. It does not assign runners,
    mutate the ledger, verify evidence, integrate changes, or invoke DI.
    """
    ordered_domains = tuple(sorted(set(dispatchable_domains)))
    bindings = {binding.domain_id: binding for binding in contract.package_bindings}
    missing = [domain for domain in ordered_domains if domain not in bindings]
    if missing:
        raise WorkSelectionError(
            "dispatchable domains missing gate relation binding: " + ", ".join(missing)
        )

    dispositions = tuple(
        effective_route_state(route)
        for route in sorted(contract.routes, key=lambda item: item.route_id)
    )
    route_state = {item.route_id: item.state for item in dispositions}

    eligible: list[str] = []
    filtered: list[str] = []
    for domain in ordered_domains:
        binding = bindings[domain]
        gate_relevant = binding.relation in {
            GateRelation.DIRECT,
            GateRelation.REQUIRED_SERIAL_DEPENDENCY,
        }
        route_active = (
            binding.route_id is None
            or route_state[binding.route_id] is RouteState.ACTIVE
        )
        if contract.active_gate_class is not None and gate_relevant and route_active:
            eligible.append(domain)
        else:
            filtered.append(domain)

    escalation_reasons = _di_escalation_reasons(contract)
    return WorkSelectionDecision(
        active_gate_class=contract.active_gate_class,
        native_progress_unit=contract.native_progress_unit,
        eligible_domains=tuple(eligible),
        filtered_domains=tuple(filtered),
        route_dispositions=dispositions,
        di_escalation_recommended=bool(escalation_reasons),
        di_escalation_reasons=escalation_reasons,
    )
