'use strict';

const FAEWalletSigningIntent=(()=>{
  function fail(message){throw Error('SEND_INTENT_INTEGRITY: '+message)}

  function positiveAtoms(value){
    const text=String(value);
    if(!/^[1-9][0-9]*$/.test(text))fail('amount must be a positive integer atom count');
    return text;
  }

  function nonempty(name,value){
    const text=String(value||'').trim();
    if(!text)fail(name+' is required');
    return text;
  }

  function create({network,sourceAddress,destination,amountAtoms}){
    return Object.freeze({
      network:nonempty('network',network),
      sourceAddress:nonempty('source address',sourceAddress),
      destination:nonempty('destination',destination),
      amountAtoms:positiveAtoms(amountAtoms)
    });
  }

  function normalizeCurrent(current){
    return{
      network:nonempty('network',current?.network),
      sourceAddress:nonempty('source address',current?.sourceAddress),
      destination:nonempty('destination',current?.destination),
      amountAtoms:positiveAtoms(current?.amountAtoms)
    };
  }

  function assertCurrent(intent,current){
    const now=normalizeCurrent(current);
    for(const key of ['network','sourceAddress','destination','amountAtoms']){
      if(now[key]!==intent[key])fail('reviewed '+key+' changed before signature release');
    }
    return true;
  }

  function assertTransaction(intent,transaction){
    if(!transaction||transaction.network!==intent.network)fail('transaction network does not match reviewed intent');
    if(!Array.isArray(transaction.outputs)||transaction.outputs.length<1)fail('transaction has no spend output');
    const spend=transaction.outputs[0];
    if(spend?.address!==intent.destination||String(spend?.amount_atoms)!==intent.amountAtoms){
      fail('transaction spend output does not match reviewed intent');
    }
    for(const output of transaction.outputs.slice(1)){
      if(output?.address!==intent.sourceAddress)fail('transaction contains an unreviewed non-change output');
    }
    return true;
  }

  return Object.freeze({create,assertCurrent,assertTransaction});
})();

globalThis.FAEWalletSigningIntent=FAEWalletSigningIntent;
