import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const vault=await readFile(new URL('../wallet-vault.js',import.meta.url),'utf8');
const wallet=await readFile(new URL('../wallet.js',import.meta.url),'utf8');
const html=await readFile(new URL('../index.html',import.meta.url),'utf8');

assert.ok(vault.includes("const DB_NAME='fae-wallet-vault-v1'"));
assert.ok(vault.includes("name:'AES-GCM',length:256"));
assert.ok(vault.includes("false,['encrypt','decrypt']"),'wrapping key must be non-extractable');
assert.ok(vault.includes("indexedDB.open(DB_NAME,DB_VERSION)"));
assert.ok(vault.includes("additionalData:aadFor("),'ciphertext must be bound to authenticated metadata');
assert.equal(/localStorage\.setItem/.test(vault),false,'vault module must not persist secrets in localStorage');
assert.equal(/fetch\s*\(/.test(vault),false,'vault module must not transmit key material');

assert.equal(wallet.includes('replacementConfirmed'),false,'replace-current-wallet model must be removed');
assert.equal(wallet.includes('localStorage.setItem(KEYRING_KEY'),false,'new lifecycle must not write private keyring to localStorage');
assert.equal(wallet.includes('localStorage.setItem(WALLET_KEY'),false,'new lifecycle must not mirror private JWK to localStorage');
assert.ok(wallet.includes('localStorage.removeItem(KEYRING_KEY)'));
assert.ok(wallet.includes('localStorage.removeItem(WALLET_KEY)'));
assert.ok(wallet.includes("if(mining)throw Error('Stop mining before switching Wallets')"));
assert.ok(wallet.includes("if(mining)throw Error('Stop mining before changing the reward address')"));
assert.ok(wallet.includes("if(words.length!==24)throw Error('Enter exactly 24 recovery words')"));

const begin=wallet.slice(wallet.indexOf('async function beginNewWallet()'),wallet.indexOf('async function copyNewSeed()'));
assert.equal(begin.includes('admitAccount'),false,'New Wallet generation must not establish a durable Wallet');
const confirm=wallet.slice(wallet.indexOf('async function confirmNewWallet()'),wallet.indexOf('async function verifyRecoveryWallet()'));
assert.ok(confirm.includes('FAEWalletVault.admitAccount'),'only verified confirmation may admit the New Wallet');
assert.ok(confirm.includes("confirmed!==pendingNewWallet.mnemonic"),'confirmation must exact-match the generated canonical phrase');

assert.ok(wallet.includes("$('recoverypassphrase').value=''"),'recovery passphrase DOM value must be cleared');
assert.ok(wallet.includes('deduplicated'),'duplicate wallet recovery must be deterministic');

assert.ok(html.indexOf('id="action-create"')<html.indexOf('id="action-recovery"'),'New Wallet must precede Recovery Wallet');
assert.equal(html.includes('id="action-insert"'),false,'Insert Wallet must not remain a top-level concept');
assert.ok(html.includes('id="wallet-connected-state" class="stack" hidden'),'management surface starts hidden for zero-wallet state');
assert.ok(html.includes('id="new-wallet-confirmation"'));
assert.ok(html.includes('id="walletlist"'));
assert.ok(html.includes('id="remove-panel"'));
assert.ok(html.includes('src="/wallet-vault.js"'));
assert.ok(html.includes('src="/wallet-signing-intent.js"'));
assert.ok(wallet.includes('FAEWalletSigningIntent.create'),'send path must freeze a reviewed signing intent');

console.log('Wallet persistent-vault contract and storage-boundary checks passed.');
