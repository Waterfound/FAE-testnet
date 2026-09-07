'use strict';

// Canonical FAE network-status state machine.
// The status is connectivity-derived; it is never a static marketing claim.
window.FAENetworkStatus=(()=>{
  const LABELS=Object.freeze({
    connecting:'Connecting…',
    online:'Network online',
    offline:'Network offline'
  });

  function set(state){
    if(!Object.prototype.hasOwnProperty.call(LABELS,state))throw Error('invalid FAE network status');
    const root=document.getElementById('netstatus');
    if(!root)return state;
    root.dataset.state=state;
    root.setAttribute('role','status');
    root.setAttribute('aria-live','polite');
    root.classList.toggle('is-connecting',state==='connecting');
    root.classList.toggle('is-online',state==='online');
    root.classList.toggle('is-offline',state==='offline');
    const label=root.querySelector('[data-network-label]')||root.lastElementChild;
    if(label)label.textContent=LABELS[state];
    return state;
  }

  return Object.freeze({
    LABELS,
    set,
    connecting:()=>set('connecting'),
    online:()=>set('online'),
    offline:()=>set('offline')
  });
})();
