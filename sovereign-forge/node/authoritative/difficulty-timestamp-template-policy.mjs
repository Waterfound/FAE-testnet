import {MTP_WINDOW,FUTURE_DRIFT_MS,medianTimePast,validateCandidateTimestamp} from './difficulty-timestamp-candidate.mjs';

export const TIMESTAMP_TEMPLATE_POLICY_STATUS='activation-plumbing-candidate-not-consensus';
export const CLOCK_SKEW_BUDGET_MS=30_000;
export const RELAY_DELAY_BUDGET_MS=5_000;

function safeInt(value,label){const n=Number(value);if(!Number.isSafeInteger(n))throw new Error(`${label}_must_be_safe_integer`);return n}

export function minimumCandidateTemplateTimestamp(chain,{nowMs=Date.now(),window=MTP_WINDOW}={}){
  if(!Array.isArray(chain))throw new Error('chain_required');
  const now=safeInt(nowMs,'now_ms');if(now<0)throw new Error('negative_now_ms');
  const previous=chain.at(-1)||null,mtp=medianTimePast(chain,{window});
  return Math.max(now,previous?safeInt(previous.timestamp_ms,'previous_timestamp_ms'):0,mtp===null?0:mtp+1);
}

export function buildCandidateTemplateTimestamp(chain,{nowMs=Date.now(),window=MTP_WINDOW,futureDriftMs=FUTURE_DRIFT_MS}={}){
  const timestampMs=minimumCandidateTemplateTimestamp(chain,{nowMs,window});
  const validation=validateCandidateTimestamp(chain,timestampMs,{nowMs,window,futureDriftMs});
  if(!validation.ok)throw Object.assign(new Error(validation.error),{code:validation.error,validation});
  return{status:TIMESTAMP_TEMPLATE_POLICY_STATUS,timestamp_ms:timestampMs,validation};
}

export function honestClockPairAccepted({producerSkewMs,receiverSkewMs,relayDelayMs=0,futureDriftMs=FUTURE_DRIFT_MS}={}){
  const producer=safeInt(producerSkewMs,'producer_skew_ms'),receiver=safeInt(receiverSkewMs,'receiver_skew_ms'),relay=safeInt(relayDelayMs,'relay_delay_ms'),drift=safeInt(futureDriftMs,'future_drift_ms');
  if(relay<0||drift<0)throw new Error('negative_clock_budget');
  // Use true time T=0. An honest producer stamps its local current time. The
  // receiver validates after relay delay using its own local current time.
  const headerTimestamp=producer;
  const receiverNow=relay+receiver;
  return headerTimestamp<=receiverNow+drift;
}

export function guaranteedClockSkewBudget({clockSkewBudgetMs=CLOCK_SKEW_BUDGET_MS,relayDelayBudgetMs=RELAY_DELAY_BUDGET_MS,futureDriftMs=FUTURE_DRIFT_MS}={}){
  const skew=safeInt(clockSkewBudgetMs,'clock_skew_budget_ms'),relay=safeInt(relayDelayBudgetMs,'relay_delay_budget_ms'),drift=safeInt(futureDriftMs,'future_drift_ms');
  if(skew<0||relay<0||drift<0)throw new Error('negative_clock_budget');
  // Worst honest pair is producer +skew, receiver -skew. Relay delay helps the
  // receiver's wall clock advance before validation.
  const worstFutureLead=Math.max(0,2*skew-relay);
  return{ok:worstFutureLead<=drift,worst_future_lead_ms:worstFutureLead,headroom_ms:drift-worstFutureLead};
}
