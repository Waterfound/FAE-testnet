# Sovereign standalone FAE wallet (candidate)

**Node.js 22+ • local-first • no browser, FAE account or hosted API required.**
This is a **candidate for the public testnet v4 network only**, not a mainnet release or independent security audit. Use disposable test funds.

Browser, miner, wallet and node remain distinct. The existing Element 58 standalone miner requires only the public reward address. This CLI contains signing authority and must never be used to supply the miner with secret material.

## Commands

From the FAE repository root:

```sh
node standalone/wallet/fae-wallet.mjs help
node standalone/wallet/fae-wallet.mjs create --vault ./my-wallet.vault.json
node standalone/wallet/fae-wallet.mjs recover --vault ./recovered.vault.json
node standalone/wallet/fae-wallet.mjs address --vault ./my-wallet.vault.json
node standalone/wallet/fae-wallet.mjs receive --watch faet1...  # read-only
node standalone/wallet/fae-wallet.mjs status --node http://127.0.0.1:8787
node standalone/wallet/fae-wallet.mjs balance --vault ./my-wallet.vault.json --node http://127.0.0.1:8787
node standalone/wallet/fae-wallet.mjs send --vault ./my-wallet.vault.json --node http://127.0.0.1:8787 --to faet1... --amount 1
node standalone/wallet/fae-wallet.mjs history --vault ./my-wallet.vault.json --node http://127.0.0.1:8787
```

The initial node is **127.0.0.1:8787**; it is never the Waterfound-operated public API. Loopback HTTP is allowed; remote nodes **must** use HTTPS. Users independently choose and trust their nodes. Balance and history are *selected-node assertions*, not independently authenticated light-client proofs. Keep the node synchronized and verify its source/release before relying on its answers.

### Creation and recovery

Create **must** run in an interactive TTY. The 24-word phrase is displayed there only after the encrypted, create-only vault has been safely created. Back up these words OFFLINE. The phrase is never accepted as a command argument, environment variable, pipe or redirected secret output; recovery prompts for it with terminal echo disabled. Both clients share the same 2048-word list and BIP39-256 checksum. No derivation passphrase means **legacy original 32-byte entropy as address 0 seed**. Passphrase-protected wallets use PBKDF2-HMAC-SHA512 to derive the BIP39 root, then canonical HKDF-SHA256 per FAE index. Indices 0–4 are supported by default. Bitcoin/Electrum wallet compatibility is **not** claimed.

The vault is private (0600), create-only and authenticated AES-256-GCM ciphertext using scrypt N=32768, r=8, p=1. Saved public addresses/SPKI alone are **not authentic without decrypting and re-deriving**: every command that uses a saved vault address now requires the vault password through a no-echo TTY, including `address`, `receive`, `balance` and `history`. The user can explicitly use `--watch faet1...` for public-only offline address queries without a vault; a watch-only address cannot sign. Decryption compares all derived addresses and public keys with the stored records and fails closed if they differ. Normal JavaScript memory/key erasure is best effort: **no hardware-backed secret isolation, secure-enclave integration or hardened signing-device assurance is claimed**. Use full-disk encryption and a trusted host.

Passwords and derivation passphrases **must not** be supplied via command-line flags or environment variables. CLI creation/recovery/unlocking fails closed without a real interactive terminal.

### Spending and confirmations

The CLI queries the selected node, checks network identity and uses confirmed, unreserved UTXOs only. For independent node versions: `/balance` with `source:'confirmed'` or fallback `/spendable`; it never treats pending outputs as spendable. Builds `version=2`, `network=fairyelf-public-testnet-v4` and signs canonical `FAIRYELF_TX_V2` payload with local Ed25519. Only a signed transaction is POSTed to `/submit-tx`. The node's TXID and fee are compared with local calculations. **Accepted is not confirmed.** A second independent block must include the TXID before the recipient is paid.

The legacy standalone node supplies `/transactions` with limited recent transfers, not lifetime history. The modern authoritative P2P node currently lacks `/transactions`; the CLI explicitly reports only unspent outputs and **does not fabricate history, reorg proofs or chain confirmations**. On reorg, treat historical status as unknown unless a full indexed and independently validated chain proves otherwise.

### Interrupted send — durable encrypted outbox (candidate)

Before making any `POST /submit-tx`, the CLI creates a **single-flight outbox**
at `<vault>.outbox.json`, mode `0600`, using exclusive creation (it refuses
to overwrite unresolved intent). It encrypts the deterministic signed-TXID,
selected node URL, sender and **recipient** addresses, amount, fee and observed chain
tip with separate scrypt/AES-256-GCM under the vault password, then fsyncs the
file **and containing directory** before the network POST. The outbox contains
**no seed, private key or executable signed transaction**. No automatic
resubmission is performed even if the HTTP acknowledgement is lost.

After a process interruption, use:

```sh
node standalone/wallet/fae-wallet.mjs outbox --vault ./my-wallet.vault.json
```

This asks for the vault password using a no-echo interactive terminal and
queries the originally selected node's `/status` and `/transactions` before
and after the history lookup. The answer is only
`pending_node_reported`, `confirmed_node_reported` or `outcome_unknown`.
The `outbox` command displays the recorded recipient for new intents. Older
outbox files without this field remain decryptable and explicitly report
`legacy_intent_recipient_unavailable`; never infer the recipient of an old
intent from node history. A missing history endpoint, contradictory response,
reorg during observation, node outage or missing historical record is **unknown**,
not proof of rejection.
There is **never** an automatic retry. The CLI blocks any second `send` while
the outbox exists; this prevents accidental duplicate intent after a crash.

Only **after the selected node reports confirmed** and the user independently
checks the chain, the user may explicitly acknowledge the exact locally
recorded TXID to release the send lock:

```sh
node standalone/wallet/fae-wallet.mjs settle --vault ./my-wallet.vault.json --txid <64_hex_txid>
```

Settlement removes the local outbox **only**, not blockchain records or
transactions. It does not undo or reverse a sent transaction, and a selected
node's claim is not a cryptographic finality proof. If no reliable node
history is available, retain the outbox and do not treat omission as a safe
rejection. Test harnesses use only disposable seeds, passwords and local nodes.
The filesystem threat model does not include malicious kernel/admin access,
power-loss guarantees on every filesystem, or hardware-backed key custody.

### Evidence command

```sh
node --test tests/sovereign-standalone-wallet.test.mjs
```

This runs native-versus-real-browser-source parity, wrong checksum/passphrase, damaged ciphertext/permissions, valid/invalid signature, canonical TXID, double-spend rejections, a local standalone miner and node, real CLI terminal send, independent mining, confirmation and process restart. The main repository CI invokes the same exact-source suite on the draft PR. All funded addresses and passwords in tests are disposable fixtures. Never run this against a public URL.

### Remaining release gates

No independently verified full historical index/handling of arbitrary reorgs; no offline signing/air-gapped export interface; no independent installer/reproducible client release; no hardware-backed key protection; no formal security audit of terminal/host memory; no production economics, operator diversity, launch freeze or Mainnet authority. Production suitability is not established by candidate CI.
