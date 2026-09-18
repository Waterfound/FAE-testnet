#!/usr/bin/env node
process.env.FAE_V3_ROLE='controller';
process.env.FAE_V3_NODE_A=process.env.FAE_V3_NODE_A||process.env.FAE_NODE_A||'';
process.env.FAE_V3_NODE_B=process.env.FAE_V3_NODE_B||process.env.FAE_NODE_B||'';
process.env.FAE_V3_NODE_C=process.env.FAE_V3_NODE_C||process.env.FAE_NODE_C||'';
await import('../sovereign-forge/lab/stability-soak-v3/monitor-runtime.mjs');
