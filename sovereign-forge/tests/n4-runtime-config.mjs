import assert from 'node:assert/strict';
import { validateN4RuntimeEnv } from '../../candidate-net-lab/n4-runtime-config.mjs';

const valid = validateN4RuntimeEnv({
  FAE_L3_TOKEN: 'a'.repeat(48),
  FAE_NODE_ID: 'provider-b-1',
  FAE_REGION: 'region-b',
  FAE_PROVIDER: 'provider-b',
  FAE_PUBLIC_URL: 'https://provider-b-1.example.net',
  PORT: '3190',
});
assert.equal(valid.nodeId, 'provider-b-1');
assert.equal(valid.region, 'region-b');
assert.equal(valid.provider, 'provider-b');
assert.equal(valid.publicUrl, 'https://provider-b-1.example.net');
assert.equal(valid.tokenConfigured, true);
assert.equal(valid.activationAuthorized, false);
assert.equal(valid.publicConsensusChanged, false);

assert.throws(() => validateN4RuntimeEnv({
  FAE_L3_TOKEN: 'local-l3-token',
  FAE_NODE_ID: 'x',
  FAE_REGION: 'y',
  FAE_PUBLIC_URL: 'https://x.example.net',
}), /invalid_fae_l3_token|n4_default_or_local_token_rejected/);

assert.throws(() => validateN4RuntimeEnv({
  FAE_L3_TOKEN: 'b'.repeat(48),
  FAE_NODE_ID: 'x',
  FAE_REGION: 'y',
  FAE_PUBLIC_URL: 'http://x.example.net',
}), /n4_public_url_must_use_https/);

assert.throws(() => validateN4RuntimeEnv({
  FAE_L3_TOKEN: 'c'.repeat(48),
  FAE_NODE_ID: 'x',
  FAE_REGION: 'y',
  FAE_PUBLIC_URL: '',
}), /invalid_fae_public_url/);

console.log('n4-runtime-config: PASS');
