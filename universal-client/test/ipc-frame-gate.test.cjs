'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {assertTrustedIpcFrame}=require('../src/ipc-frame-gate.cjs');
const ORIGIN='file:///triumph-sovereign/src/index.html';
function setup(){
  const mainFrame={url:ORIGIN};
  const contents={mainFrame};
  const win={webContents:contents,isDestroyed:()=>false};
  return {mainFrame,contents,win,event:{sender:contents,senderFrame:mainFrame}};
}
test('exact current application main-frame IPC remains authorized',()=>{
  const {event,win}=setup();
  assert.doesNotThrow(()=>assertTrustedIpcFrame(event,win,ORIGIN));
});
test('same-URL child frame and unrelated webContents cannot impersonate application main frame',()=>{
  const {event,win,contents}=setup();
  assert.throws(()=>assertTrustedIpcFrame(
    {sender:contents,senderFrame:{url:ORIGIN}},win,ORIGIN),/Untrusted IPC/);
  assert.throws(()=>assertTrustedIpcFrame(
    {sender:{mainFrame:event.senderFrame},senderFrame:event.senderFrame},win,ORIGIN),/Untrusted IPC/);
  assert.throws(()=>assertTrustedIpcFrame(
    {sender:contents,senderFrame:{url:ORIGIN,parent:event.senderFrame}},win,ORIGIN),/Untrusted IPC/);
});
test('navigation, frame replacement, destroyed app, and missing frames fail closed',()=>{
  const {event,win,mainFrame}=setup();
  mainFrame.url='file:///triumph-sovereign/src/other.html';
  assert.throws(()=>assertTrustedIpcFrame(event,win,ORIGIN),/Untrusted IPC/);
  mainFrame.url=ORIGIN;
  win.webContents.mainFrame={url:ORIGIN};
  assert.throws(()=>assertTrustedIpcFrame(event,win,ORIGIN),/Untrusted IPC/);
  win.webContents.mainFrame=mainFrame;
  win.isDestroyed=()=>true;
  assert.throws(()=>assertTrustedIpcFrame(event,win,ORIGIN),/Untrusted IPC/);
  assert.throws(()=>assertTrustedIpcFrame(null,null,ORIGIN),/Untrusted IPC/);
});
