'use strict';
const {EventEmitter}=require('node:events');
// Wrap Electron utilityProcess without requiring runAsNode or a wallet secret.
// Inject the verified Electron utilityProcess.fork; no arbitrary renderer command API.
function makeUtilitySpawn(fork){
  if(typeof fork!=='function')throw Error('Electron utilityProcess.fork required');
  return (_unusedExecutable,args,options)=>{
    if(!Array.isArray(args)||typeof args[0]!=='string'||!options||!Array.isArray(options.stdio))
      throw Error('Invalid managed FAE process arguments');
    const [script,...argv]=args;
    const utility=fork(script,argv,{
      cwd:options.cwd,env:options.env,
      stdio:options.stdio[1]==='pipe'?'pipe':'ignore',
      serviceName:script.endsWith('fae-miner.mjs')?'Triumph FAE Miner':'Triumph FAE Node'
    });
    const child=new EventEmitter();
    child.exitCode=null;child.killed=false;child._tsFailed=false;
    Object.defineProperty(child,'stdout',{get:()=>utility.stdout??null});
    child.kill=()=>{child.killed=true;return utility.kill()};
    utility.on('exit',code=>{child.exitCode=code;child.emit('exit',code)});
    utility.on('error',()=>{child._tsFailed=true;child.emit('error',Error('Managed utility process failed'))});
    return child;
  };
}
module.exports={makeUtilitySpawn};
