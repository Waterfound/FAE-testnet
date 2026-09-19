import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const buildPath=path.join(root,'explorer','build.mjs');
const read=async p=>readFile(path.join(root,p),'utf8');
const SHA='a'.repeat(40);

async function build(extra={}){
  const out=await mkdtemp(path.join(os.tmpdir(),'fae-explorer-be04-'));
  const result=spawnSync(process.execPath,[buildPath],{
    cwd:root,
    encoding:'utf8',
    env:{
      ...process.env,
      FAE_EXPLORER_OUTPUT_DIR:out,
      FAE_EXPLORER_SOURCE_REVISION:SHA,
      ...extra
    }
  });
  return{out,result,cleanup:()=>rm(out,{recursive:true,force:true})};
}

test('source config remains local-only and NOT_LIVE',async()=>{
  const config=JSON.parse(await read('explorer/config.json'));
  assert.equal(config.schema,'FAE_EXPLORER_APP_CONFIG_V2');
  assert.equal(config.network,'fairyelf-public-testnet-v4');
  assert.equal(config.binding_state,'LOCAL_DEV');
  assert.equal(config.deployment_state,'NOT_LIVE');
  assert.equal(config.read_only,true);
  assert.equal(config.api_base,'http://127.0.0.1:8787');
});

test('default deploy build produces explicit public UNBOUND artifact',async()=>{
  const run=await build();
  try{
    assert.equal(run.result.status,0,run.result.stderr);
    const config=JSON.parse(await readFile(path.join(run.out,'config.json'),'utf8'));
    const attestation=JSON.parse(await readFile(path.join(run.out,'deployment.json'),'utf8'));
    assert.equal(config.deployment_state,'PUBLIC_PREBIND');
    assert.equal(config.binding_state,'UNBOUND');
    assert.equal(config.api_base,null);
    assert.equal(config.source_revision,SHA);
    assert.equal(config.read_only,true);
    assert.equal(attestation.api_origin,null);
    assert.equal(attestation.authority,'NON_AUTHORITATIVE_OBSERVATION_ONLY');
    for(const file of ['index.html','styles.css','api-client.mjs','app.mjs']) {
      assert.ok((await readFile(path.join(run.out,file),'utf8')).length>0,file+' missing from deploy artifact');
    }
  }finally{await run.cleanup()}
});

test('UNBOUND artifact refuses accidental API injection',async()=>{
  const run=await build({FAE_EXPLORER_API_BASE:'https://node.example'});
  try{
    assert.equal(run.result.status,2);
    assert.match(run.result.stderr,/UNBOUND build must not contain an API base/);
  }finally{await run.cleanup()}
});

test('BOUND_CANDIDATE requires HTTPS and records only origin',async()=>{
  const run=await build({
    FAE_EXPLORER_BINDING_STATE:'BOUND_CANDIDATE',
    FAE_EXPLORER_DEPLOYMENT_STATE:'PUBLIC_BOUND_CANDIDATE',
    FAE_EXPLORER_API_BASE:'https://node.example'
  });
  try{
    assert.equal(run.result.status,0,run.result.stderr);
    const config=JSON.parse(await readFile(path.join(run.out,'config.json'),'utf8'));
    const attestation=JSON.parse(await readFile(path.join(run.out,'deployment.json'),'utf8'));
    assert.equal(config.api_base,'https://node.example');
    assert.equal(config.binding_state,'BOUND_CANDIDATE');
    assert.equal(attestation.api_origin,'https://node.example');
  }finally{await run.cleanup()}
});

test('BOUND_CANDIDATE refuses plain HTTP',async()=>{
  const run=await build({
    FAE_EXPLORER_BINDING_STATE:'BOUND_CANDIDATE',
    FAE_EXPLORER_DEPLOYMENT_STATE:'PUBLIC_BOUND_CANDIDATE',
    FAE_EXPLORER_API_BASE:'http://node.example'
  });
  try{
    assert.equal(run.result.status,2);
    assert.match(run.result.stderr,/requires HTTPS/);
  }finally{await run.cleanup()}
});

test('BE-04 builder cannot synthesize LIVE state',async()=>{
  const run=await build({
    FAE_EXPLORER_BINDING_STATE:'BOUND_CANDIDATE',
    FAE_EXPLORER_DEPLOYMENT_STATE:'LIVE',
    FAE_EXPLORER_API_BASE:'https://node.example'
  });
  try{
    assert.equal(run.result.status,2);
    assert.match(run.result.stderr,/LIVE cannot be synthesized/);
  }finally{await run.cleanup()}
});

test('public prebind UI disables chain actions instead of pretending data exists',async()=>{
  const app=await read('explorer/app.mjs');
  assert.match(app,/binding_state==='UNBOUND'/);
  assert.match(app,/Node binding pending/);
  assert.match(app,/ui\.input\.disabled=true/);
  assert.match(app,/ui\.refresh\.disabled=true/);
  assert.match(app,/No chain data is being presented/);
});

test('deployment artifact remains provider-independent',async()=>{
  const buildSource=await read('explorer/build.mjs');
  for(const provider of ['vercel.com','onrender.com','supabase.co']){
    assert.equal(buildSource.includes(provider),false,'provider coupling leaked into build artifact: '+provider);
  }
});

test('BE-04 authority permits public prebind but not LIVE or node deployment',async()=>{
  const authority=JSON.parse(await read('lab/block-explorer/authority.json'));
  assert.equal(authority.current_frontier,'BE-04');
  assert.equal(authority.be04_authority.state,'AUTHORIZED_BOUNDED');
  assert.equal(authority.public_frontend_prebind_deployment_authorized,true);
  assert.equal(authority.public_https_node_binding_authorized,false);
  assert.equal(authority.independent_node_public_deployment_authorized,false);
  assert.equal(authority.explorer_application_live_authorized,false);
  assert.equal(authority.public_deployment_authorized,false);
  assert.equal(authority.node_query_surface_write_authorized,false);
  assert.equal(authority.wallet_write_authorized,false);
  assert.equal(authority.mining_authority_authorized,false);
});
