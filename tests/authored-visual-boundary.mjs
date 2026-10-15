import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";

// This gate is deliberately structural: it cannot confer artistic approval.
// It prevents historical lineage, a rejected Studio or changed protected
// runtime bytes from silently being treated as an accepted implementation.
const read = (path) => JSON.parse(fs.readFileSync(path, "utf8"));
const authority = read("docs/FAE_VISUAL_IDENTITY_AUTHORITY_20261007.json");
const reconciliation = read("docs/FAE_VISUAL_AUTHORITY_RECONCILIATION_20261011.json");
const durable = read("docs/FAE_AUTHORSHIP_PRODUCT_WALLET_DURABLE_STATE.json");
const frozen = "a949e913990e13a0b907891a729b5c7b2086547b";

assert.equal(authority.canonical_reference.pr, 268);
assert.equal(authority.canonical_reference.head, frozen);
assert.equal(authority.canonical_reference.role, "SINGLE_AUTHORITATIVE_ARTISTIC_REFERENCE_FOR_ALL_FAE_FEATURE_SURFACES");
assert.equal(reconciliation.mining_authority.pr, 268);
assert.equal(reconciliation.mining_authority.exact_head, frozen);
assert.equal(reconciliation.mining_authority.role, "SOLE_AUTHORITATIVE_VISUAL_IDENTITY");
assert.equal(durable.visual_identity_authority.canonical_reference_head, frozen);
for (const name of ["Direction D", "Direction D+", "VL-08"]) {
  assert.equal(authority.prior_visual_states[name], "HISTORICAL_LINEAGE_ONLY");
  assert.ok(reconciliation.historical_lineage_only.includes(name));
}
assert.equal(reconciliation.review_surfaces.rejected_baseline.studio, "fae-authored-product-wallet-studio-6cku5x");
assert.equal(reconciliation.review_surfaces.rejected_baseline.version, "1791533052437");
assert.equal(reconciliation.review_surfaces.rejected_baseline.preserve_unchanged, true);
assert.equal(reconciliation.review_surfaces.rejected_baseline.art_direction, "REJECTED_VR08");
assert.equal(reconciliation.review_surfaces.revised_wallet.visual_direction, "APPROVED_IN_CONVERSATION");
assert.equal(reconciliation.review_surfaces.revised_wallet.integration_into_product, "NOT_YET_VERIFIED");
assert.equal(reconciliation.candidate.product_wallet_implementation_accepted, false);
assert.equal(reconciliation.rules.no_new_feature_family_until_product_wallet_implementation_accepted, true);
assert.equal(reconciliation.rules.no_implicit_wallet_creation, true);
assert.equal(reconciliation.rules.no_explorer_network_source_write, true);
assert.equal(reconciliation.rules.no_merge, true);
assert.equal(reconciliation.rules.no_production_deploy, true);
assert.equal(reconciliation.rules.fail_closed_on_material_visual_drift, true);

// Waterfound's later design-first rejection supersedes technical readiness.
// Green CI verifies engineering boundaries; it must never imply visual acceptance.
const designFirst = read("docs/FAE_PRODUCT_WALLET_DESIGN_FIRST_REJECTION_20261015.json");
assert.equal(designFirst.authority_owner, "Waterfound");
assert.equal(designFirst.verdict, "REJECTED__PRODUCT_WALLET_INTEGRATED_VISUAL_TRANSLATION");
assert.equal(designFirst.authority.reference_pr, 268);
assert.equal(designFirst.authority.reference_head, frozen);
assert.equal(designFirst.authority.reference_role, "SOLE_AUTHORITATIVE_VISUAL_IDENTITY");
assert.equal(designFirst.rejected_candidate.pr, 272);
assert.equal(designFirst.rejected_candidate.studio, "fae-authored-product-wallet-studio-6cku5x");
assert.equal(designFirst.rejected_candidate.preserve_unchanged_for_comparison, true);
assert.equal(designFirst.rejected_candidate.artistic_acceptance, false);
assert.equal(designFirst.rejected_candidate.technical_ci_is_not_visual_acceptance, true);
assert.equal(designFirst.fail_closed.visual_gate, "REJECTED_UNTIL_NEW_EXPLICIT_WATERFOUND_ACCEPTANCE");
for (const gate of ["new_feature_family_propagation", "canonical_merge", "production_deployment", "explorer_network_source_write", "consensus_economics_activation_mainnet_changes", "implicit_wallet_creation", "protected_wallet_mining_runtime_changes"]) {
  assert.equal(designFirst.fail_closed[gate], false, "design-first fail-closed boundary: " + gate);
}

for (const [path, expected] of Object.entries(durable.protected_blob_bindings)) {
  assert.match(path, /^(?:wallet(?:-[a-z-]+)?|mining|core)\.js$/);
  const bytes = fs.readFileSync(path);
  const actual = createHash("sha1").update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest("hex");
  assert.equal(actual, expected, `Protected runtime drift: ${path}`);
}
console.log("Authored visual boundary PASS: frozen identity, review gate, 7 protected blobs");
