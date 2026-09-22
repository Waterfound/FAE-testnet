#!/usr/bin/env node
process.env.FAE_V3_ROLE='observer';
await import('../sovereign-forge/lab/stability-soak-v3/monitor-runtime.mjs');
