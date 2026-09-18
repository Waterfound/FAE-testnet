import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const matrix=JSON.parse(await readFile(new URL('../docs/security/FAE_ATTACK_SURFACE_MATRIX_V1.json',import.meta.url),'utf8'));
const security=await readFile(new URL('../SECURITY.md',import.meta.url),'utf8');

assert.equal(matrix.schema,'FAE_PUBLIC_CODE_ATTACK_SURFACE_MATRIX_V1');
assert.equal(matrix.principle,'FAE must remain secure even if the attacker knows 100% of the source code.');
assert.ok(Array.isArray(matrix.invariant_registry));
assert.ok(Array.isArray(matrix.surfaces));

const invariants=new Map(matrix.invariant_registry.map(row=>[row.id,row]));
assert.equal(invariants.size,matrix.invariant_registry.length,'invariant ids must be unique');
assert.ok(invariants.size>=16,'security invariant registry unexpectedly small');

const surfaces=new Map(matrix.surfaces.map(row=>[row.id,row]));
assert.equal(surfaces.size,matrix.surfaces.length,'attack-surface ids must be unique');
assert.equal(surfaces.size,11,'unexpected attack-surface count');

const used=new Set();
for(const surface of matrix.surfaces){
  assert.match(surface.id,/^AS-\d{2}$/);
  assert.ok(surface.name);
  assert.ok(Array.isArray(surface.owner_gates)&&surface.owner_gates.length>0,\`\${surface.id} missing owner gate\`);
  assert.ok(Array.isArray(surface.invariants)&&surface.invariants.length>0,\`\${surface.id} missing invariants\`);
  assert.ok(Array.isArray(surface.ingress)&&surface.ingress.length>0,\`\${surface.id} missing ingress\`);
  assert.ok(Array.isArray(surface.existing_strong_evidence),\`\${surface.id} missing evidence list\`);
  assert.ok(Array.isArray(surface.specialized_evidence),\`\${surface.id} missing specialized evidence list\`);
  assert.ok(Array.isArray(surface.known_gaps),\`\${surface.id} missing gap list\`);
  assert.ok(surface.next_gate,\`\${surface.id} missing next gate\`);
  for(const id of surface.invariants){
    assert.ok(invariants.has(id),\`\${surface.id} references unknown invariant \${id}\`);
    used.add(id);
  }
}
for(const [id,row] of invariants){
  if(row.active_v4===false)continue;
  assert.ok(used.has(id),\`active invariant \${id} is not owned by any attack surface\`);
  assert.equal(row.severity,'baseline_blocking',\`\${id} must remain baseline-blocking\`);
}

for(const required of[
  '# Security Policy',
  'FAE must remain secure even if an attacker knows 100% of the source code.',
  '## Reporting a vulnerability',
  'Report a vulnerability',
  'Do not include sensitive vulnerability details in a public message.',
  '## Supported security scope',
  '## Disclosure handling',
  '## No bug bounty commitment',
  'does **not** currently promise a monetary bug bounty'
]) assert.ok(security.includes(required),\`SECURITY.md missing required policy text: \${required}\`);

for(const forbidden of['seed phrase here','private key here'])assert.ok(!security.toLowerCase().includes(forbidden));

console.log(JSON.stringify({
  status:'PASS',
  invariant_count:invariants.size,
  attack_surface_count:surfaces.size,
  responsible_disclosure_contract:true,
  runtime_or_consensus_change:false
}));
