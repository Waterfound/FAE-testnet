'use strict';
// Byte-for-byte verification of unchanged canonical source inside the unsigned candidate.
// No wallet credentials, private brand originals, remote download, or release publication.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const project=path.resolve(__dirname,'..');
const repo=path.resolve(project,'..');
const dist=path.join(project,'dist');
function resolveResources(){
  if(process.platform==='linux')return path.join(dist,'linux-unpacked','resources');
  if(process.platform==='win32')return path.join(dist,'win-unpacked','resources');
  if(process.platform==='darwin'){
    for(const dir of fs.readdirSync(dist).filter(x=>x.startsWith('mac'))){
      const root=path.join(dist,dir);
      for(const app of fs.readdirSync(root).filter(x=>x.endsWith('.app'))){
        const candidate=path.join(root,app,'Contents','Resources');
        if(fs.existsSync(candidate))return candidate;
      }
    }
  }
  throw Error('Cannot resolve platform-specific packaged resources path');
}
const resources=resolveResources();
const files=[
  'sovereign-forge/node/fae-node.mjs',
  'sovereign-forge/node/explorer-read.mjs',
  'sovereign-forge/node/authoritative/address.mjs',
  'standalone/fae-miner.mjs',
  'standalone/mining-core.mjs'
];
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
for(const file of files){
  const original=fs.readFileSync(path.join(repo,file));
  const packaged=fs.readFileSync(path.join(resources,'fae-runtime',file));
  assert.ok(original.equals(packaged),'Packaged FAE source mismatch: '+file);
  console.log('FAE_PACKAGED_SOURCE_MATCH',file,digest(packaged));
}
console.log('TS_PACKAGED_SOURCE_PASS',process.platform,files.length);
