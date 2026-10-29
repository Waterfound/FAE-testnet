'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const dir=path.resolve(__dirname,'..','dist');
const expected={
 win32:{suffix:'.exe',signature:Buffer.from([0x4d,0x5a]),kind:'NSIS'},
 darwin:{suffix:'.dmg',kind:'DMG'},
 linux:{suffix:'.AppImage',signature:Buffer.from([0x7f,0x45,0x4c,0x46]),kind:'AppImage'}
}[process.platform];
if(!expected)throw Error('Unsupported installer candidate inspection platform');
const candidates=fs.readdirSync(dir).filter(name=>name.endsWith(expected.suffix)&&fs.statSync(path.join(dir,name)).isFile());
assert.equal(candidates.length,1,'Require exactly one expected platform installer candidate');
const name=candidates[0],file=path.join(dir,name),size=fs.statSync(file).size;
assert.ok(size>1_000_000,'Candidate installer unexpectedly small');
const hash=crypto.createHash('sha256');
const input=fs.openSync(file,'r');const header=Buffer.alloc(4);fs.readSync(input,header,0,4,0);
fs.closeSync(input);
if(expected.signature)assert.ok(header.subarray(0,expected.signature.length).equals(expected.signature),'Invalid platform magic');
hash.update(fs.readFileSync(file));
const result={kind:expected.kind,bytes:size,sha256:hash.digest('hex'),filename:name,signatureStatus:'UNSIGNED_CANDIDATE'};
assert.match(result.sha256,/^[a-f0-9]{64}$/);
console.log('TS_INSTALLER_CANDIDATE_INSPECTION_PASS '+JSON.stringify(result));
