const FORBIDDEN_TOKENS = new Set([
  'local-l3-token',
  'local-l3-scale-token',
  'local-profile-core-token',
]);

function clean(value, field, { min = 1, max = 200 } = {}) {
  const text = String(value ?? '').trim();
  if (text.length < min || text.length > max) throw new Error(`invalid_${field}`);
  return text;
}

export function validateN4RuntimeEnv(env = process.env) {
  const token = clean(env.FAE_L3_TOKEN, 'fae_l3_token', { min: 24, max: 512 });
  if (FORBIDDEN_TOKENS.has(token)) throw new Error('n4_default_or_local_token_rejected');

  const nodeId = clean(env.FAE_NODE_ID, 'fae_node_id', { max: 80 });
  const region = clean(env.FAE_REGION, 'fae_region', { max: 120 });
  const publicUrl = clean(env.FAE_PUBLIC_URL, 'fae_public_url', { max: 300 }).replace(/\/$/, '');
  let parsed;
  try { parsed = new URL(publicUrl); }
  catch { throw new Error('invalid_fae_public_url'); }
  if (parsed.protocol !== 'https:') throw new Error('n4_public_url_must_use_https');
  if (parsed.username || parsed.password) throw new Error('n4_public_url_credentials_rejected');

  const port = Number(env.PORT || 3190);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('invalid_port');

  return Object.freeze({
    nodeId,
    region,
    publicUrl,
    port,
    provider: clean(env.FAE_PROVIDER || 'unspecified-provider', 'fae_provider', { max: 120 }),
    tokenConfigured: true,
    activationAuthorized: false,
    publicConsensusChanged: false,
  });
}
