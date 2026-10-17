import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// DFR-02 Slice 01: real first-frame safety, not artistic acceptance.
// Exercise the exact adapter against a minimal DOM and a read-only vault.
const html = readFileSync('design/wallet-studio-functional/index.html', 'utf8');
const adapter = readFileSync('design/wallet-studio-functional/empty-vault-adapter.js', 'utf8');
const sections = [...html.matchAll(/<section\b(?=[^>]*\bclass="view")(?=[^>]*\bdata-screen="([^"]+)")[^>]*>/gs)];
assert.deepEqual(sections.map(match => match[1]).sort(), ['active', 'create', 'empty', 'recovery']);
for (const [tag, screen] of sections) {
  assert.match(tag, /\bhidden\b/, `Scene ${screen} must be hidden before any script runs`);
}
assert.match(html, /\.view\[hidden\]\s*\{\s*display\s*:\s*none\s*!important\s*\}/);
assert.doesNotMatch(html, /<script[^>]+(?:vr11|src\/main)\.(?:ts|js)/i, 'Synthetic Studio runtime must not run');
assert.match(html, /<script src="\.\/empty-vault-adapter\.js"><\/script>/);

function deferred() {
  let resolve, reject;
  const promise = new Promise((ok, bad) => { resolve = ok; reject = bad; });
  return { promise, resolve, reject };
}
function fixture(vault) {
  const views = ['empty', 'create', 'active', 'recovery'].map(screen => ({
    dataset: { screen }, hidden: true,
    querySelector(selector) {
      return screen === 'empty' && ['.empty-primary', '.empty-aside'].includes(selector) ? {} : null;
    }
  }));
  const listeners = new Map();
  const button = id => ({
    addEventListener(event, handler) { listeners.set(id + ':' + event, handler); }
  });
  const eventLine = { textContent: '', classList: { add() {} } };
  const nodes = { eventLine, startNew: button('startNew'), startRecovery: button('startRecovery') };
  const back = button('back');
  const root = { dataset: {} };
  const document = {
    documentElement: root,
    getElementById(id) { return nodes[id] || null; },
    querySelector(selector) { return selector === '[data-screen="empty"]' ? views[0] : null; },
    querySelectorAll(selector) {
      if (selector === '[data-screen]') return views;
      if (selector === '[data-back="empty"]') return [back];
      return [];
    }
  };
  const window = { FAEWalletVault: vault };
  const running = runInNewContext(adapter, { document, window, Promise, Error });
  const visible = () => views.filter(view => !view.hidden).map(view => view.dataset.screen);
  return { running, root, visible, listeners, eventLine };
}

const emptyWallets = deferred();
const emptyState = deferred();
const empty = fixture({
  listWallets: () => emptyWallets.promise,
  readState: () => emptyState.promise
});
assert.equal(empty.root.dataset.walletAdapter, 'checking');
assert.deepEqual(empty.visible(), [], 'No sample active wallet may flash during IndexedDB admission');
emptyWallets.resolve([]);
emptyState.resolve({ activeWalletId: null });
await empty.running;
assert.equal(empty.root.dataset.walletAdapter, 'empty-vault-read-only');
assert.deepEqual(empty.visible(), ['empty']);
empty.listeners.get('startNew:click')();
assert.deepEqual(empty.visible(), ['create']);
empty.listeners.get('back:click')();
assert.deepEqual(empty.visible(), ['empty']);
empty.listeners.get('startRecovery:click')();
assert.deepEqual(empty.visible(), ['recovery']);

const saved = fixture({
  listWallets: async () => [{ walletId: 'saved' }],
  readState: async () => ({ activeWalletId: 'saved' })
});
await saved.running;
assert.equal(saved.root.dataset.walletAdapter, 'fail-closed');
assert.deepEqual(saved.visible(), [], 'Existing wallet must never be replaced by sample balance or empty onboarding');

const storageError = fixture({
  listWallets: async () => { throw Error('IndexedDB unavailable'); },
  readState: async () => ({ activeWalletId: null })
});
await storageError.running;
assert.equal(storageError.root.dataset.walletAdapter, 'fail-closed');
assert.deepEqual(storageError.visible(), [], 'Unreadable storage must never be treated as empty');

const missingVault = fixture(undefined);
await missingVault.running;
assert.equal(missingVault.root.dataset.walletAdapter, 'fail-closed');
assert.deepEqual(missingVault.visible(), []);

console.log('Wallet Studio first-frame PASS: four hidden scenes, delayed read, saved-wallet gate, storage fail-closed, explicit-only navigation');
