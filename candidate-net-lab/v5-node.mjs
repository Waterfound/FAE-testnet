#!/usr/bin/env node
import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import {
  emptyCandidateState,
  candidateStateInvariantReport,
  candidateBlockTemplate,
  candidateBlockHash,
  appendCandidateBlock,
  acceptCandidateTxInto,
  reorganizeCandidateState,
  rebuildCandidateState,
  candidateChainWork,
  cloneCandidateState,
  normalizeCandidateTx,
} from '../sovereign-forge/node/candidate/fae-v5-300-core.mjs';
import { openCandidateRecoveryStore } from '../sovereign-forge/node/candidate/network-recovery-v1.mjs';
import {
  targetFromHex,
  hashMeetsTarget,
} from '../sovereign-forge/node/candidate/difficulty-timestamp-v2-300.mjs';
import {
  CANDIDATE_NETWORK_ID,
  CANDIDATE_GENESIS_COMMITMENT,
} from '../sovereign-forge/node/candidate/network-boundary-v2-300.mjs';

const PORT = Number(process.env.PORT || 3190);
const HOST = process.env.FAE_HOST || '0.0.0.0';
const NODE_ID = process.env.FAE_NODE_ID || `v5-${PORT}`;
const REGION = process.env.FAE_REGION || 'local';
const TOKEN = process.env.FAE_L3_TOKEN || 'local-l3-token';
const PROFILE = 'l3-easy-pow-limit-non-activating';
let PEERS = parsePeers(process.env.FAE_PEERS || '');

function parsePeers(value) {
  return String(value || '').split(',').map(x => x.trim().replace(/\/$/, '')).filter(Boolean);
}
function authorized(req) {
  const got = String(req.headers['x-fae-l3-token'] || '');
  const a = Buffer.from(got), b = Buffer.from(TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}
function send(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type,x-fae-l3-token',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
  });
  res.end(JSON.stringify(payload));
}
async function readBody(req) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 8_000_000) throw new Error('body_too_large');
  }
  return text ? JSON.parse(text) : {};
}
async function fetchJson(url, options = {}, timeoutMs = 15_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(payload.error || `http_${response.status}`), { status: response.status, payload });
    return payload;
  } finally {
    clearTimeout(timer);
  }
}
function baseUrl() {
  return process.env.FAE_PUBLIC_URL?.replace(/\/$/, '') || `http://127.0.0.1:${PORT}`;
}
function authHeaders() {
  return { 'content-type': 'application/json', 'x-fae-l3-token': TOKEN };
}

const recovery = process.env.FAE_L3_STATE_FILE
  ? await openCandidateRecoveryStore({ path: process.env.FAE_L3_STATE_FILE })
  : null;
let state = recovery?.state || emptyCandidateState();
let counters = {
  acceptedBlocks: 0,
  acceptedTxs: 0,
  rejected: 0,
  syncs: 0,
  reorgs: 0,
  resurrected: 0,
  fixtureLoads: 0,
};
let lastReorg = null;
let mutationTail = Promise.resolve();

function serial(fn) {
  const run = mutationTail.then(fn, fn);
  mutationTail = run.catch(() => {});
  return run;
}
async function publishState(next) {
  // A successful mutation response follows a durable, validated snapshot.
  // Disk errors leave the published in-memory state untouched.
  if (recovery) await recovery.save(next);
  state = next;
}
async function resetState() {
  await publishState(emptyCandidateState());
  counters = { acceptedBlocks: 0, acceptedTxs: 0, rejected: 0, syncs: 0, reorgs: 0, resurrected: 0, fixtureLoads: 0 };
  lastReorg = null;
}
function statusPayload() {
  const report = candidateStateInvariantReport(state);
  return {
    ok: true,
    lab: 'FAE_V5_300_MULTI_NODE_L3',
    profile: PROFILE,
    nodeId: NODE_ID,
    region: REGION,
    peers: [...PEERS],
    tipHash: state.chain.at(-1)?.hash || null,
    mempoolCount: state.mempoolOrder.length,
    counters: { ...counters },
    lastReorg,
    recovery: recovery?.status() || { enabled: false },
    ...report,
  };
}
function mineTemplate(template) {
  const target = targetFromHex(template.header.target_hex);
  for (let nonce = 0; nonce < 5_000_000; nonce++) {
    const hash = candidateBlockHash(template.header, nonce);
    if (hashMeetsTarget(hash, target)) return { ...template, nonce, hash };
  }
  throw new Error('candidate_nonce_search_limit_exceeded');
}

async function relayBlock(envelope, except = '') {
  const peers = PEERS.filter(peer => peer !== except);
  await Promise.allSettled(peers.map(peer => fetchJson(`${peer}/block`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({ envelope, from: baseUrl() }),
  })));
}
async function relayTx(tx, except = '') {
  const peers = PEERS.filter(peer => peer !== except);
  await Promise.allSettled(peers.map(peer => fetchJson(`${peer}/tx`, {
    method: 'POST', headers: authHeaders(), body: JSON.stringify({ tx, from: baseUrl() }),
  })));
}
async function syncPeer(peer) {
  const snapshot = await fetchJson(`${peer}/snapshot`, {}, 20_000);
  if (snapshot.network !== CANDIDATE_NETWORK_ID || snapshot.genesisCommitment !== CANDIDATE_GENESIS_COMMITMENT || !Array.isArray(snapshot.blocks)) {
    throw new Error('peer_candidate_identity_mismatch');
  }
  const adoption = await serial(async () => {
    counters.syncs++;
    const currentWork = candidateChainWork(state.chain);
    const incomingState = rebuildCandidateState(snapshot.blocks, { nowMs: Date.now() });
    const incomingWork = candidateChainWork(incomingState.chain);
    if (incomingWork <= currentWork) {
      const sameTip = incomingState.chain.at(-1)?.hash === state.chain.at(-1)?.hash;
      return {
        adopted: false, reason: 'not_more_chainwork',
        // Pending records are a retry source after a crash between persistence and relay.
        ...(sameTip ? { recoveredTransactions: state.mempoolOrder.map(txid => normalizeCandidateTx(state.transactions[txid])) } : {}),
      };
    }
    const result = reorganizeCandidateState(state, snapshot.blocks, { nowMs: Date.now() });
    await publishState(result.state);
    counters.reorgs++;
    counters.resurrected += result.resurrected.length;
    lastReorg = {
      fromPeer: peer,
      oldWork: result.oldWork.toString(),
      newWork: result.newWork.toString(),
      resurrected: [...result.resurrected],
      dropped: structuredClone(result.dropped),
      newHeight: state.chain.length,
    };
    return {
      adopted: true, ...lastReorg,
      recoveredTransactions: result.resurrected.map(txid => normalizeCandidateTx(state.transactions[txid])),
    };
  });
  if (!adoption.recoveredTransactions) return adoption;
  const { recoveredTransactions, ...result } = adoption;
  const peers = [...new Set([peer, ...PEERS])];
  let repropagated = 0;
  // Parent before child on every target, including the source of the winning chain.
  for (const tx of recoveredTransactions) {
    const deliveries = await Promise.allSettled(peers.map(target => fetchJson(`${target}/tx`, {
      method: 'POST', headers: authHeaders(), body: JSON.stringify({ tx, from: baseUrl() }),
    })));
    repropagated += deliveries.filter(row => row.status === 'fulfilled').length;
  }
  return { ...result, repropagated };
}
async function syncAll() {
  const results = [];
  for (const peer of PEERS) {
    try { results.push({ peer, ...(await syncPeer(peer)) }); }
    catch (error) { results.push({ peer, adopted: false, error: error.message }); }
  }
  return results;
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'content-type,x-fae-l3-token',
        'access-control-allow-methods': 'GET,POST,OPTIONS',
      });
      return res.end();
    }
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/' || url.pathname === '/status') return send(res, 200, statusPayload());
    if (url.pathname === '/snapshot') return send(res, 200, {
      ok: true,
      nodeId: NODE_ID,
      network: CANDIDATE_NETWORK_ID,
      genesisCommitment: CANDIDATE_GENESIS_COMMITMENT,
      blocks: state.chain,
      report: candidateStateInvariantReport(state),
    });
    if (url.pathname === '/transaction') {
      const txid = String(url.searchParams.get('txid') || '');
      return send(res, state.transactions[txid] ? 200 : 404, state.transactions[txid] ? { ok: true, transaction: state.transactions[txid] } : { ok: false, error: 'transaction_not_found' });
    }
    if (url.pathname === '/mempool') return send(res, 200, { ok: true, txids: [...state.mempoolOrder] });

    if (!authorized(req)) return send(res, 403, { ok: false, error: 'forbidden' });

    if (url.pathname === '/tx' && req.method === 'POST') {
      const body = await readBody(req);
      try {
        const record = await serial(async () => {
          const next = cloneCandidateState(state);
          const r = acceptCandidateTxInto(next, body.tx, { createdAt: body.tx?.created_at || new Date().toISOString() });
          await publishState(next);
          counters.acceptedTxs++;
          return structuredClone(r);
        });
        relayTx(body.tx, String(body.from || '')).catch(() => {});
        return send(res, 200, { ok: true, record });
      } catch (error) {
        counters.rejected++;
        const status = error.code === 'duplicate_txid' ? 409 : 422;
        return send(res, status, { ok: false, error: error.code || error.message, remainingBlocks: error.remainingBlocks, maturesAtHeight: error.maturesAtHeight });
      }
    }

    if (url.pathname === '/block' && req.method === 'POST') {
      const body = await readBody(req);
      try {
        const accepted = await serial(async () => {
          await publishState(appendCandidateBlock(state, body.envelope, { nowMs: Date.now() }));
          counters.acceptedBlocks++;
          return { height: state.chain.length, tipHash: state.chain.at(-1)?.hash || null };
        });
        relayBlock(body.envelope, String(body.from || '')).catch(() => {});
        return send(res, 200, { ok: true, ...accepted });
      } catch (error) {
        counters.rejected++;
        if ((error.code || error.message) === 'stale_tip' && body.from) {
          try {
            await syncPeer(String(body.from).replace(/\/$/, ''));
            const accepted = await serial(async () => {
              await publishState(appendCandidateBlock(state, body.envelope, { nowMs: Date.now() }));
              counters.acceptedBlocks++;
              return { height: state.chain.length, tipHash: state.chain.at(-1)?.hash || null };
            });
            relayBlock(body.envelope, String(body.from || '')).catch(() => {});
            return send(res, 200, { ok: true, recoveredBySync: true, ...accepted });
          } catch (retryError) {
            return send(res, 409, { ok: false, error: retryError.code || retryError.message });
          }
        }
        return send(res, 422, { ok: false, error: error.code || error.message });
      }
    }

    if (url.pathname === '/control/mine' && req.method === 'POST') {
      const body = await readBody(req);
      try {
        const envelope = await serial(async () => {
          const template = candidateBlockTemplate(state, {
            minerAddress: body.minerAddress,
            timestampMs: Number(body.timestampMs),
            txids: Array.isArray(body.txids) ? body.txids : undefined,
            coinbaseOutputs: Array.isArray(body.coinbaseOutputs) ? body.coinbaseOutputs : null,
          });
          const mined = mineTemplate(template);
          await publishState(appendCandidateBlock(state, mined, { nowMs: Date.now() }));
          counters.acceptedBlocks++;
          return mined;
        });
        await relayBlock(envelope);
        return send(res, 200, { ok: true, block: envelope, status: statusPayload() });
      } catch (error) {
        counters.rejected++;
        return send(res, 422, { ok: false, error: error.code || error.message });
      }
    }

    if (url.pathname === '/control/reset' && req.method === 'POST') {
      await serial(() => resetState());
      return send(res, 200, { ok: true, status: statusPayload() });
    }
    if (url.pathname === '/control/peers' && req.method === 'POST') {
      const body = await readBody(req);
      PEERS = parsePeers(Array.isArray(body.peers) ? body.peers.join(',') : body.peers || '');
      return send(res, 200, { ok: true, peers: [...PEERS] });
    }
    if (url.pathname === '/control/load-chain' && req.method === 'POST') {
      const body = await readBody(req);
      try {
        await serial(async () => {
          await publishState(rebuildCandidateState(body.blocks || [], { nowMs: Number(body.nowMs || Date.now()) }));
          counters.fixtureLoads++;
        });
        return send(res, 200, { ok: true, status: statusPayload() });
      } catch (error) {
        counters.rejected++;
        return send(res, 422, { ok: false, error: error.code || error.message });
      }
    }
    if (url.pathname === '/control/sync' && req.method === 'POST') {
      const results = await syncAll();
      return send(res, 200, { ok: true, results, status: statusPayload() });
    }

    return send(res, 404, { ok: false, error: 'not_found' });
  } catch (error) {
    console.error(JSON.stringify({ event: 'request_error', nodeId: NODE_ID, error: error.message }));
    return send(res, 500, { ok: false, error: error.message || String(error) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(JSON.stringify({
    event: 'listen',
    lab: 'FAE_V5_300_MULTI_NODE_L3',
    profile: PROFILE,
    nodeId: NODE_ID,
    region: REGION,
    port: server.address().port,
    network: CANDIDATE_NETWORK_ID,
    genesisCommitment: CANDIDATE_GENESIS_COMMITMENT,
  }));
});
