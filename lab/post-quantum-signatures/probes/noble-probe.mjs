import { ml_dsa44, ml_dsa65, ml_dsa87 } from '@noble/post-quantum/ml-dsa.js';
import { slh_dsa_sha2_128s, slh_dsa_shake_256f } from '@noble/post-quantum/slh-dsa.js';

const message = new TextEncoder().encode('FAE PQ-02 implementation-independence probe');
const rows = [];

function exercise(name, scheme) {
  const keys = scheme.keygen();
  const sig = scheme.sign(message, keys.secretKey);
  const valid = scheme.verify(sig, message, keys.publicKey);
  const tampered = Uint8Array.from(sig);
  tampered[0] ^= 1;
  const rejectsTamper = !scheme.verify(tampered, message, keys.publicKey);
  if (!valid || !rejectsTamper) throw new Error(name + ' probe failed');
  rows.push({
    name,
    public_key_bytes: keys.publicKey.length,
    secret_key_bytes: keys.secretKey.length,
    signature_bytes: sig.length,
    valid,
    rejects_tamper: rejectsTamper
  });
}

exercise('ML-DSA-44', ml_dsa44);
exercise('ML-DSA-65', ml_dsa65);
exercise('ML-DSA-87', ml_dsa87);
exercise('SLH-DSA-SHA2-128s', slh_dsa_sha2_128s);
exercise('SLH-DSA-SHAKE-256f', slh_dsa_shake_256f);

console.log(JSON.stringify({
  schema:'FAE_PQ02_NOBLE_PROBE_V1',
  implementation:'@noble/post-quantum',
  version:'0.7.1',
  result:'PASS',
  rows
}, null, 2));
