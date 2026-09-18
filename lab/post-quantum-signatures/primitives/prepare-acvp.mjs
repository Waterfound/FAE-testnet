import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import path from 'node:path';

const root = process.cwd();
const sourcePath = path.join(root, 'lab/post-quantum-signatures/standards/sources.json');
const manifest = JSON.parse(await readFile(sourcePath, 'utf8'));
const outDir = process.env.PQ_ACVP_DIR;
const circlDir = process.env.CIRCL_DIR || null;
if (!outDir) throw new Error('PQ_ACVP_DIR is required');

const family = process.env.PQ_ACVP_FAMILY || 'ALL';
const wanted = manifest.resources.filter(r =>
  r.kind === 'nist_acvp_sample_corpus' &&
  !r.id.includes('registration') &&
  (r.path.includes('ML-DSA-') || r.path.includes('SLH-DSA-')) &&
  (family === 'ALL' || r.path.includes(family + '-'))
);
const expected = family === 'ALL' ? 12 : 6;
if (wanted.length !== expected) throw new Error(`expected ${expected} frozen prompt/result resources for ${family}, got ${wanted.length}`);

const observed = [];
for (const resource of wanted) {
  const response = await fetch(resource.url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`fetch failed ${resource.id}: ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== resource.expected_sha256) throw new Error(`sha256 drift for ${resource.id}`);
  if (bytes.length !== resource.expected_bytes) throw new Error(`byte-length drift for ${resource.id}`);

  const dirName = resource.path.split('/').slice(-2, -1)[0];
  const fileName = resource.path.split('/').at(-1);
  const localDir = path.join(outDir, dirName);
  await mkdir(localDir, { recursive: true });
  await writeFile(path.join(localDir, fileName), bytes);

  if (circlDir && dirName.startsWith('ML-DSA-')) {
    const targetDir = path.join(circlDir, 'sign/mldsa/testdata', dirName);
    await mkdir(targetDir, { recursive: true });
    await writeFile(path.join(targetDir, fileName + '.gz'), gzipSync(bytes));
  } else if (circlDir) {
    const mode = dirName.match(/SLH-DSA-(keyGen|sigGen|sigVer)-FIPS205/)?.[1];
    if (!mode) throw new Error('unrecognized SLH-DSA mode: ' + dirName);
    const base = mode === 'sigVer' ? 'verify' : mode;
    const suffix = fileName === 'prompt.json' ? 'prompt' : 'results';
    const targetDir = path.join(circlDir, 'sign/slhdsa/testdata');
    await mkdir(targetDir, { recursive: true });
    await writeFile(path.join(targetDir, `${base}_${suffix}.json.gz`), gzipSync(bytes));
  }
  observed.push({ id: resource.id, sha256: digest, bytes: bytes.length });
}
const evidence = {
  schema: 'FAE_PQ_WAVE_D_ACVP_ACQUISITION_V1',
  result: 'PASS',
  pinned_commit: manifest.normative_status.acvp.commit,
  family,
  resources: observed
};
await writeFile(path.join(outDir, 'acquisition-evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence, null, 2));
