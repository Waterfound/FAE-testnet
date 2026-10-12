#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const sourcePath = new URL('../standards/sources.json', import.meta.url);
const outputPath = new URL('../standards/standards-observation.json', import.meta.url);
const manifest = JSON.parse(await readFile(sourcePath, 'utf8'));

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
function gitBlobSha1(bytes) {
  const header = Buffer.from(`blob ${bytes.length}\0`, 'utf8');
  return createHash('sha1').update(header).update(bytes).digest('hex');
}

const observations = [];
let failed = false;

for (const resource of manifest.resources) {
  const response = await fetch(resource.url, {
    redirect: 'follow',
    headers: {'user-agent':'FAE-PQ-Standards-Pinner/1.0'}
  });
  if (!response.ok) {
    console.error(`FETCH FAIL ${resource.id}: HTTP ${response.status}`);
    observations.push({id:resource.id,ok:false,http_status:response.status});
    failed = true;
    continue;
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const observed = {
    id: resource.id,
    ok: true,
    final_url: response.url,
    bytes: bytes.length,
    sha256: sha256(bytes)
  };

  if (resource.git_blob_sha1) {
    observed.git_blob_sha1 = gitBlobSha1(bytes);
    observed.git_blob_matches = observed.git_blob_sha1 === resource.git_blob_sha1;
    if (!observed.git_blob_matches) {
      console.error(`GIT BLOB FAIL ${resource.id}`);
      failed = true;
    }
  }
  if (resource.expected_sha256) {
    observed.expected_sha256 = resource.expected_sha256;
    observed.sha256_matches = observed.sha256 === resource.expected_sha256;
    if (!observed.sha256_matches) {
      console.error(`SHA256 DRIFT ${resource.id}`);
      failed = true;
    }
  }

  console.log(`${resource.id} bytes=${observed.bytes} sha256=${observed.sha256}`);
  observations.push(observed);
}

const output = {
  schema:'FAE_PQ_STANDARDS_OBSERVATION_V1',
  source_manifest_status:manifest.status,
  fae_source_revision:manifest.fae_source_revision,
  acvp_commit:manifest.normative_status.acvp.commit,
  observations
};
await writeFile(outputPath, JSON.stringify(output,null,2)+'\n');

if (failed) process.exitCode = 1;
