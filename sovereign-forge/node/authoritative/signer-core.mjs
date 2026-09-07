import {createPrivateKey,createPublicKey,sign as nodeSign} from 'node:crypto';
import {randomUUID} from 'node:crypto';
import {encodeAddress,isValidAddress} from './address.mjs';
import {hashHex,sha256} from './crypto.mjs';
import {stableStringify} from './canonical.mjs';
import {validateSendIntent} from './intent.mjs';

function atoms(value,field){let n;try{n=BigInt(value)}catch{throw new Error(`${field} must be an integer atomic amount`)}if(n<0n)throw new Error(`${field} cannot be negative`);return n}
function publicSpkiFromPrivateJwk(privateJwk){const privateKey=createPrivateKey({key:privateJwk,format:'jwk'});return createPublicKey(privateKey).export({type:'spki',format:'der'})}
function addressFromSpki(spki,hrp='faet'){return encodeAddress(sha256(spki).subarray(0,20),hrp)}

export function normalizeSignerWallet(wallet,{hrp='faet'}={}){
  if(!wallet?.privateJwk?.d)throw new Error('Signer wallet requires an Ed25519 private JWK');
  const spki=wallet.publicKeySpki?Buffer.from(wallet.publicKeySpki,'base64'):publicSpkiFromPrivateJwk(wallet.privateJwk);
  const address=addressFromSpki(spki,hrp);
  if(wallet.address&&wallet.address!==address)throw new Error('Signer wallet address/private key mismatch');
  if(!isValidAddress(address,hrp))throw new Error('Signer wallet produced an invalid address');
  return {address,publicKeySpki:spki.toString('base64'),privateJwk:structuredClone(wallet.privateJwk)};
}

export function planTransactionV2({wallet,to,amountAtoms,feeAtoms=0n,utxos,network='fairyelf-public-testnet-v4',hrp='faet'}){
  const normalized=normalizeSignerWallet(wallet,{hrp});
  if(!isValidAddress(to,hrp))throw new Error('Invalid destination address');
  const amount=atoms(amountAtoms,'amountAtoms'),fee=atoms(feeAtoms,'feeAtoms'),target=amount+fee;if(amount<=0n)throw new Error('Amount must be positive');
  const candidates=(Array.isArray(utxos)?utxos:[]).map(u=>({outpoint:String(u.outpoint),amount_atoms:String(u.amount_atoms)})).filter(u=>u.outpoint&&atoms(u.amount_atoms,'utxo amount')>0n).sort((a,b)=>a.outpoint.localeCompare(b.outpoint));
  const selected=[];let total=0n;for(const utxo of candidates){selected.push(utxo);total+=BigInt(utxo.amount_atoms);if(total>=target)break}if(total<target)throw new Error('Insufficient spendable balance');
  const outputs=[{address:to,amount_atoms:amount.toString()}],change=total-target;if(change>0n)outputs.push({address:normalized.address,amount_atoms:change.toString()});
  const unsigned={version:2,network,inputs:selected.map(u=>u.outpoint),outputs,public_key_spki:normalized.publicKeySpki};
  return {wallet:normalized,unsigned,selected,totalInputAtoms:total,amountAtoms:amount,feeAtoms:fee,changeAtoms:change};
}

export function signPlannedTransactionV2(plan){
  const payload={domain:'FAIRYELF_TX_V2',network:plan.unsigned.network,inputs:plan.unsigned.inputs,outputs:plan.unsigned.outputs,public_key_spki:plan.unsigned.public_key_spki};
  const privateKey=createPrivateKey({key:plan.wallet.privateJwk,format:'jwk'});
  const signature=nodeSign(null,Buffer.from(stableStringify(payload)),privateKey).toString('base64');
  const tx={...plan.unsigned,signature};
  return {...tx,txid:hashHex(tx),from_address:plan.wallet.address};
}

export class SovereignSignerCore{
  constructor({wallet,network='fairyelf-public-testnet-v4',hrp='faet',spendableProvider,broadcastProvider,maxPending=32}={}){
    this.wallet=normalizeSignerWallet(wallet,{hrp});this.network=network;this.hrp=hrp;this.spendableProvider=spendableProvider;this.broadcastProvider=broadcastProvider;this.maxPending=maxPending;this.pending=new Map();
  }
  addIntent(intent){const {amount,fee}=validateSendIntent(intent,{networkId:this.network,hrp:this.hrp,expectedFrom:this.wallet.address});if(this.pending.size>=this.maxPending)throw new Error('Signer pending-intent limit reached');const approvalId=randomUUID();this.pending.set(approvalId,{intent:structuredClone(intent),amount,fee,addedAt:Date.now(),preview:null});return{approvalId,intentId:intent.intentId,from:intent.from,to:intent.to,amount_atoms:amount.toString(),fee_atoms:fee.toString(),expiresAt:intent.expiresAt??null}}
  listPending(){const now=Date.now();for(const [id,item] of this.pending)if(item.intent.expiresAt&&Date.parse(item.intent.expiresAt)<=now)this.pending.delete(id);return[...this.pending.entries()].map(([approvalId,item])=>({approvalId,intentId:item.intent.intentId,from:item.intent.from,to:item.intent.to,amount_atoms:item.amount.toString(),fee_atoms:item.fee.toString(),expiresAt:item.intent.expiresAt??null,previewCommitment:item.preview?.commitment??null}))}
  async preview(approvalId){const item=this.pending.get(approvalId);if(!item)throw new Error('Unknown or expired approval');validateSendIntent(item.intent,{networkId:this.network,hrp:this.hrp,expectedFrom:this.wallet.address});if(typeof this.spendableProvider!=='function')throw new Error('Signer spendable provider is not configured');const spendable=await this.spendableProvider(this.wallet.address);const plan=planTransactionV2({wallet:this.wallet,to:item.intent.to,amountAtoms:item.amount,feeAtoms:item.fee,utxos:spendable.utxos??spendable,network:this.network,hrp:this.hrp});const publicPlan={intentId:item.intent.intentId,network:this.network,from:this.wallet.address,to:item.intent.to,amount_atoms:item.amount.toString(),fee_atoms:item.fee.toString(),change_atoms:plan.changeAtoms.toString(),selected_inputs:plan.unsigned.inputs,outputs:plan.unsigned.outputs,expiresAt:item.intent.expiresAt??null};const commitment=hashHex(publicPlan);item.preview={commitment,publicPlan,plan,createdAt:Date.now()};return{...publicPlan,previewCommitment:commitment}}
  reject(approvalId){return this.pending.delete(approvalId)}
  async approve(approvalId,expectedPreviewCommitment){const item=this.pending.get(approvalId);if(!item||!item.preview)throw new Error('Preview the exact transaction before approval');if(!expectedPreviewCommitment||expectedPreviewCommitment!==item.preview.commitment)throw new Error('Preview commitment mismatch; approval is not valid for this transaction plan');validateSendIntent(item.intent,{networkId:this.network,hrp:this.hrp,expectedFrom:this.wallet.address});const tx=signPlannedTransactionV2(item.preview.plan);if(typeof this.broadcastProvider!=='function')throw new Error('Signer broadcast provider is not configured');const result=await this.broadcastProvider(tx);this.pending.delete(approvalId);return{...result,txid:result?.txid??tx.txid,intentId:item.intent.intentId,from:this.wallet.address,to:item.intent.to,amount_atoms:item.amount.toString(),previewCommitment:item.preview.commitment,privateKeyExposed:false}}
}
