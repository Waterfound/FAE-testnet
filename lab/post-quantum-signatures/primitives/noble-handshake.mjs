import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { strictEqual } from 'node:assert';

import { ml_dsa44, ml_dsa65, ml_dsa87 } from '@noble/post-quantum/ml-dsa.js';
import {
  slh_dsa_sha2_128s,
  slh_dsa_shake_128f,
  slh_dsa_sha2_192s,
  slh_dsa_shake_192f,
  slh_dsa_sha2_256s,
  slh_dsa_shake_256f
} from '@noble/post-quantum/slh-dsa.js';

const output = process.env.PQ_EVIDENCE_PATH;
if (!output) throw new Error('PQ_EVIDENCE_PATH is required');
const message = new TextEncoder().encode('FAE PQ Wave D cross-implementation handshake v1');
const empty = new Uint8Array();
const hex = bytes => Buffer.from(bytes).toString('hex');

function digest(label) {
  return new Uint8Array(createHash('sha256').update(label).digest());
}
function concat(...arrs) {
  const len = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(len);
  let off = 0;
  for (const a of arrs) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}
function mutate(sig) {
  const out = Uint8Array.from(sig);
  out[Math.floor(out.length / 2)] ^= 1;
  return out;
}
function safeVerify(fn) {
  try { return !!fn(); } catch { return false; }
}
function negativeMatrix(verify, signature, wrongPk) {
  const truncated = signature.slice(0, signature.length - 1);
  const extended = concat(signature, new Uint8Array([0]));
  const result = {
    tampered_signature_rejected: !safeVerify(() => verify(mutate(signature))),
    wrong_public_key_rejected: !safeVerify(() => verify(signature, wrongPk)),
    truncated_signature_rejected: !safeVerify(() => verify(truncated)),
    extended_signature_rejected: !safeVerify(() => verify(extended))
  };
  for (const [name, passed] of Object.entries(result)) strictEqual(passed, true, name);
  return result;
}

const out = {
  schema: 'FAE_PQ_WAVE_D_NOBLE_HANDSHAKE_V1',
  implementation: '@noble/post-quantum',
  version: '0.7.1',
  result: 'PASS',
  cases: {}
};

for (const [name, scheme] of Object.entries({
  'ML-DSA-44': ml_dsa44,
  'ML-DSA-65': ml_dsa65,
  'ML-DSA-87': ml_dsa87
})) {
  const seed = digest('FAE|' + name + '|key');
  const wrongSeed = digest('FAE|' + name + '|wrong-key');
  const { publicKey, secretKey } = scheme.keygen(seed);
  const { publicKey: wrongPk } = scheme.keygen(wrongSeed);
  const signature = scheme.sign(message, secretKey, { context: empty, extraEntropy: false });
  const verify = (sig, pk = publicKey) => scheme.verify(sig, message, pk, { context: empty });
  strictEqual(verify(signature), true, name + ' valid signature');
  out.cases[name] = {
    publicKey: hex(publicKey),
    signature: hex(signature),
    negatives: negativeMatrix(verify, signature, wrongPk)
  };
}

for (const [name, scheme] of Object.entries({
  'SLH-DSA-SHA2-128s': slh_dsa_sha2_128s,
  'SLH-DSA-SHAKE-128f': slh_dsa_shake_128f,
  'SLH-DSA-SHA2-192s': slh_dsa_sha2_192s,
  'SLH-DSA-SHAKE-192f': slh_dsa_shake_192f,
  'SLH-DSA-SHA2-256s': slh_dsa_sha2_256s,
  'SLH-DSA-SHAKE-256f': slh_dsa_shake_256f
})) {
  const n = name.includes('128') ? 16 : name.includes('192') ? 24 : 32;
  const seed = concat(
    digest('FAE|' + name + '|skSeed').slice(0, n),
    digest('FAE|' + name + '|skPrf').slice(0, n),
    digest('FAE|' + name + '|pkSeed').slice(0, n)
  );
  const wrongSeed = concat(
    digest('FAE|' + name + '|wrong|skSeed').slice(0, n),
    digest('FAE|' + name + '|wrong|skPrf').slice(0, n),
    digest('FAE|' + name + '|wrong|pkSeed').slice(0, n)
  );
  const { publicKey, secretKey } = scheme.keygen(seed);
  const { publicKey: wrongPk } = scheme.keygen(wrongSeed);
  const signature = scheme.sign(message, secretKey, { context: empty, extraEntropy: false });
  const verify = (sig, pk = publicKey) => scheme.verify(sig, message, pk, { context: empty });
  strictEqual(verify(signature), true, name + ' valid signature');
  out.cases[name] = {
    publicKey: hex(publicKey),
    signature: hex(signature),
    negatives: negativeMatrix(verify, signature, wrongPk)
  };
}

await writeFile(output, JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify({
  schema: out.schema,
  result: out.result,
  algorithms: Object.keys(out.cases),
  negativeMatricesPassed: Object.keys(out.cases).length
}, null, 2));
