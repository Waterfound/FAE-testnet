import { readFile, writeFile } from 'node:fs/promises';
import { deepStrictEqual, strictEqual } from 'node:assert';

const noblePath = process.env.PQ_NOBLE_HANDSHAKE;
const circlPath = process.env.PQ_CIRCL_HANDSHAKE;
const outPath = process.env.PQ_EVIDENCE_PATH;
if (!noblePath || !circlPath || !outPath) {
  throw new Error('PQ_NOBLE_HANDSHAKE, PQ_CIRCL_HANDSHAKE and PQ_EVIDENCE_PATH are required');
}

const noble = JSON.parse(await readFile(noblePath, 'utf8'));
const circl = JSON.parse(await readFile(circlPath, 'utf8'));
strictEqual(noble.result, 'PASS', 'Noble handshake producer must pass');
strictEqual(circl.result, 'PASS', 'CIRCL handshake producer must pass');

const nobleNames = Object.keys(noble.cases).sort();
const circlNames = Object.keys(circl.cases).sort();
deepStrictEqual(nobleNames, circlNames, 'handshake algorithm sets must match');

const cases = {};
for (const name of nobleNames) {
  const a = noble.cases[name];
  const b = circl.cases[name];
  strictEqual(a.publicKey.toLowerCase(), b.publicKey.toLowerCase(), name + ' public key mismatch');
  strictEqual(a.signature.toLowerCase(), b.signature.toLowerCase(), name + ' signature mismatch');
  deepStrictEqual(a.negatives, b.negatives, name + ' negative matrix mismatch');
  for (const [negative, passed] of Object.entries(a.negatives)) {
    strictEqual(passed, true, name + ' ' + negative);
  }
  cases[name] = {
    public_key_equal: true,
    signature_equal: true,
    negative_matrix_equal: true,
    negative_matrix_passed: true,
    public_key_bytes: a.publicKey.length / 2,
    signature_bytes: a.signature.length / 2
  };
}

const evidence = {
  schema: 'FAE_PQ_WAVE_D_CROSS_IMPLEMENTATION_V1',
  result: 'PASS',
  anchorA: '@noble/post-quantum@0.7.1',
  anchorB: 'cloudflare/circl@2ef8bf457d28ab1c62f42b76f6564610c5a3b3f0',
  algorithms: nobleNames,
  cases
};
await writeFile(outPath, JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({
  schema: evidence.schema,
  result: evidence.result,
  algorithmCount: nobleNames.length,
  mldsa: nobleNames.filter(x => x.startsWith('ML-DSA')).length,
  slhdsa: nobleNames.filter(x => x.startsWith('SLH-DSA')).length
}, null, 2));
