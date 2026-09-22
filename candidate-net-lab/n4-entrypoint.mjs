#!/usr/bin/env node
import { validateN4RuntimeEnv } from './n4-runtime-config.mjs';

const config = validateN4RuntimeEnv(process.env);
console.log(JSON.stringify({
  event: 'FAE_N4_PROVIDER_NODE_START',
  authority: 'candidate-not-active-consensus',
  nodeId: config.nodeId,
  region: config.region,
  provider: config.provider,
  publicUrl: config.publicUrl,
  port: config.port,
  tokenConfigured: config.tokenConfigured,
  activationAuthorized: false,
  publicConsensusChanged: false,
}));

await import('./v5-node.mjs');
