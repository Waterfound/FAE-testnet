'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
process.env.TS_PRIVATE_MEDIA_TEST='1';
const {EXPECTED,checkPrivateAssets,privateBuildConfig}=require('../scripts/private-media-builder.cjs');
delete process.env.TS_PRIVATE_MEDIA_TEST;
test('private visual originals are SHA-bound and unavailable to public CI or automatic package jobs',()=>{
  assert.equal(Object.keys(EXPECTED).length,4);
  assert.throws(()=>privateBuildConfig({CI:'true',TS_PRIVATE_MEDIA_DIR:'/dev/null'}),/never be packaged/);
  assert.throws(()=>privateBuildConfig({GITHUB_ACTIONS:'true'}),/never be packaged/);
  assert.throws(()=>privateBuildConfig({}),/Explicit absolute/);
  assert.throws(()=>checkPrivateAssets('assets'),/Explicit absolute/);
});
test('fail closed on missing, tampered or symlinked private media; never substitute artwork',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ts-canonical-media-'));
  try{
    assert.throws(()=>checkPrivateAssets(dir),/ENOENT/);
    for(const name of Object.keys(EXPECTED))fs.writeFileSync(path.join(dir,name),'untrusted fake media');
    assert.throws(()=>checkPrivateAssets(dir),/SHA mismatch/);
    fs.rmSync(path.join(dir,'hero.webp'));
    if(process.platform!=='win32'){
      fs.symlinkSync(path.join(dir,'balance.gif'),path.join(dir,'hero.webp'));
      assert.throws(()=>checkPrivateAssets(dir),/non-symlink/);
    }
  }finally{fs.rmSync(dir,{force:true,recursive:true})}
});
