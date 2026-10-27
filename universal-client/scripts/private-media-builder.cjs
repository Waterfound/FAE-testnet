'use strict';
// Local opt-in candidate packaging. Public CI never receives private canonical media.
// This file is configuration, not a published resource or a source of signer secrets.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const EXPECTED=Object.freeze({
  'hero.webp':'2ee4395d1769a295f8dbd56c0bc2f74604d4cb363b626d8781e168bab2e6286e',
  'hero-rest.png':'764fcc74bd06053b892382ca27e0eb9b3526741aa4ab3ce225e2438b80b371f0',
  'balance.gif':'a69bd760ff5c787f0e4dd18d55cb444cb4ad59f49b8e0538a84d20b35209a662',
  'balance-rest.png':'3894e1c0e243c71334283d98811dc600fd9434416339735aa94cae422976cef3'
});
function checkPrivateAssets(dir){
  if(typeof dir!=='string'||!path.isAbsolute(dir))
    throw Error('Explicit absolute TS_PRIVATE_MEDIA_DIR required');
  const requested=path.resolve(dir),rootStat=fs.lstatSync(requested);
  // macOS commonly resolves /var to /private/var. Reject a symlinked leaf
  // directory while allowing trusted, OS-standard canonical parent aliases.
  if(!rootStat.isDirectory()||rootStat.isSymbolicLink())
    throw Error('Private media root must be an actual directory, not a symlink');
  const root=fs.realpathSync(requested);
  for(const [name,sha] of Object.entries(EXPECTED)){
    const full=path.join(root,name),stat=fs.lstatSync(full);
    if(!stat.isFile()||stat.isSymbolicLink()||fs.realpathSync(full)!==full)
      throw Error('Private media must be regular non-symlink files');
    const actual=crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
    if(actual!==sha)throw Error('Official private media SHA mismatch: '+name);
  }
  return {root,names:Object.keys(EXPECTED)};
}
function privateBuildConfig(env=process.env){
  if(env.CI==='true'||env.GITHUB_ACTIONS==='true')
    throw Error('Private original art must never be packaged in public CI');
  const assets=checkPrivateAssets(env.TS_PRIVATE_MEDIA_DIR);
  const base=require('../package.json').build;
  return {...base,files:[...base.files,{
    from:assets.root,to:'assets',filter:assets.names
  }]};
}
if(require.main===module){
  if(process.argv.includes('--verify-only')){
    const a=checkPrivateAssets(process.env.TS_PRIVATE_MEDIA_DIR);
    console.log('TS_PRIVATE_MEDIA_VERIFIED '+JSON.stringify({count:a.names.length,canonical_shas:true}));
  }else throw Error('Only --verify-only is supported when launched directly');
}else if(process.env.TS_PRIVATE_MEDIA_TEST==='1'){
  module.exports={EXPECTED,checkPrivateAssets,privateBuildConfig};
}else{
  module.exports=privateBuildConfig();
}
