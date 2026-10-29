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


test('private Hero V4 source timing halts the animation once and preserves static re-entry rules',()=>{
  const nodes=new Map(),nav=[],pageListeners={},timers=new Map();let next=0;
  const make=id=>({id,src:'',hidden:false,value:'',dataset:{},style:{},textContent:'',disabled:false,
    classList:{toggle(){}},setAttribute(){},removeAttribute(name){if(name==='src')this.src=''},
    addEventListener(type,cb){this['on'+type]=cb}});
  const el=id=>{if(!nodes.has(id))nodes.set(id,make(id));return nodes.get(id)};
  for(const p of ['home','wallet','mining','node','explorer','settings']){
    const btn=make(p);btn.dataset.page=p;nav.push(btn);
  }
  const doc={hidden:false,getElementById:el,querySelectorAll:()=>nav,
    addEventListener(type,cb){pageListeners[type]=cb}};
  const mq={matches:false,addEventListener(){}};
  const vmContext={
    document:doc,matchMedia:()=>mq,
    window:{triumph:{onState(){},snapshot:async()=>({node:'stopped',miner:'stopped'})}},
    setTimeout:(cb,ms)=>{const id=++next;timers.set(id,{cb,ms});return id},
    clearTimeout:id=>timers.delete(id),console
  };
  const js=fs.readFileSync(path.join(__dirname,'../src/renderer.js'),'utf8');
  vm.runInNewContext(js,vmContext);
  assert.match(el('hero-motion').src,/hero\.webp$/);
  el('hero-motion').onload();
  assert.equal(timers.size,1);
  const task=[...timers.values()][0];
  assert.equal(task.ms,4999,'Actual private 150-frame Hero V4 duration');
  task.cb();
  assert.equal(el('hero-motion').src,'');
  assert.match(el('hero-rest').src,/hero-rest\.png$/);
  assert.equal(timers.size,0);
  nav[1].onclick();
  nav[0].onclick();
  assert.match(el('hero-motion').src,/hero\.webp$/,'New page entry replays once');
  el('hero-motion').onload();
  assert.equal(timers.size,1);
  nav[1].onclick();
  assert.equal(timers.size,0,'Leaving Home cancels an in-flight playback');
  nav[0].onclick();
  assert.match(el('hero-motion').src,/hero\.webp$/);
  doc.hidden=true;pageListeners.visibilitychange();
  assert.equal(el('hero-motion').src,'');
  assert.match(el('hero-rest').src,/hero-rest\.png$/);
});
