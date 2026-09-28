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
assert.equal(continuation.frontiers.find(x=>x.id==="VL-08").state,"READY");

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
