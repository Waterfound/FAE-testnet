'use strict';

(function exposeWalletTransactionContract(root){
  const TXID_RE=/^[0-9a-f]{64}$/;
  const COVERAGE=Object.freeze({
    kind:'recent_active_address_transfers',
    active_address_only:true,
    source_network_scan_limit:100,
    address_result_limit:30,
    mining_rewards_included:false,
    lifetime_complete:false,
    pagination:false
  });

  function validTxid(value){
    return typeof value==='string'&&TXID_RE.test(value);
  }

  function parseTimestamp(value){
    if(value===undefined||value===null||value==='')return Object.freeze({kind:'missing',iso:null});
    let milliseconds;
    if(typeof value==='number'){
      if(!Number.isFinite(value)||value<0)return Object.freeze({kind:'invalid',iso:null});
      milliseconds=value<1e12?value*1000:value;
    }else if(typeof value==='string'){
      const text=value.trim();
      if(!text)return Object.freeze({kind:'missing',iso:null});
      if(/^\d+$/.test(text)){
        const numeric=Number(text);
        if(!Number.isSafeInteger(numeric)||numeric<0)return Object.freeze({kind:'invalid',iso:null});
        milliseconds=numeric<1e12?numeric*1000:numeric;
      }else{
        milliseconds=Date.parse(text);
      }
    }else{
      return Object.freeze({kind:'invalid',iso:null});
    }
    if(!Number.isFinite(milliseconds))return Object.freeze({kind:'invalid',iso:null});
    const date=new Date(milliseconds);
    if(Number.isNaN(date.getTime()))return Object.freeze({kind:'invalid',iso:null});
    return Object.freeze({kind:'valid',iso:date.toISOString(),epoch_ms:date.getTime()});
  }

  function normalizeHeight(value){
    if(value===undefined||value===null||value==='')return null;
    const numeric=Number(value);
    return Number.isSafeInteger(numeric)&&numeric>0?numeric:null;
  }

  function normalizeStatus(status,confirmedHeight){
    const height=normalizeHeight(confirmedHeight);
    if(status==='confirmed'){
      if(height===null)return Object.freeze({kind:'invalid',raw_status:status,confirmed_height:null,reason:'confirmed_without_valid_height'});
      return Object.freeze({kind:'confirmed',raw_status:status,confirmed_height:height});
    }
    if(status==='pending'){
      if(height!==null)return Object.freeze({kind:'invalid',raw_status:status,confirmed_height:height,reason:'pending_with_confirmed_height'});
      return Object.freeze({kind:'pending',raw_status:status,confirmed_height:null});
    }
    if(typeof status==='string'&&status.trim()){
      return Object.freeze({kind:'unknown',raw_status:status,confirmed_height:height});
    }
    return Object.freeze({kind:'invalid',raw_status:null,confirmed_height:height,reason:'missing_status'});
  }

  function normalizeOutputs(outputs){
    if(!Array.isArray(outputs))return {ok:false,reason:'outputs_not_array',outputs:[]};
    if(outputs.length===0)return {ok:false,reason:'outputs_empty',outputs:[]};
    const normalized=[];
    for(const output of outputs){
      const address=typeof output?.address==='string'?output.address:'';
      const amount=String(output?.amount_atoms??'');
      if(!address||!/^\d+$/.test(amount)||BigInt(amount)<=0n){
        return {ok:false,reason:'invalid_output',outputs:[]};
      }
      normalized.push(Object.freeze({address,amount_atoms:amount}));
    }
    return {ok:true,outputs:Object.freeze(normalized)};
  }

  function classifyDirection(fromAddress,outputs,activeAddress){
    if(typeof activeAddress!=='string'||!activeAddress)return {ok:false,reason:'missing_active_address'};
    const fromSelf=fromAddress===activeAddress;
    const toSelf=outputs.filter(output=>output.address===activeAddress);
    if(!fromSelf&&!toSelf.length)return {ok:false,reason:'transaction_unrelated_to_active_address'};
    const allToSelf=outputs.length>0&&outputs.every(output=>output.address===activeAddress);
    if(fromSelf&&allToSelf)return {ok:true,direction:'self',has_change:false};
    if(fromSelf)return {ok:true,direction:'sent',has_change:toSelf.length>0};
    return {ok:true,direction:'received',has_change:false};
  }

  function normalizeTransaction(record,activeAddress){
    if(!record||typeof record!=='object')return Object.freeze({ok:false,reason:'record_not_object'});
    const txid=String(record.txid??'');
    if(!validTxid(txid))return Object.freeze({ok:false,reason:'invalid_txid',txid:null});
    const fromAddress=typeof record.from_address==='string'?record.from_address:'';
    if(!fromAddress)return Object.freeze({ok:false,reason:'missing_from_address',txid});
    const outputsResult=normalizeOutputs(record.outputs);
    if(!outputsResult.ok)return Object.freeze({ok:false,reason:outputsResult.reason,txid});
    const direction=classifyDirection(fromAddress,outputsResult.outputs,activeAddress);
    if(!direction.ok)return Object.freeze({ok:false,reason:direction.reason,txid});
    const status=normalizeStatus(record.status,record.confirmed_height);
    if(status.kind==='invalid')return Object.freeze({ok:false,reason:status.reason,txid});
    const timestamp=parseTimestamp(record.timestamp_ms??record.created_at);
    return Object.freeze({
      ok:true,
      txid,
      from_address:fromAddress,
      outputs:outputsResult.outputs,
      direction:direction.direction,
      has_change:direction.has_change,
      status,
      timestamp,
      mempool_seq:Number.isSafeInteger(Number(record.mempool_seq))?Number(record.mempool_seq):null
    });
  }

  function normalizeHistoryPayload(payload,activeAddress){
    if(!payload||typeof payload!=='object'||!Array.isArray(payload.transactions)){
      return Object.freeze({
        state:'invalid_payload',
        active_address:activeAddress||null,
        transactions:Object.freeze([]),
        issues:Object.freeze(['transactions_not_array']),
        coverage:COVERAGE
      });
    }
    const transactions=[];
    const issues=[];
    payload.transactions.forEach((record,index)=>{
      const normalized=normalizeTransaction(record,activeAddress);
      if(normalized.ok)transactions.push(normalized);
      else issues.push('transaction_'+index+':'+normalized.reason);
    });
    const state=issues.length
      ?'invalid_payload'
      :transactions.length
        ?'ready_recent'
        :'empty_within_available_coverage';
    return Object.freeze({
      state,
      active_address:activeAddress||null,
      transactions:Object.freeze(transactions),
      issues:Object.freeze(issues),
      coverage:COVERAGE
    });
  }

  function historyFailure(previous,reason='network_unavailable'){
    const canPreserve=previous&&(
      previous.state==='ready_recent'||
      previous.state==='empty_within_available_coverage'||
      previous.state==='stale'
    );
    return Object.freeze({
      state:canPreserve?'stale':'unavailable',
      active_address:previous?.active_address??null,
      transactions:canPreserve?previous.transactions??Object.freeze([]):Object.freeze([]),
      issues:Object.freeze([String(reason)]),
      coverage:COVERAGE
    });
  }

  function acceptedReceipt({txid,address,network,acceptedAt}={}){
    if(!validTxid(txid))throw Error('invalid accepted transaction id');
    if(typeof address!=='string'||!address)throw Error('missing accepted transaction address');
    if(typeof network!=='string'||!network)throw Error('missing accepted transaction network');
    const timestamp=parseTimestamp(acceptedAt);
    if(timestamp.kind!=='valid')throw Error('invalid accepted transaction timestamp');
    return Object.freeze({
      version:1,
      state:'accepted_unconfirmed',
      txid,
      address,
      network,
      accepted_at:timestamp.iso
    });
  }

  root.FAEWalletTransactions=Object.freeze({
    coverage:COVERAGE,
    validTxid,
    parseTimestamp,
    normalizeStatus,
    normalizeTransaction,
    normalizeHistoryPayload,
    historyFailure,
    acceptedReceipt
  });
})(typeof window!=='undefined'?window:globalThis);
