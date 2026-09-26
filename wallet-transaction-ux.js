'use strict';

window.FAEWalletTransactionUX=(()=>{
  const NETWORK='fairyelf-public-testnet-v4';
  const RECEIPT_FORMAT='FAE_WALLET_TX_RECEIPT_V1';
  const TXID_PATTERN=/^[0-9a-fA-F]{64}$/;

  const HISTORY_COVERAGE=Object.freeze({
    source:'fae-public-testnet-v4 /transactions',
    scope:'active-address-recent-transfers',
    network_scan_limit:100,
    address_result_limit:30,
    complete:false,
    includes_mining_rewards:false,
    cache_authoritative:false
  });

  const HISTORY_STATES=Object.freeze({
    LOADING:'loading',
    READY:'ready',
    EMPTY:'empty',
    UNAVAILABLE:'unavailable',
    INVALID:'invalid',
    STALE:'stale'
  });

  const TX_STATES=Object.freeze({
    CONFIRMED:'confirmed',
    PENDING:'pending',
    UNKNOWN:'unknown'
  });

  const RECEIPT_STATES=Object.freeze({
    ACCEPTED:'accepted',
    PENDING:'pending',
    CONFIRMED:'confirmed',
    UNKNOWN:'unknown'
  });

  function validTxid(value){
    return typeof value==='string'&&TXID_PATTERN.test(value);
  }

  function requireTxid(value){
    if(!validTxid(value))throw Error('Invalid FAE transaction ID');
    return value;
  }

  function finiteTimestampMs(value){
    if(value===null||value===undefined||value==='')return null;
    if(typeof value==='number'||(typeof value==='string'&&/^\d+(?:\.\d+)?$/.test(value.trim()))){
      const numeric=Number(value);
      if(!Number.isFinite(numeric)||numeric<=0)return null;
      const milliseconds=numeric<1e12?numeric*1000:numeric;
      const date=new Date(milliseconds);
      return Number.isNaN(date.getTime())?null:date.getTime();
    }
    if(typeof value==='string'){
      const parsed=Date.parse(value);
      return Number.isNaN(parsed)?null:parsed;
    }
    return null;
  }

  function transactionState(value){
    if(value==='confirmed')return TX_STATES.CONFIRMED;
    if(value==='pending')return TX_STATES.PENDING;
    return TX_STATES.UNKNOWN;
  }

  function validHeight(value){
    if(value===null||value===undefined||value==='')return null;
    const numeric=Number(value);
    return Number.isSafeInteger(numeric)&&numeric>=0?numeric:null;
  }

  function normalizeOutputs(outputs){
    if(!Array.isArray(outputs))throw Error('Invalid transaction outputs');
    return outputs.map(output=>{
      if(!output||typeof output!=='object'||typeof output.address!=='string'||!output.address)throw Error('Invalid transaction output');
      const amount=String(output.amount_atoms??'');
      if(!/^\d+$/.test(amount)||BigInt(amount)<=0n)throw Error('Invalid transaction output amount');
      return Object.freeze({address:output.address,amount_atoms:amount});
    });
  }

  function normalizeInputs(inputs){
    if(!Array.isArray(inputs)||inputs.some(input=>typeof input!=='string'||!input))throw Error('Invalid transaction inputs');
    return Object.freeze(inputs.slice());
  }

  function normalizeTransaction(record){
    if(!record||typeof record!=='object')throw Error('Invalid transaction record');
    const txid=requireTxid(record.txid);
    if(typeof record.from_address!=='string'||!record.from_address)throw Error('Invalid transaction sender');
    const status=transactionState(record.status);
    const confirmedHeight=validHeight(record.confirmed_height);
    if(status===TX_STATES.CONFIRMED&&confirmedHeight===null)throw Error('Confirmed transaction is missing a valid height');
    return Object.freeze({
      txid,
      identity_txid:txid.toLowerCase(),
      from_address:record.from_address,
      inputs:normalizeInputs(record.inputs),
      outputs:Object.freeze(normalizeOutputs(record.outputs)),
      status,
      raw_status:typeof record.status==='string'?record.status:null,
      confirmed_height:confirmedHeight,
      timestamp_ms:finiteTimestampMs(record.timestamp_ms??record.created_at),
      mempool_seq:Number.isSafeInteger(Number(record.mempool_seq))?Number(record.mempool_seq):null
    });
  }

  function baseHistory(address,state,transactions=[],extra={}){
    return Object.freeze({
      state,
      address,
      transactions:Object.freeze(transactions.slice()),
      coverage:HISTORY_COVERAGE,
      fetched_at_ms:extra.fetched_at_ms??null,
      error:extra.error??null,
      stale_reason:extra.stale_reason??null
    });
  }

  function historyLoading(address,previous=null){
    const sameAddress=previous?.address===address;
    const transactions=sameAddress&&Array.isArray(previous.transactions)?previous.transactions:[];
    return baseHistory(address,HISTORY_STATES.LOADING,transactions,{
      fetched_at_ms:sameAddress?(previous.fetched_at_ms??null):null
    });
  }

  function historyFromPayload(payload,address,{fetchedAt=Date.now()}={}){
    if(typeof address!=='string'||!address)throw Error('Active wallet address is required');
    if(!payload||typeof payload!=='object'||payload.ok===false||!Array.isArray(payload.transactions)){
      return baseHistory(address,HISTORY_STATES.INVALID,[],{fetched_at_ms:fetchedAt,error:'Invalid transaction history payload'});
    }
    let transactions;
    try{
      transactions=payload.transactions.map(normalizeTransaction);
    }catch(error){
      return baseHistory(address,HISTORY_STATES.INVALID,[],{fetched_at_ms:fetchedAt,error:error.message});
    }
    if(!transactions.length)return baseHistory(address,HISTORY_STATES.EMPTY,[],{fetched_at_ms:fetchedAt});
    return baseHistory(address,HISTORY_STATES.READY,transactions,{fetched_at_ms:fetchedAt});
  }

  function historyUnavailable(address,error,previous=null){
    const message=error?.message||String(error||'Transaction history unavailable');
    if(previous?.address===address&&Array.isArray(previous.transactions)&&(
      previous.state===HISTORY_STATES.READY||
      previous.state===HISTORY_STATES.EMPTY||
      previous.state===HISTORY_STATES.STALE||
      (previous.state===HISTORY_STATES.LOADING&&previous.fetched_at_ms!==null)
    )){
      return baseHistory(address,HISTORY_STATES.STALE,previous.transactions,{
        fetched_at_ms:previous.fetched_at_ms??null,
        error:message,
        stale_reason:'refresh_failed'
      });
    }
    return baseHistory(address,HISTORY_STATES.UNAVAILABLE,[],{error:message});
  }

  function acceptedReceipt({txid,address,submittedAt=Date.now()}){
    if(typeof address!=='string'||!address)throw Error('Receipt address is required');
    const submitted=finiteTimestampMs(submittedAt);
    if(submitted===null)throw Error('Receipt submission time is invalid');
    return Object.freeze({
      format:RECEIPT_FORMAT,
      network:NETWORK,
      txid:requireTxid(txid),
      identity_txid:txid.toLowerCase(),
      active_address:address,
      submitted_at_ms:submitted,
      state:RECEIPT_STATES.ACCEPTED,
      confirmed_height:null,
      observed_at_ms:null,
      observation:'submit_accepted'
    });
  }

  function receiptFromPublicRecord(record){
    if(!record||record.format!==RECEIPT_FORMAT||record.network!==NETWORK)throw Error('Unsupported transaction receipt');
    return acceptedReceipt({txid:record.txid,address:record.active_address,submittedAt:record.submitted_at_ms});
  }

  function receiptPublicRecord(receipt){
    if(!receipt||receipt.format!==RECEIPT_FORMAT||receipt.network!==NETWORK)throw Error('Invalid transaction receipt');
    return Object.freeze({
      format:RECEIPT_FORMAT,
      network:NETWORK,
      txid:requireTxid(receipt.txid),
      active_address:String(receipt.active_address||''),
      submitted_at_ms:receipt.submitted_at_ms
    });
  }

  function observeReceipt(receipt,history,{observedAt=Date.now()}={}){
    if(!receipt||receipt.format!==RECEIPT_FORMAT||receipt.network!==NETWORK)throw Error('Invalid transaction receipt');
    requireTxid(receipt.txid);
    const observed=finiteTimestampMs(observedAt);
    if(observed===null)throw Error('Receipt observation time is invalid');

    // A confirmed observation is monotonic. Later bounded-history misses or outages
    // cannot erase a confirmation already observed by the wallet.
    if(receipt.state===RECEIPT_STATES.CONFIRMED){
      return Object.freeze({...receipt,observed_at_ms:observed});
    }

    if(!history||history.address!==receipt.active_address){
      return Object.freeze({...receipt,observed_at_ms:observed,observation:'history_not_for_receipt_address'});
    }

    if(history.state===HISTORY_STATES.UNAVAILABLE||history.state===HISTORY_STATES.INVALID||history.state===HISTORY_STATES.LOADING||history.state===HISTORY_STATES.STALE){
      return Object.freeze({...receipt,observed_at_ms:observed,observation:'history_'+history.state});
    }

    const match=history.transactions.find(transaction=>transaction.identity_txid===receipt.identity_txid);
    if(!match){
      return Object.freeze({...receipt,observed_at_ms:observed,observation:'not_observed_within_bounded_history'});
    }

    if(match.status===TX_STATES.CONFIRMED){
      return Object.freeze({...receipt,state:RECEIPT_STATES.CONFIRMED,confirmed_height:match.confirmed_height,observed_at_ms:observed,observation:'confirmed_in_history'});
    }
    if(match.status===TX_STATES.PENDING){
      return Object.freeze({...receipt,state:RECEIPT_STATES.PENDING,confirmed_height:null,observed_at_ms:observed,observation:'pending_in_history'});
    }
    return Object.freeze({...receipt,state:RECEIPT_STATES.UNKNOWN,confirmed_height:null,observed_at_ms:observed,observation:'unknown_status_in_history'});
  }


  function transactionPerspective(transaction,address){
    if(typeof address!=='string'||!address)throw Error('Active wallet address is required');
    const outputs=Array.isArray(transaction?.outputs)?transaction.outputs:[];
    const sent=transaction?.from_address===address;
    const receivedOutputs=outputs.filter(output=>output?.address===address);
    const externalOutputs=sent?outputs.filter(output=>output?.address!==address):[];
    const sum=items=>items.reduce((total,item)=>{
      const amount=String(item?.amount_atoms??'');
      return /^\d+$/.test(amount)?total+BigInt(amount):total;
    },0n);

    if(sent&&externalOutputs.length){
      return Object.freeze({direction:'sent',amount_atoms:sum(externalOutputs).toString(),amount_basis:'outputs_to_other_addresses'});
    }
    if(sent){
      return Object.freeze({direction:'self',amount_atoms:null,amount_basis:'not_inferred'});
    }
    if(receivedOutputs.length){
      return Object.freeze({direction:'received',amount_atoms:sum(receivedOutputs).toString(),amount_basis:'outputs_to_active_address'});
    }
    return Object.freeze({direction:'related',amount_atoms:null,amount_basis:'not_inferred'});
  }

  function statusLabel(state){
    if(state===TX_STATES.CONFIRMED||state===RECEIPT_STATES.CONFIRMED)return 'Confirmed';
    if(state===TX_STATES.PENDING||state===RECEIPT_STATES.PENDING)return 'Pending';
    if(state===RECEIPT_STATES.ACCEPTED)return 'Accepted · awaiting network observation';
    return 'Status unavailable';
  }

  return Object.freeze({
    NETWORK,
    RECEIPT_FORMAT,
    HISTORY_COVERAGE,
    HISTORY_STATES,
    TX_STATES,
    RECEIPT_STATES,
    validTxid,
    finiteTimestampMs,
    transactionState,
    normalizeTransaction,
    historyLoading,
    historyFromPayload,
    historyUnavailable,
    acceptedReceipt,
    receiptFromPublicRecord,
    receiptPublicRecord,
    observeReceipt,
    transactionPerspective,
    statusLabel
  });
})();
