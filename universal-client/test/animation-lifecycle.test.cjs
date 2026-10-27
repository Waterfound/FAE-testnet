'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

test('Hero is one-shot per entry; Balance only loops in visible Wallet and reduces to still',async()=>{
  const pageListeners={},mqListeners={},nodes=new Map();let onState;
  const el=id=>({id,hidden:false,textContent:'',value:'',src:'',dataset:{},style:{},disabled:false,
    classList:{toggle(){}},setAttribute(){},addEventListener(type,fn){this['on'+type]=fn},
    removeAttribute(name){if(name==='src')this.src=''}
  });
  const get=id=>{if(!nodes.has(id))nodes.set(id,el(id));return nodes.get(id)};
  const nav=['home','wallet','mining','node','explorer','settings'].map(page=>{
    const item=el(page);item.dataset.page=page;return item;
  });
  const doc={hidden:false,getElementById:get,querySelectorAll:()=>nav,
    addEventListener(name,fn){pageListeners[name]=fn}};
  const mq={matches:false,addEventListener(name,fn){mqListeners[name]=fn}};
  const context={document:doc,window:{matchMedia:()=>mq,
    triumph:{onState:fn=>{onState=fn},snapshot:async()=>({node:'stopped',miner:'stopped'})}},
    matchMedia:()=>mq,setTimeout:()=>0,clearTimeout:()=>{},console};
  const js=fs.readFileSync(path.join(__dirname,'../src/renderer.js'),'utf8');
  vm.runInNewContext(js,context,{filename:'renderer.js'});
  assert.match(get('hero-motion').src,/hero\.webp$/);
  onState({node:'stopped',miner:'stopped',telemetry:{}});
  assert.match(get('hero-motion').src,/hero\.webp$/,'re-render must not replay Hero');
  nav[1].onclick();
  assert.equal(get('hero-motion').src,'');
  assert.match(get('balance-motion').src,/balance\.gif$/);
  nav[3].onclick();
  assert.equal(get('balance-motion').src,'','offscreen Wallet must unload loop');
  nav[0].onclick();
  assert.match(get('hero-motion').src,/hero\.webp$/,'one fresh playback on re-entry');
  doc.hidden=true;pageListeners.visibilitychange();
  assert.equal(get('hero-motion').src,'');
  assert.match(get('hero-rest').src,/hero-rest\.png$/);
  doc.hidden=false;pageListeners.visibilitychange();
  assert.equal(get('hero-motion').src,'','refocus must not restart one-shot');
  mq.matches=true;mqListeners.change();
  assert.match(get('hero-rest').src,/hero-rest\.png$/);
  nav[1].onclick();
  assert.doesNotMatch(get('balance-motion').src,/balance\.gif$/);
  assert.match(get('balance-rest').src||get('balance-motion').src,/balance-rest\.png$/);
});
