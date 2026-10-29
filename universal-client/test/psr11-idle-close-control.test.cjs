'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');

const serverCode=String.raw`
const http=require('node:http');
const connectionIds=new WeakMap();
let connections=0,requests=0,firstSocket=null;
const server=http.createServer((req,res)=>{
  requests++;
  if(!firstSocket)firstSocket=req.socket;
  res.writeHead(200,{'content-type':'application/json','connection':'keep-alive'});
  res.end(JSON.stringify({ok:true,path:req.url,connection:connectionIds.get(req.socket),requests}));
});
server.on('connection',socket=>connectionIds.set(socket,++connections));
server.keepAliveTimeout=5000;
server.listen(0,'127.0.0.1',()=>process.send({type:'ready',port:server.address().port}));
process.on('message',message=>{
  if(message?.type==='arm-close')setTimeout(()=>{
    const at=Date.now();
    if(firstSocket&&!firstSocket.destroyed)firstSocket.destroy();
    process.send({type:'closed',at});
  },message.delay_ms);
  if(message?.type==='stop')server.close(()=>process.exit(0));
});
`;

function once(child,type){
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('fixture timeout: '+type)),5000);
    const onMessage=message=>{
      if(message?.type!==type)return;
      clearTimeout(timer);child.off('message',onMessage);resolve(message);
    };
    child.on('message',onMessage);
  });
}

test('processed peer idle close opens a new socket without retrying the POST',async()=>{
  const child=spawn(process.execPath,['-e',serverCode],{
    stdio:['ignore','ignore','inherit','ipc']
  });
  try{
    const {port}=await once(child,'ready');
    const base=`http://127.0.0.1:${port}`;
    const first=await (await fetch(base+'/status')).json();
    assert.deepEqual(first,{ok:true,path:'/status',connection:1,requests:1});

    child.send({type:'arm-close',delay_ms:20});
    const started=Date.now();
    // Model synchronous PoW starving the parent event loop while a separate
    // node process closes the idle keep-alive connection.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,120);
    const second=await (await fetch(base+'/submit-block',{
      method:'POST',body:'{}'
    })).json();
    const closed=await once(child,'closed');

    assert.ok(closed.at-started>=15&&closed.at-started<100,
      'peer must close while the parent is synchronously blocked');
    assert.deepEqual(second,{ok:true,path:'/submit-block',connection:2,requests:2});
  }finally{
    if(child.connected)child.send({type:'stop'});
    setTimeout(()=>child.kill(),500).unref();
  }
});
