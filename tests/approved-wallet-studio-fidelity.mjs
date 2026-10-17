import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const root = 'design/approved-wallet-vr08-studio';
const frozenBlobSha = {
  "index.html": "d845bdfae925d5dbde8986b3e19ed39bda497ff8",
  "src/styles.css": "e0cf2fee4b27b41a77f5a6e189ee77ab0d5628fe",
  "src/vr11.ts": "c9f4eb68f89fb9c05caf52a7dd9975d936cd9760",
  "src/main.ts": "5fd279be9b5fa0922c9363b9f232f65fb97ae28c",
  "package.json": "1806eb7c5ddb0f332632d14a2750171c58f7f0a9",
  "vite.config.ts": "3546ec3e96bb370cbb9a6160c4f6b5d271f54e30",
  "postcss.config.js": "2aa7205d4b402a1bdfbe07110c61df920b370066",
  "tailwind.config.js": "ad8390d2cf0106a6aa6d6bf26a426f43f0a6fa9a"
};

for (const [relative, expected] of Object.entries(frozenBlobSha)) {
  const content = readFileSync(`${root}/${relative}`);
  const header = Buffer.from(`blob ${content.length}\\0`.replace('\\0','\0'));
  const got = createHash('sha1').update(header).update(content).digest('hex');
  assert.equal(got, expected, `Approved Studio source changed: ${relative}; stop visual propagation`);
}
const source = readFileSync(`${root}/index.html`, 'utf8');
const product = readFileSync('index.html', 'utf8');
assert.match(source, /class="empty-space"/);
assert.match(source, /class="empty-primary"/);
assert.match(source, /class="empty-aside"/);
assert.match(source, /class="active-composition"/);
assert.match(source, /class="balance-field"/);
assert.match(source, /class="wallet-rail"/);
assert.match(source, /class="flow-strip"/);
assert.match(source, /class="recovery-composition"/);
assert.doesNotMatch(product, /approved-wallet-vr08-studio\/src\/vr11\.ts/, 'Studio synthetic wallet must not become product runtime');
assert.doesNotMatch(product, /approved-wallet-vr08-studio\/src\/main\.ts/, 'Studio demonstration runtime is not cryptographic runtime');
assert.match(product, /id="wallet-connected-state"/);
assert.match(product, /id="action-create"/);
assert.match(product, /id="action-recovery"/);
assert.match(product, /id="walletlist"/);
assert.match(product, /id="bal"/);
console.log(JSON.stringify({ status:'PASS',contract:'APPROVED_STUDIO_SOURCE_LOCK_V1',studio_version:'1791582226769',frozen_files:Object.keys(frozenBlobSha).length,production_runtime_unchanged:true,visual_implementation_accepted:false }));
