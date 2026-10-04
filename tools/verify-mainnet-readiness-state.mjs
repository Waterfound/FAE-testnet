import fs from "node:fs";

const readJson = (path) => JSON.parse(fs.readFileSync(path, "utf8"));
const fail = (message) => {
  console.error(`MAINNET_READINESS_VERIFY_FAIL: ${message}`);
  process.exitCode = 1;
};

const statePath = "docs/FAE_MAINNET_READINESS_STATE.json";
const registryPath = "docs/FAE_CANONICAL_STATE.md";

const state = readJson(statePath);
const registry = fs.readFileSync(registryPath, "utf8");
const ceiling = readJson("sovereign-forge/release/software-only-ceiling-freeze.json");
const wallet = readJson("docs/wallet-transaction-ux/wtx-07-publication-evidence.json");
const explorer = readJson("lab/block-explorer/gate-status.json");
const pq = readJson("lab/post-quantum-signatures/gate-status.json");
const security = readJson("docs/security/FAE_PSR19_BOUNDED_PROJECT_CLOSEOUT_V1.json");
const soak = readJson("sovereign-forge/release/stability-soak-v3-fallbacks.json");
const mining = readJson("lab/mining-tip-sync/evidence/mts-12-physical-attempt-003.json");

const expectedStates = [
  "DONE","ACTIVE","SECONDARY","CONDITION_WAIT","SCHEDULED","HUMAN_GATE",
  "EXTERNAL_EVIDENCE","RESEARCH_ONLY","BLOCKED","UNRESOLVED","CLOSED"
];
const expectedAuthorityClasses = [
  "ACTIVE_PUBLIC_TESTNET","EVIDENCE_ONLY","RESEARCH_ONLY","LAB_ONLY",
  "REHEARSAL_ONLY","PACKAGING_ONLY","VERIFICATION_ONLY","EXTERNAL_EVIDENCE",
  "HUMAN_AUTHORITY","DOCUMENTATION_ONLY","FINAL_PRODUCTION_AUTHORITY"
];

if (state.schema !== "FAE_MAINNET_READINESS_STATE_V1" || state.schema_version !== 1) {
  fail("unsupported readiness schema");
}
if (state.workstream_role !== "SECONDARY") fail("readiness workstream must remain SECONDARY");
if (JSON.stringify(state.state_taxonomy) !== JSON.stringify(expectedStates)) fail("state taxonomy drift");
if (JSON.stringify(state.authority_classes) !== JSON.stringify(expectedAuthorityClasses)) fail("authority class drift");
if (!/^[0-9a-f]{40}$/.test(state.generated_from_revision)) fail("generated_from_revision must be a commit SHA");

const gates = new Map();
for (const gate of state.gates ?? []) {
  if (!gate.gate_id || gates.has(gate.gate_id)) fail(`duplicate or empty gate_id: ${gate.gate_id}`);
  gates.set(gate.gate_id, gate);
  if (!expectedStates.includes(gate.state)) fail(`unsupported state on ${gate.gate_id}`);
  if (!expectedAuthorityClasses.includes(gate.authority_class)) fail(`unsupported authority class on ${gate.gate_id}`);
  if (!Array.isArray(gate.evidence_refs)) fail(`evidence_refs must be an array on ${gate.gate_id}`);
  if (!Array.isArray(gate.dependency_refs)) fail(`dependency_refs must be an array on ${gate.gate_id}`);
  if (typeof gate.human_action_required !== "boolean") fail(`human_action_required must be boolean on ${gate.gate_id}`);
  if (typeof gate.mainnet_critical !== "boolean") fail(`mainnet_critical must be boolean on ${gate.gate_id}`);
  if (typeof gate.can_auto_advance !== "boolean") fail(`can_auto_advance must be boolean on ${gate.gate_id}`);
  if (gate.human_action_required !== (gate.state === "HUMAN_GATE")) {
    fail(`HUMAN_GATE semantics violated on ${gate.gate_id}`);
  }
  if (gate.state === "HUMAN_GATE" && gate.can_auto_advance) {
    fail(`HUMAN_GATE cannot auto-advance: ${gate.gate_id}`);
  }
  if (["DONE","CLOSED"].includes(gate.state) && gate.evidence_refs.length === 0) {
    fail(`closed gate lacks evidence: ${gate.gate_id}`);
  }
  if (gate.state === "SCHEDULED" && !gate.wake_condition) {
    fail(`scheduled gate lacks wake condition: ${gate.gate_id}`);
  }
}
for (const gate of gates.values()) {
  for (const dep of gate.dependency_refs) {
    if (!gates.has(dep)) fail(`unknown dependency ${dep} on ${gate.gate_id}`);
  }
}

const requireGate = (id, expectedState) => {
  const gate = gates.get(id);
  if (!gate) return fail(`required gate missing: ${id}`);
  if (expectedState && gate.state !== expectedState) fail(`${id} expected ${expectedState}, observed ${gate.state}`);
  return gate;
};

requireGate("research_180s_validation", "ACTIVE");
requireGate("mainnet_readiness_reconciliation", "SECONDARY");
requireGate("preferred_future_economic_candidate", "CLOSED");
requireGate("authoritative_future_tokenomics_design", "DONE");
requireGate("wallet_transaction_ux", "DONE");
requireGate("stability_soak_v3", "SCHEDULED");
requireGate("block_explorer_independent_binding", "HUMAN_GATE");
requireGate("asic_resistance_f2", "HUMAN_GATE");
requireGate("mining_tip_stale_work_recovery", "HUMAN_GATE");
requireGate("post_quantum_signature_research", "RESEARCH_ONLY");
requireGate("public_code_security_baseline", "CLOSED");
requireGate("mainnet_authorization", "BLOCKED");

const live = state.authority_snapshot?.current_live_public_testnet;
if (
  live?.network !== "fairyelf-public-testnet-v4" ||
  live?.target_block_interval_seconds !== 180 ||
  live?.initial_subsidy_fae !== 10 ||
  live?.halving_era_blocks !== 600000 ||
  live?.maximum_supply_fae !== 12000000
) fail("live public-testnet authority drift");

const future = state.authority_snapshot?.preferred_future_research_candidate;
if (
  future?.target_block_interval_seconds !== 300 ||
  future?.initial_subsidy_fae !== 14 ||
  future?.halving_era_blocks !== 430000 ||
  future?.authority !== "RESEARCH_ONLY" ||
  future?.activation_height !== null ||
  future?.status !== "SUPERSEDED_AS_FUTURE_TOKENOMICS_PACKAGE__PRESERVED_AS_HISTORICAL_RESEARCH"
) fail("superseded future economic research package drift");

const tokenomics = state.authority_snapshot?.authoritative_future_tokenomics_design;
if (
  state.authority_snapshot?.tokenomics_design_authoritative !== true ||
  tokenomics?.subsidy_reduction_per_era_pct !== 45 ||
  tokenomics?.subsidy_retention_per_era_pct !== 55 ||
  tokenomics?.era_duration_calendar_years !== 6 ||
  tokenomics?.issuance_shape !== "FINITE_GEOMETRIC" ||
  tokenomics?.perpetual_tail_inflation !== false ||
  tokenomics?.initial_subsidy_fae?.value !== 10 ||
  tokenomics?.initial_subsidy_fae?.authoritative !== true ||
  tokenomics?.final_supply_fae?.value !== 14026000 ||
  tokenomics?.final_supply_fae?.authoritative !== true ||
  tokenomics?.final_supply_fae?.kind !== "HARD_MONETARY_CEILING" ||
  tokenomics?.final_block_target_seconds?.current_research_incumbent !== 300 ||
  tokenomics?.final_block_target_seconds?.authoritative !== false ||
  tokenomics?.derived_300s_alignment_candidate?.strict_six_year_blocks_per_era !== 631152 ||
  tokenomics?.derived_300s_alignment_candidate?.strict_six_year_scheduled_issuance_fae !== "14025599.85343248" ||
  tokenomics?.derived_300s_alignment_candidate?.cap_aligned_blocks_per_era !== 631170 ||
  tokenomics?.derived_300s_alignment_candidate?.cap_aligned_scheduled_issuance_fae !== "14025999.85342830" ||
  tokenomics?.derived_300s_alignment_candidate?.cap_aligned_unissued_remainder_fae !== "0.14657170" ||
  tokenomics?.authority !== "AUTHORITATIVE_DESIGN__NOT_ACTIVE_CONSENSUS" ||
  tokenomics?.authority_ref !== "docs/FAE_TOKENOMICS_AUTHORITY_20261004.json"
) fail("authoritative tokenomics design drift");

if (state.tokenomics_authority_updated_at !== "2026-10-04") {
  fail("tokenomics authority update timestamp drift");
}

if (state.authority_snapshot?.consensus_change_authorized !== false) fail("consensus authority must remain false");
if (state.authority_snapshot?.economic_candidate_promoted !== false) fail("economic candidate promotion must remain false");
if (state.authority_snapshot?.mainnet_launch_authorized !== false) fail("mainnet launch authority must remain false");
if (state.authority_snapshot?.mainnet_ready_claimed !== false) fail("MAINNET_READY must not be claimed");

const expectedCrossLab = ["LAB_VERIFIED","INTEGRATED_MAIN","COMBINED_MAIN_VERIFIED","LIVE"];
if (JSON.stringify(state.cross_lab_hierarchy) !== JSON.stringify(expectedCrossLab)) fail("cross-Lab hierarchy drift");

if (wallet.status !== "PUBLICATION_VERIFIED" || wallet.verdict !== "PASS") {
  fail("Wallet Transaction UX evidence no longer matches DONE classification");
}
if (explorer.public_frontend?.binding_state !== "UNBOUND" || explorer.https_independent_node_binding?.live_authorized !== false) {
  fail("Block Explorer evidence changed; reconcile before retaining HUMAN_GATE/NOT_LIVE state");
}
if (pq.active_frontier !== "SOFTWARE_ONLY_POST_QUANTUM_RESEARCH_CEILING_REACHED" || pq.activation_authorized !== false) {
  fail("PQ research evidence changed");
}
if (security.terminal_state_on_success !== "BASELINE_READY_FOR_RECURRING_ASSURANCE__BOUNDED_PROJECT_CLOSED") {
  fail("public-code security closeout evidence changed");
}
if (soak.common_invariants?.run_started !== false) fail("Stability Soak V3 started; scheduled state is stale");
if (mining.status !== "TIP_GATE_PASS_RESUME_METRIC_INVALID_FOR_RUNTIME_VERDICT") {
  fail("MTS-12 physical evidence changed; reconcile before retaining HUMAN_GATE state");
}

const unset = [...(ceiling.unresolved_final_freeze ?? [])].sort();
const recordedUnset = [...(state.final_production_values_unset ?? [])].sort();
if (JSON.stringify(unset) !== JSON.stringify(recordedUnset)) fail("final production freeze list drift");

for (const required of ["physical_hfb","representative_device","operational_soak","independent_operators"]) {
  if (!(ceiling.unresolved_external_evidence ?? []).includes(required)) {
    fail(`external-evidence baseline changed for ${required}`);
  }
}

for (const literal of [
  "network: `fairyelf-public-testnet-v4`",
  "target block interval: 180 seconds",
  "initial subsidy: 10 FAE/block",
  "halving era: 600,000 blocks",
  "maximum supply: 12,000,000 FAE"
]) {
  if (!registry.includes(literal)) fail(`canonical registry lost live authority literal: ${literal}`);
}

for (const literal of [
  "## Authoritative future tokenomics design",
  "subsidy reduction per era: **45%**",
  "retained subsidy per era: **55%**",
  "initial subsidy: **10 FAE/block**",
  "monetary ceiling is **14,026,000 FAE**",
  "target era duration: **6 calendar years**",
  "docs/FAE_TOKENOMICS_AUTHORITY_20261004.json",
  "Tokenomics authority updated: 2026-10-04"
]) {
  if (!registry.includes(literal)) fail(`canonical registry lost tokenomics authority literal: ${literal}`);
}

if (state.reconciliation_status === "CANONICAL_STATE_RECONCILED") {
  if (state.reconciliation_verdict !== "CANONICAL_STATE_RECONCILED") fail("reconciled state lacks matching verdict");
  if (!registry.includes("Last reviewed: 2026-09-28")) fail("reconciled registry review date missing");
  if (!registry.includes("docs/FAE_MAINNET_READINESS_STATE.json")) fail("registry does not reference readiness state");
  if (!registry.includes("Wallet Transaction UX")) fail("registry does not record Wallet Transaction UX");
} else if (state.reconciliation_status !== "CANDIDATE") {
  fail("unsupported reconciliation_status");
}

const reconciliationReport = readJson("docs/FAE_MAINNET_READINESS_RECONCILIATION_REPORT.json");
if (reconciliationReport.schema !== "FAE_MAINNET_READINESS_RECONCILIATION_REPORT_V1") {
  fail("unsupported reconciliation report schema");
}
if (reconciliationReport.source_main?.revision !== state.generated_from_revision) {
  fail("reconciliation report source main does not match readiness source revision");
}
if (reconciliationReport.crosscheck_candidate?.compare_to_main?.behind_by !== 0) {
  fail("reconciliation candidate was behind source main at MR-06 cross-check");
}
if (reconciliationReport.active_research_serialization_check?.touches_shared_registry !== false ||
    reconciliationReport.active_research_serialization_check?.touches_mainnet_readiness_state !== false ||
    (reconciliationReport.active_research_serialization_check?.shared_state_conflicts ?? []).length !== 0) {
  fail("active Research 180s shared-state serialization check is not clean");
}
if (reconciliationReport.exact_candidate_verification?.all_success !== true) {
  fail("MR-06 exact candidate verification did not record all-success");
}
for (const [name, value] of Object.entries(reconciliationReport.authority_checks ?? {})) {
  if (value !== false) fail(`reconciliation authority boundary changed: ${name}`);
}
for (const id of ["MR-00","MR-01","MR-02","MR-03","MR-04","MR-05","MR-06","MR-07"]) {
  if (reconciliationReport.frontiers?.[id] !== "PASS") fail(`${id} is not PASS in reconciliation report`);
}
if (reconciliationReport.mainnet_ready !== false) fail("reconciliation report must not claim MAINNET_READY");

if (state.reconciliation_status === "CANONICAL_STATE_RECONCILED") {
  if (reconciliationReport.frontiers?.["MR-08"] !== "PASS" ||
      reconciliationReport.frontiers?.["MR-09"] !== "PASS" ||
      reconciliationReport.verdict !== "CANONICAL_STATE_RECONCILED" ||
      reconciliationReport.canonical_state_reconciled !== true) {
    fail("final reconciliation report is inconsistent with reconciled readiness state");
  }
} else {
  if (reconciliationReport.canonical_state_reconciled !== false) {
    fail("candidate readiness state cannot claim canonical reconciliation");
  }
  const mr08Passed = reconciliationReport.frontiers?.["MR-08"] === "PASS";
  if (mr08Passed) {
    if (reconciliationReport.frontiers?.["MR-09"] !== "VERIFYING_CLOSURE_CANDIDATE" ||
        reconciliationReport.verdict !== "MR08_INDEPENDENT_VERIFICATION_PASS") {
      fail("post-MR08 candidate requires MR08_INDEPENDENT_VERIFICATION_PASS with MR-09 closure candidate");
    }
  } else if (reconciliationReport.verdict !== "MR06_CROSSCHECK_PASS") {
    fail("pre-MR08 candidate requires MR06_CROSSCHECK_PASS report");
  }
}

if (!process.exitCode) {
  console.log("MAINNET_READINESS_STATE_VERIFIED");
  console.log(`gates=${gates.size}`);
  console.log(`reconciliation_status=${state.reconciliation_status}`);
}
