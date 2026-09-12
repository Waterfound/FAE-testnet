import { appendFile, readFile } from 'node:fs/promises';
import { digestJson } from './canonical.mjs';

export function buildLedgerEvent(payload, previousHash = null, options = {}) {
  const event = {
    schema_version: 'fae.red-team.learning-event.v0.0.1',
    sequence: options.sequence || 1,
    recorded_at: options.now || new Date().toISOString(),
    previous_hash: previousHash,
    payload: structuredClone(payload)
  };
  event.event_hash = digestJson(event);
  return event;
}

export function verifyLedger(events) {
  let previous = null;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event.sequence !== index + 1) throw new Error('Learning ledger sequence mismatch');
    if (event.previous_hash !== previous) throw new Error('Learning ledger chain mismatch at sequence ' + event.sequence);
    const copy = structuredClone(event);
    const digest = copy.event_hash;
    delete copy.event_hash;
    if (digest !== digestJson(copy)) throw new Error('Learning ledger event digest mismatch at sequence ' + event.sequence);
    previous = event.event_hash;
  }
  return true;
}

export async function readLedger(path) {
  try {
    const text = await readFile(path, 'utf8');
    const events = text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
    verifyLedger(events);
    return events;
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

export async function appendLearningEvent(path, payload, options = {}) {
  const events = await readLedger(path);
  const previous = events.length === 0 ? null : events[events.length - 1].event_hash;
  const event = buildLedgerEvent(payload, previous, {
    sequence: events.length + 1,
    now: options.now
  });
  await appendFile(path, JSON.stringify(event) + '\n', { encoding: 'utf8', mode: 0o600 });
  const verified = await readLedger(path);
  if (verified[verified.length - 1].event_hash !== event.event_hash) {
    throw new Error('Learning ledger post-append verification failed');
  }
  return event;
}
