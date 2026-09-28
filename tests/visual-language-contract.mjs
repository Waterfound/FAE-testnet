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
assert.equal(authority.authority_owner,"Waterfound");
assert.equal(authority.selected_direction.id,"D");
assert.equal(authority.selected_direction.status,"CANONICAL_FOR_VISUAL_IMPLEMENTATION");
assert.ok(authority.selected_direction.principles.some(x=>/probabilistic|non-deterministic/i.test(x)));

const continuation = JSON.parse(fs.readFileSync(path.join(root,"docs/FAE_VISUAL_LANGUAGE_BUILD_COLONY_CONTINUATION.json"),"utf8"));
assert.equal(continuation.authority.durable_consumed,true);
assert.equal(continuation.authority.post_generation,2);
assert.equal(continuation.frontiers.find(x=>x.id==="VL-07").state,"DONE");
assert.equal(continuation.frontiers.find(x=>x.id==="VL-08").state,"DONE");
assert.equal(continuation.frontiers.find(x=>x.id==="VL-13").state,"DONE");
assert.equal(continuation.frontiers.find(x=>x.id==="VL-14").state,"CANDIDATE_PREPARING");
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
assert.match(product,/class="fae-topper"/);
assert.match(product,/class="ticker-viewport"/);
assert.match(product,/id="height"/);
assert.match(product,/id="issued"/);
assert.match(product,/id="reward"/);
assert.match(product,/id="difficulty"/);
assert.match(product,/Proof of work, in your hands\./);
assert.doesNotMatch(product,/class="card metrics-card"/);

const walletSurface=fs.readFileSync(path.join(root,"index.html"),"utf8");
assert.match(walletSurface,/A wallet you hold, not an account you borrow\./);
assert.match(walletSurface,/Local keys/);
assert.match(walletSurface,/Local signing/);
assert.match(walletSurface,/Full TXID is visible/);
assert.match(walletSurface,/id="backup"/);
assert.match(walletSurface,/id="lastsendtx"/);

const miningProduct=fs.readFileSync(path.join(root,"index.html"),"utf8");
const miningRuntime=fs.readFileSync(path.join(root,"mining.js"),"utf8");
assert.match(miningProduct,/Computation in motion, not a countdown\./);
assert.match(miningProduct,/id="miningactivity"/);
assert.match(miningProduct,/Block discovery is probabilistic\./);
assert.match(miningRuntime,/function setMiningActivity/);
assert.match(miningRuntime,/setMiningActivity\('active','Device contributing'\)/);
assert.match(miningRuntime,/setMiningActivity\('idle'\)/);
assert.doesNotMatch(miningProduct + miningRuntime,/\d+%\s+to\s+reward|almost there|reward in \d+/i);

const explorerHtml=fs.readFileSync(path.join(root,"explorer/index.html"),"utf8");
const explorerCss=fs.readFileSync(path.join(root,"explorer/styles.css"),"utf8");
assert.match(explorerHtml,/class="explorer-ticker"/);
assert.match(explorerHtml,/id="metric-height"/);
assert.match(explorerHtml,/id="metric-supply"/);
assert.match(explorerHtml,/id="metric-target"/);
assert.match(explorerHtml,/id="metric-mempool"/);
assert.doesNotMatch(explorerHtml,/class="metrics-grid"/);
assert.match(explorerCss,/--orange:#f47a20/);
assert.match(explorerCss,/--blue:#1769ff/);
assert.match(explorerCss,/color-scheme:light/);

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
assert.ok(contrast('#1a130d','#f47a20')>=4.5,'orange topper foreground must meet AA contrast');

assert.match(product,/:focus-visible/);
assert.match(product,/@media\(prefers-reduced-motion:reduce\)/);
assert.match(product,/role="status" aria-live="polite"/);
assert.match(product,/@media\(max-width:760px\)/);
assert.match(product,/@media\(max-width:420px\)/);

assert.match(explorerCss,/:focus-visible/);
assert.match(explorerCss,/@media\(prefers-reduced-motion:reduce\)/);
assert.match(explorerCss,/@media\(max-width:640px\)/);
assert.match(explorerHtml,/role="status" aria-live="polite"/);
assert.match(explorerHtml,/Read-only/);
assert.match(explorerHtml,/Validated-node boundary/);
console.log('Direction D cross-product accessibility contract: PASS');

const primitives=JSON.parse(fs.readFileSync(path.join(root,"design/proven-primitives.json"),"utf8"));
assert.equal(primitives.status,"PROVEN_IN_REAL_SURFACES");
assert.equal(primitives.extraction_decision,"KEEP_IN_FAE_REPOSITORY_FOR_NOW");
assert.ok(primitives.fae_specific_do_not_extract.includes("orange topper as FAE identity signature"));
assert.ok(fs.existsSync(path.join(root,"design/reference-gallery.md")));
