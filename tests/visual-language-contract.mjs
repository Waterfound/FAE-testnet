import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const required = [
  "design/README.md",
  "design/current-state-inventory.json",
  "design/anti-pattern-registry.json",
  "design/quality-gates.md",
  "design/direction-d-authority.json",
  "docs/FAE_VISUAL_IDENTITY_AUTHORITY_20261007.json",
  "docs/FAE_AUTHORSHIP_PRODUCT_WALLET_DURABLE_STATE.json",
  "design/direction-d-visual-grammar.md",
  "design/explorations/index.html",
  "design/explorations/a-veil-instrument.html",
  "design/explorations/b-sovereign-manuscript.html",
  "design/explorations/c-nocturne-field.html",
  "docs/FAE_VISUAL_LANGUAGE_BUILD_COLONY_RUN.json",
  "docs/FAE_VISUAL_LANGUAGE_BUILD_COLONY_CONTINUATION.json",
  "docs/FAE_VISUAL_LANGUAGE_DURABLE_EXECUTION.json"
];
for (const file of required) assert.ok(fs.existsSync(path.join(root,file)), "missing "+file);

const authority = JSON.parse(fs.readFileSync(path.join(root,"design/direction-d-authority.json"),"utf8"));
// Earlier Direction D records are immutable provenance, not current design authority.
assert.equal(authority.authority_owner,"Waterfound");
assert.equal(authority.selected_direction.id,"D");
assert.ok(authority.selected_direction.principles.some(x=>/probabilistic|non-deterministic/i.test(x)));

const authoredAuthority=JSON.parse(fs.readFileSync(path.join(root,"docs/FAE_VISUAL_IDENTITY_AUTHORITY_20261007.json"),"utf8"));
assert.equal(authoredAuthority.authority_owner,"Waterfound");
assert.equal(authoredAuthority.status,"AUTHORITATIVE_VISUAL_IDENTITY");
assert.equal(authoredAuthority.canonical_reference.name,"FAE Mining Authored Reference");
assert.equal(authoredAuthority.canonical_reference.pr,268);
assert.equal(authoredAuthority.canonical_reference.head,"a949e913990e13a0b907891a729b5c7b2086547b");
assert.equal(authoredAuthority.canonical_reference.role,"SINGLE_AUTHORITATIVE_ARTISTIC_REFERENCE_FOR_ALL_FAE_FEATURE_SURFACES");
assert.equal(authoredAuthority.prior_visual_states["Direction D"],"HISTORICAL_LINEAGE_ONLY");
assert.equal(authoredAuthority.prior_visual_states["Direction D+"],"HISTORICAL_LINEAGE_ONLY");
assert.equal(authoredAuthority.prior_visual_states["VL-08"],"HISTORICAL_LINEAGE_ONLY");
assert.equal(authoredAuthority.implementation_effects.all_future_features_must_conform,true);
assert.equal(authoredAuthority.implementation_effects.mining_reference_redesign_authorized,false);
assert.equal(authoredAuthority.implementation_effects.explorer_source_write_authority_created,false);
assert.equal(authoredAuthority.implementation_effects.public_deployment_authority_created,false);
assert.equal(authoredAuthority.implementation_effects.canonical_main_merge_authority_created,false);
for (const semantic of ["Mining = movement","Wallet = rest","Intent before identity","quiet-active contrast","product-first, not marketing-first"]) {
  assert.ok(authoredAuthority.propagation_rule.preserve.includes(semantic),"missing authored identity semantic: "+semantic);
}
const authoredDurable=JSON.parse(fs.readFileSync(path.join(root,"docs/FAE_AUTHORSHIP_PRODUCT_WALLET_DURABLE_STATE.json"),"utf8"));
assert.equal(authoredDurable.visual_identity_authority.file,"docs/FAE_VISUAL_IDENTITY_AUTHORITY_20261007.json");
assert.equal(authoredDurable.visual_identity_authority.canonical_reference_head,authoredAuthority.canonical_reference.head);
assert.equal(authoredDurable.guarantees.all_feature_surfaces_must_derive_from_mining_authored_identity,true);
assert.equal(authoredDurable.guarantees.no_implicit_wallet_creation,true);
assert.equal(authoredDurable.guarantees.mining_reference_frozen,true);
assert.equal(authoredDurable.guarantees.explorer_untouched,true);
assert.equal(authoredDurable.guarantees.main_merge_authority,false);
assert.equal(authoredDurable.guarantees.public_deployment_authority,false);
const designReadme=fs.readFileSync(path.join(root,"design/README.md"),"utf8");
assert.match(designReadme,/single authoritative artistic identity.*FAE Mining Authored Reference/i);
assert.match(designReadme,/historical lineage.*not.*implementation targets/i);
const visualQuality=fs.readFileSync(path.join(root,"design/quality-gates.md"),"utf8");
assert.match(visualQuality,/Mining Authored Reference/);
assert.match(visualQuality,/no implicit wallet generation/i);

const continuation = JSON.parse(fs.readFileSync(path.join(root,"docs/FAE_VISUAL_LANGUAGE_BUILD_COLONY_CONTINUATION.json"),"utf8"));
assert.equal(continuation.authority.durable_consumed,true);
assert.equal(continuation.authority.post_generation,2);
assert.equal(continuation.frontiers.find(x=>x.id==="VL-07").state,"DONE");
assert.equal(continuation.frontiers.find(x=>x.id==="VL-08").state,"DONE");
assert.equal(continuation.frontiers.find(x=>x.id==="VL-13").state,"DONE_FOR_ADMITTED_SURFACES");
assert.equal(continuation.frontiers.find(x=>x.id==="VL-14").state,"CANDIDATE_PREPARING_AUTHORITY_CORRECTED");
assert.equal(continuation.frontiers.find(x=>x.id==="VL-15").state,"BLOCKED_BY_PUBLIC_REBRAND_AUTHORITY");

const grammar=fs.readFileSync(path.join(root,"design/direction-d-visual-grammar.md"),"utf8");
assert.match(grammar,/Orange Top/);
assert.match(grammar,/White Field/);
assert.match(grammar,/Blue Circulation/);
assert.match(grammar,/proof-of-work discovery is probabilistic/i);
assert.match(grammar,/must not display .*% to reward.*ETA to success/i);
assert.match(grammar,/Prohibited language:/);

console.log("visual-language contract: PASS");

const product=fs.readFileSync(path.join(root,"index.html"),"utf8");
assert.match(product,/data-direction-d="true"/);
assert.match(product,/data-authorship-propagation="product-wallet-v1"/);
assert.match(product,/class="fae-topper"/);
assert.match(product,/class="ticker-viewport"/);
assert.match(product,/class="product-shell-head"/);
assert.match(product,/aria-label="Product modes"/);
assert.match(product,/Block Height <b id="height">/);
assert.match(product,/id="issued"/);
assert.match(product,/id="reward"/);
assert.match(product,/id="difficulty"/);
assert.doesNotMatch(product,/class="fae-hero"/);
assert.doesNotMatch(product,/Valueless testnet coins/);
assert.doesNotMatch(product,/class="card metrics-card"/);
assert.ok(product.indexOf('id="tab-wallet"') < product.indexOf('id="tab-mining"'),"Wallet mode must precede Mining in the authored product shell");

const walletSurface=product.slice(product.indexOf('id="panel-wallet"'),product.indexOf('<p class="footer-note">'));
assert.match(walletSurface,/Wallet \/ quiet ownership/);
assert.match(walletSurface,/<h1 id="wallet-surface-title">Wallet<\/h1>/);
assert.match(walletSurface,/Possession should feel quiet\./);
assert.match(walletSurface,/Custody<\/span>\s*<strong>Local<\/strong>/);
assert.match(walletSurface,/No implicit Wallet creation\./);
assert.match(walletSurface,/choose New Wallet and verify the complete 24-word backup/);
assert.doesNotMatch(walletSurface,/class="card"/);
assert.match(walletSurface,/id="action-create"/);
assert.match(walletSurface,/id="action-recovery"/);
assert.match(walletSurface,/id="wallet-connected-state"/);
assert.match(walletSurface,/id="backup"/);
assert.match(walletSurface,/id="lastsendtx"/);
assert.match(walletSurface,/id="walletlist"/);

const miningProduct=fs.readFileSync(path.join(root,"index.html"),"utf8");
const miningRuntime=fs.readFileSync(path.join(root,"mining.js"),"utf8");
assert.match(miningProduct,/Computation in motion, not a countdown\./);
assert.match(miningProduct,/id="miningactivity"/);
assert.match(miningProduct,/Block discovery is probabilistic\./);
assert.doesNotMatch(miningRuntime,/function setMiningActivity/);
assert.match(miningProduct,/#panel-mining:has\(#stop:not\(:disabled\)\)/);
assert.match(miningProduct,/class="mining-active-label">Device contributing/);
assert.doesNotMatch(miningProduct + miningRuntime,/\d+%\s+to\s+reward|almost there|reward in \d+/i);

function luminance(hex){
  const rgb=hex.replace('#','').match(/.{2}/g).map(x=>parseInt(x,16)/255).map(c=>c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4);
  return 0.2126*rgb[0]+0.7152*rgb[1]+0.0722*rgb[2];
}
function contrast(a,b){
  const x=luminance(a),y=luminance(b),hi=Math.max(x,y),lo=Math.min(x,y);
  return (hi+0.05)/(lo+0.05);
}
assert.ok(contrast('#17191d','#ffffff')>=7,'primary text must meet enhanced contrast on white');
assert.ok(contrast('#68707b','#ffffff')>=4.5,'muted body text must meet AA contrast on white');
assert.ok(contrast('#1769ff','#ffffff')>=4.5,'blue active color must meet AA contrast on white');
assert.ok(contrast('#16794b','#ffffff')>=4.5,'green confirmed/safe color must meet AA contrast on white');
assert.ok(contrast('#1a130d','#f47a20')>=4.5,'orange topper foreground must meet AA contrast');

assert.match(product,/:focus-visible/);
assert.match(product,/@media\(prefers-reduced-motion:reduce\)/);
assert.match(product,/role="status" aria-live="polite"/);
assert.match(product,/@media\(max-width:760px\)/);
assert.match(product,/@media\(max-width:420px\)/);

console.log('Authored Product Shell + Wallet accessibility contract: PASS');

const primitives=JSON.parse(fs.readFileSync(path.join(root,"design/proven-primitives.json"),"utf8"));
assert.equal(primitives.status,"PROVEN_IN_ADMITTED_REAL_SURFACES");
assert.equal(primitives.extraction_decision,"KEEP_IN_FAE_REPOSITORY_FOR_NOW");
assert.ok(primitives.fae_specific_do_not_extract.includes("orange topper as FAE identity signature"));
assert.ok(fs.existsSync(path.join(root,"design/reference-gallery.md")));

const integrationCandidate=JSON.parse(fs.readFileSync(path.join(root,"docs/FAE_VISUAL_LANGUAGE_INTEGRATION_CANDIDATE.json"),"utf8"));
assert.deepEqual(integrationCandidate.changed_product_surfaces,["index.html"]);
assert.equal(integrationCandidate.verified_frontiers.VL11,"NOT_ADMITTED — Block Explorer source writes frozen");
assert.equal(continuation.frontiers.find(x=>x.id==="VL-11").state,"BLOCKED_BY_BLOCK_EXPLORER_SOURCE_AUTHORITY");
assert.deepEqual(primitives.source_surfaces,["Homepage","Wallet","Mining"]);
assert.ok(primitives.exploratory_not_admitted_surfaces.includes("Explorer"));
