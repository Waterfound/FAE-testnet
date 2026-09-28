import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const required = [
  "design/README.md",
  "design/current-state-inventory.json",
  "design/anti-pattern-registry.json",
  "design/quality-gates.md",
  "design/explorations/index.html",
  "design/explorations/a-veil-instrument.html",
  "design/explorations/b-sovereign-manuscript.html",
  "design/explorations/c-nocturne-field.html",
  "docs/FAE_VISUAL_LANGUAGE_BUILD_COLONY_RUN.json"
];
for (const file of required) assert.ok(fs.existsSync(path.join(root,file)), "missing "+file);

const run = JSON.parse(fs.readFileSync(path.join(root,"docs/FAE_VISUAL_LANGUAGE_BUILD_COLONY_RUN.json"),"utf8"));
assert.equal(run.source_main_revision,"39c0c491bc5cc8c039209adbf035cd507a0719d9");
assert.equal(run.portfolio_role,"SECONDARY");
assert.equal(run.authority_boundary.owner,"Waterfound");
assert.ok(run.authority_boundary.machine_may_not_without_waterfound.includes("select the final identity among artistically valid directions"));

for (const page of required.filter(x=>x.endsWith(".html"))) {
  const html=fs.readFileSync(path.join(root,page),"utf8");
  assert.match(html,/viewport/);
  assert.doesNotMatch(html,/wallet\.js|wallet-crypto\.js|mining\.js|core\.js/);
}
console.log("visual-language contract: PASS");
