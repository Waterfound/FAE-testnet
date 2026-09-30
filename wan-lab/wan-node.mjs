#!/usr/bin/env node
const id=String(process.env.FAE_NODE_ID||process.env.FAE_V3_ROLE||'').trim().toLowerCase();
const map={a:'node-a',b:'node-b',c:'node-c','node-a':'node-a','node-b':'node-b','node-c':'node-c'};
const role=map[id];
if(!role)throw new Error('Unable to map FAE_NODE_ID to V3 role');
process.env.FAE_V3_ROLE=role;
await import('../sovereign-forge/lab/stability-soak-v3/node-runtime.mjs');
