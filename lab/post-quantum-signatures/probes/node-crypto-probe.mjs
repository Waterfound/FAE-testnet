import { generateKeyPairSync, sign, verify } from 'node:crypto';

const message = Buffer.from('FAE PQ-02 implementation-independence probe');
const algorithms = [
  'ml-dsa-44',
  'ml-dsa-65',
  'ml-dsa-87',
  'slh-dsa-sha2-128s',
  'slh-dsa-shake-256f'
];
const rows = [];

for (const algorithm of algorithms) {
  const {publicKey, privateKey} = generateKeyPairSync(algorithm);
  const signature = sign(null, message, privateKey);
  const valid = verify(null, message, publicKey, signature);
  const tampered = Buffer.from(signature);
  tampered[0] ^= 1;
  const rejectsTamper = !verify(null, message, publicKey, tampered);
  if (!valid || !rejectsTamper) throw new Error(algorithm + ' probe failed');
  rows.push({
    algorithm,
    public_key_type: publicKey.asymmetricKeyType,
    signature_bytes: signature.length,
    valid,
    rejects_tamper: rejectsTamper
  });
}

console.log(JSON.stringify({
  schema:'FAE_PQ02_NODE_CRYPTO_PROBE_V1',
  implementation:'node:crypto',
  node:process.version,
  openssl:process.versions.openssl,
  result:'PASS',
  rows
}, null, 2));
