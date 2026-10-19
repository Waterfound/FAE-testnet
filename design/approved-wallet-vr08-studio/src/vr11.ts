import './styles.css';

type Screen = 'active' | 'empty' | 'create' | 'recovery';
type Status = 'pending' | 'confirmed' | 'failed' | 'unknown';
type Transaction = { id: string; direction: 'Sent' | 'Received'; amount: string; status: Status; block?: string };
type Address = { display: string; amount: string; transactions: Transaction[] };
type Wallet = { id: string; fallback: string; nickname: string; addresses: Address[] };

const demoData: Wallet[] = [
  { id: 'w01', fallback: 'Wallet 01', nickname: '', addresses: [
    { display: 'faet1…k72m', amount: '2,184.72', transactions: [
      { id: 'a', direction: 'Received', amount: '+18.00 FAE', status: 'confirmed', block: '184,197' },
      { id: 'b', direction: 'Sent', amount: '−10.00 FAE', status: 'pending' },
      { id: 'c', direction: 'Sent', amount: '−4.25 FAE', status: 'failed' }
    ] },
    { display: 'faet1…n18r', amount: '0.00', transactions: [] }
  ] },
  { id: 'w02', fallback: 'Wallet 02', nickname: '', addresses: [
    { display: 'faet1…p91q', amount: '450.00', transactions: [
      { id: 'd', direction: 'Received', amount: '+250.00 FAE', status: 'confirmed', block: '184,180' },
      { id: 'e', direction: 'Received', amount: '+200.00 FAE', status: 'confirmed', block: '184,111' }
    ] },
    { display: 'faet1…h24b', amount: '3.00', transactions: [
      { id: 'f', direction: 'Received', amount: '+3.00 FAE', status: 'confirmed', block: '184,100' }
    ] }
  ] },
  { id: 'w03', fallback: 'Wallet 03', nickname: '', addresses: [
    { display: 'faet1…s69v', amount: '0.00', transactions: [] },
    { display: 'faet1…c83d', amount: '6.00', transactions: [
      { id: 'g', direction: 'Received', amount: '+6.00 FAE', status: 'confirmed', block: '183,991' }
    ] }
  ] }
];

let wallets = demoData.map(clone);
let activeId = 'w01';
const activeAddressIndices: Record<string, number> = { w01: 0, w02: 0, w03: 0 };
let expanded = false;
let adding = false;
let settingsId: string | null = null;
let selectedTxId: string | null = 'a';
let view: Screen = 'active';
let pendingRemove = false;
let fakeIndex = 100;

let lastSettingsTrigger: HTMLButtonElement | null = null;

const $ = (id: string) => document.getElementById(id);
const n = (tag: string, klass: string, content?: string) => {
  const e = document.createElement(tag);
  e.className = klass;
  if (content !== undefined) e.textContent = content;
  return e;
};
function b(klass: string, content: string, cb: () => void) {
  const e = n('button', klass, content) as HTMLButtonElement;
  e.type = 'button';
  e.addEventListener('click', cb);
  return e;
}
function clone(w: Wallet): Wallet {
  return { ...w, addresses: w.addresses.map(a => ({
    ...a, transactions: a.transactions.map(tx => ({ ...tx }))
  })) };
}
function activeWallet() { return wallets.find(w => w.id === activeId); }
function walletName(w: Wallet) { return w.nickname || w.fallback; }
function addressIndex(w: Wallet) { return activeAddressIndices[w.id] || 0; }
function addressFor(w: Wallet) { return w.addresses[addressIndex(w)] || w.addresses[0]; }
function activeTransactions() { const w = activeWallet(); return w ? addressFor(w).transactions : []; }
function currentTx() { return activeTransactions().find(tx => tx.id === selectedTxId); }
function notice(s: string) {
  const e = $('eventLine');
  if (e) { e.textContent = s; e.classList.add('visible'); }
}
function clearNotice() {
  const e = $('eventLine');
  if (e) { e.textContent = ''; e.classList.remove('visible'); }
}
function closeAction() { const e = $('actionDetail'); if (e) e.hidden = true; }

function show(screen: Screen) {
  view = screen;
  document.querySelectorAll<HTMLElement>('[data-screen]').forEach(e => {
    e.hidden = e.dataset.screen !== screen;
  });
  const sub = $('stageDescription');
  if (sub) sub.textContent = screen === 'active' ? 'Your keys remain yours.' :
    screen === 'recovery' ? 'Return to what is yours.' : 'Begin on your device.';
  document.title = 'FAE Wallet · ' + screen + ' / VR-11';
  closeAction();
  clearNotice();
}
function studioMenu() {
  const wrap = document.querySelector<HTMLElement>('.preview-control');
  if (!wrap) return;
  wrap.innerHTML = '';
  let open = false;
  const btn = b('studio-trigger', 'Studio ▾', () => {
    open = !open;
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
  });
  btn.id = 'studioToggle';
  btn.setAttribute('aria-expanded', 'false');
  const menu = n('div', 'studio-list');
  menu.hidden = true; menu.id = 'studioMenu';
  menu.append(n('b', '', 'ILLUSTRATIVE SCENARIOS'));
  const entries: [string, () => void][] = [
    ['Existing wallets', () => { if (!wallets.length) reset(); show('active'); paint(); }],
    ['No wallets yet', () => show('empty')],
    ['10 pending transfers', simulateTen],
    ['Confirm selected transfer', () => updateTx('confirmed')],
    ['Fail selected transfer', () => updateTx('failed')],
    ['Unknown status example', () => updateTx('unknown')],
    ['Restore 3 examples', () => { reset(); show('active'); paint(); }]
  ];
  for (const [label, cb] of entries) {
    menu.append(b('', label, () => { open = false; menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); cb(); }));
  }
  wrap.append(btn, menu);
}
function reset() {
  wallets = demoData.map(clone);
  for (const id of Object.keys(activeAddressIndices)) delete activeAddressIndices[id];
  for (const w of wallets) activeAddressIndices[w.id] = 0;
  activeId = 'w01'; selectedTxId = 'a'; expanded = false; adding = false; settingsId = null;
}
function chooseWallet(id: string) {
  const w = wallets.find(x => x.id === id);
  if (!w) return;
  activeId = id;
  expanded = false; adding = false;
  selectedTxId = addressFor(w).transactions[0]?.id || null;
  paint();
  notice(walletName(w) + ' selected.');
}
function selectAddress(index: number) {
  const w = activeWallet();
  if (!w || index < 0 || index >= w.addresses.length) return;
  activeAddressIndices[w.id] = index;
  selectedTxId = w.addresses[index].transactions[0]?.id || null;
  paint();
  showReceive();
  notice('Address ' + String(index + 1).padStart(2, '0') + ' selected. The displayed balance is for this address.');
}
function addWalletExample() {
  const idx = ++fakeIndex;
  const wallet: Wallet = {
    id: 'example-' + idx, fallback: 'Wallet ' + String(wallets.length + 1).padStart(2, '0'),
    nickname: '', addresses: [{ display: 'faet1…e' + idx + 'x', amount: '0.00', transactions: [] }]
  };
  wallets.push(wallet); activeAddressIndices[wallet.id] = 0;
  chooseWallet(wallet.id);
  notice('Example wallet added. No keys or passphrase were generated.');
}
function renderRail() {
  const rail = document.querySelector<HTMLElement>('.wallet-rail');
  const w = activeWallet();
  if (!rail || !w) return;
  rail.innerHTML = '';
  const head = n('div', 'rail-heading');
  head.append(n('span', '', 'YOUR WALLET'));
  const settings = b('settings-top', '···', () => openSettings(w.id, settings));
  settings.setAttribute('aria-label', 'Settings for ' + walletName(w));
  head.append(settings); rail.append(head);
  const selector = b('active-selector', '', () => { expanded = !expanded; adding = false; renderRail(); });
  selector.id = 'walletSelector';
  selector.setAttribute('aria-expanded', String(expanded));
  selector.setAttribute('aria-label', 'Switch wallets');
  const label = n('span', '');
  label.append(n('strong', '', walletName(w)), n('small', '', addressFor(w).display));
  selector.append(label, n('span', 'selector-arrow', expanded ? '⌃' : '⌄'));
  rail.append(selector);
  if (expanded) {
    const drawer = n('div', 'wallet-drawer');
    drawer.id = 'walletDrawer';
    for (const item of wallets) {
      const row = n('div', 'wallet-list-item' + (item.id === activeId ? ' is-active' : ''));
      const choose = b('wallet-select', '', () => chooseWallet(item.id));
      choose.append(n('span', 'wallet-row-name', walletName(item)), n('span', 'wallet-id', item.addresses[0].display));
      choose.setAttribute('aria-label', 'Select ' + walletName(item));
      const rowSettings = b('row-settings', '···', () => openSettings(item.id, rowSettings));
      rowSettings.setAttribute('aria-label', 'Settings for ' + walletName(item));
      row.append(choose, rowSettings); drawer.append(row);
    }
    const add = b('add-toggle', '＋ Add wallet', () => { adding = !adding; renderRail(); });
    add.setAttribute('aria-expanded', String(adding)); drawer.append(add);
    if (adding) {
      const choices = n('div', 'add-choices');
      choices.append(
        b('', 'New Wallet', () => { expanded = false; show('create'); }),
        b('', 'Recovery Wallet', () => { expanded = false; show('recovery'); }),
        b('demo-choice', 'Add example wallet · Studio', addWalletExample)
      ); drawer.append(choices);
    }
    rail.append(drawer);
  }
  const foot = n('div', 'rail-footer');
  foot.append(n('span', '', wallets.length + ' wallet' + (wallets.length === 1 ? '' : 's') + ' on this device'));
  rail.append(foot);
}
function paint() {
  const w = activeWallet();
  if (!w) { show('empty'); return; }
  const a = addressFor(w);
  const title = document.querySelector('.balance-upper .eyebrow');
  if (title) title.textContent = walletName(w).toUpperCase() + ' / WALLET';
  const balanceLabel = document.querySelector('.balance-label');
  if (balanceLabel) balanceLabel.textContent = 'Selected address balance';
  const balance = document.querySelector('.balance-value strong');
  if (balance) balance.textContent = a.amount;
  const subtitle = document.querySelector('.balance-sub');
  if (subtitle) subtitle.textContent = 'Address ' + String(addressIndex(w) + 1).padStart(2, '0') + ' · sample data, not live';
  const status = document.querySelector('.micro-status');
  if (status) status.textContent = String(wallets.indexOf(w) + 1).padStart(2, '0') + ' · SELECTED';
  renderRail(); paintTransactions(); closeAction();
}
function tone(tx: Transaction): string {
  if (tx.status === 'failed') return 'failed';
  if (tx.status === 'unknown') return 'unknown';
  if (tx.status === 'pending') return 'pending';
  return tx.direction === 'Received' ? 'received' : 'sent';
}
function transactionLine(tx: Transaction, onChoose: () => void, number: string, isSelected = false): HTMLButtonElement {
  const visual = tone(tx);
  const row = b('activity-row tx-row' + (isSelected ? ' chosen' : ''), '', onChoose);
  row.setAttribute('aria-pressed', String(isSelected));
  row.setAttribute('aria-label', tx.direction + ' ' + tx.amount + ', ' + statusLabel(tx));
  const rank = n('span', 'number', number);
  const description = n('span', 'activity-title');
  description.append(
    n('b', 'tx-direction tx-tone-' + visual, tx.direction),
    n('small', 'tx-state tx-tone-' + tx.status, statusLabel(tx))
  );
  row.append(
    rank,
    description,
    n('strong', 'tx-value tx-tone-' + visual, tx.amount),
    n('span', 'arrow', '↗')
  );
  return row;
}
type WalletHistoryItem = { tx: Transaction; addressNo: number; address: string };
function allWalletTransactions(): WalletHistoryItem[] {
  const wallet = activeWallet();
  if (!wallet) return [];
  return wallet.addresses.flatMap((a, i) =>
    a.transactions.map(tx => ({ tx, addressNo: i, address: a.display }))
  );
}
let historyFilter: Status | 'all' = 'all';
let historyTrigger: HTMLButtonElement | null = null;
function dismissAllTransactions(): void {
  $('fullHistoryOverlay')?.remove();
  historyTrigger?.focus();
  historyTrigger = null;
}
function openAllTransactions(trigger: HTMLButtonElement): void {
  historyTrigger = trigger;
  historyFilter = 'all';
  renderAllTransactions();
}
function renderAllTransactions(): void {
  const wallet = activeWallet();
  if (!wallet) { dismissAllTransactions(); return; }
  let overlay = $('fullHistoryOverlay');
  if (!overlay) {
    overlay = n('div', 'history-overlay');
    overlay.id = 'fullHistoryOverlay';
    overlay.addEventListener('click', event => {
      if (event.target === overlay) dismissAllTransactions();
    });
    document.body.append(overlay);
  }
  overlay.innerHTML = '';
  const sheet = n('section', 'history-sheet');
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-labelledby', 'fullHistoryTitle');
  const heading = n('div', 'history-top');
  const headingLeft = n('div', '');
  headingLeft.append(n('span', 'eyebrow', walletName(wallet).toUpperCase() + ' / WALLET HISTORY'));
  const title = n('h2', 'history-title', 'All transactions');
  title.id = 'fullHistoryTitle';
  headingLeft.append(title, n('p', 'history-scope', 'Every example address in this wallet · no live history'));
  const close = b('history-close', '×', dismissAllTransactions);
  close.setAttribute('aria-label', 'Close all transactions');
  heading.append(headingLeft, close);
  sheet.append(heading);
  const controls = n('div', 'history-controls');
  const options: [Status|'all', string][] = [
    ['all', 'All'], ['pending', 'Pending'], ['confirmed', 'Confirmed'],
    ['failed', 'Failed'], ['unknown', 'Unknown']
  ];
  for (const [value, label] of options) {
    const control = b('history-filter' + (historyFilter === value ? ' active' : ''), label, () => {
      historyFilter = value;
      renderAllTransactions();
    });
    control.setAttribute('aria-pressed', String(historyFilter === value));
    controls.append(control);
  }
  sheet.append(controls);
  const records = allWalletTransactions();
  const shown = records.filter(item => historyFilter === 'all' || item.tx.status === historyFilter);
  const count = n('div', 'history-count', shown.length + ' of ' + records.length + ' sample transactions');
  sheet.append(count);
  const table = n('div', 'history-records');
  for (let i = 0; i < shown.length; i++) {
    const item = shown[i];
    const visual = tone(item.tx);
    const row = b('history-entry', '', () => {
      const thisWallet = activeWallet();
      if (!thisWallet) return;
      dismissAllTransactions();
      activeAddressIndices[thisWallet.id] = item.addressNo;
      selectedTxId = item.tx.id;
      paint();
      const listing = document.querySelector('.activity-list');
      listing?.scrollIntoView({ behavior: 'auto', block: 'center' });
      notice(item.tx.direction + ' ' + item.tx.amount + ' · ' + statusLabel(item.tx));
    });
    row.setAttribute('aria-label', item.tx.direction + ' ' + item.tx.amount +
      ', ' + labelStatus(item.tx.status) + ', address ' + (item.addressNo + 1));
    const number = n('span', 'history-number', String(i + 1).padStart(2, '0'));
    const identity = n('span', 'history-identity');
    identity.append(
      n('b', 'tx-tone-' + visual, item.tx.direction),
      n('small', '', 'Address ' + String(item.addressNo + 1).padStart(2, '0') + ' · ' + item.address)
    );
    const state = n('span', 'history-state tx-tone-' + item.tx.status);
    state.append(n('span', 'history-status-dot'), n('span', '', labelStatus(item.tx.status)));
    const amount = n('strong', 'history-amount tx-tone-' + visual, item.tx.amount);
    row.append(number, identity, state, amount, n('span', 'history-arrow', '↗'));
    table.append(row);
  }
  if (!shown.length) table.append(n('p', 'history-empty', 'No example transactions with this status.'));
  sheet.append(table);
  sheet.append(n('p', 'history-foot', 'Illustrative entries only. A confirmed state requires chain evidence; a timeout alone cannot prove failure.'));
  overlay.append(sheet);
  (sheet.querySelector('.history-filter.active') as HTMLButtonElement | null)?.focus();
}
function paintTransactions() {
  const strip = document.querySelector<HTMLElement>('.flow-strip');
  const history = document.querySelector<HTMLElement>('.activity-list');
  if (!strip || !history) return;
  strip.innerHTML = '';
  history.innerHTML = '';
  const header = n('div', 'list-head');
  const title = n('div', '');
  title.append(n('h2', '', 'Transactions'), n('small', 'list-scope', 'Selected address · recent'));
  const open = b('text-button history-open', 'All transactions →', () => openAllTransactions(open));
  open.setAttribute('aria-label', 'All transactions for ' + walletName(activeWallet()!));
  header.append(title, open);
  history.append(header);
  const records = activeTransactions();
  for (let i = 0; i < records.length; i++) {
    const tx = records[i];
    const marker = b('flow-mark status-' + tx.status + (tx.id === selectedTxId ? ' chosen' : ''), '', () => selectTx(tx.id));
    marker.dataset.status = tx.status;
    marker.setAttribute('aria-label', tx.direction + ' ' + tx.amount + ', ' + labelStatus(tx.status));
    marker.setAttribute('aria-pressed', String(tx.id === selectedTxId));
    marker.append(n('span', 'flow-inner'));
    strip.append(marker);
    if (i < 3) {
      const row = transactionLine(tx, () => selectTx(tx.id), String(i + 1).padStart(2, '0'), tx.id === selectedTxId);
      history.append(row);
    }
  }
  if (!records.length) {
    history.append(n('p', 'context-note', 'No transactions for this address.'));
  }
  const count = document.querySelector('.flow-foot span:first-child');
  if (count) count.textContent = records.length + ' sample ' + (records.length === 1 ? 'transaction' : 'transactions');
  const selected = currentTx();
  const caption = $('flowCaption');
  if (caption) caption.textContent = selected
    ? selected.direction + ' · ' + selected.amount + ' · ' + labelStatus(selected.status)
    : 'No movement';
  caption?.setAttribute('class', 'movement-caption ' + (selected ? 'tx-tone-' + tone(selected) : ''));
}
function labelStatus(s: Status) {
  return ({ pending:'Pending', confirmed:'Confirmed', failed:'Failed', unknown:'Unknown' } as const)[s];
}
function statusLabel(tx: Transaction) {
  return labelStatus(tx.status) + (tx.status === 'confirmed' && tx.block ? ' · block ' + tx.block : ' · illustration');
}
function selectTx(id: string) {
  selectedTxId = id;
  paintTransactions();
  const tx = currentTx();
  if (tx) notice(tx.direction + ' ' + tx.amount + ' · ' + statusLabel(tx));
}
function updateTx(status: Status) {
  const tx = currentTx();
  if (!tx) { notice('Select a transaction first.'); return; }
  if (tx.status === 'confirmed' && status !== 'confirmed') {
    notice('Confirmed transfer cannot be reclassified without explicit chain-reorganization evidence.');
    return;
  }
  if (tx.status === 'failed' && status !== 'failed') {
    notice('Failed transfer cannot become confirmed without a new authoritative reconciliation.');
    return;
  }
  // Studio-only simulated lifecycle events; a timeout alone must never be classified as failure.
  tx.status = status;
  if (status === 'confirmed') tx.block = '184,222'; else delete tx.block;
  paintTransactions();
  notice('Studio-only status example: ' + tx.direction + ' ' + tx.amount + ' · ' + labelStatus(status) + '.');
}
function simulateTen() {
  const w = activeWallet();
  if (!w) { show('active'); return; }
  const a = addressFor(w);
  a.transactions = Array.from({ length: 10 }, (_, i) => ({
    id: 'pending-' + (++fakeIndex),
    direction: 'Sent' as const,
    amount: '−10.00 FAE', status: 'pending' as const
  }));
  selectedTxId = a.transactions[0].id;
  paintTransactions();
  notice('10 simulated pending transfers. None are real or confirmed.');
}
function showReceive() {
  const w = activeWallet();
  const panel = $('actionDetail'), title = $('actionEyebrow'), content = $('actionContent');
  if (!w || !panel || !title || !content) return;
  panel.hidden = false; title.textContent = 'RECEIVE / ' + walletName(w).toUpperCase();
  content.innerHTML = '';
  const body = n('div', 'receive-detail');
  body.append(n('strong', '', 'Receive FAE'));
  const description = n('p', '', 'This wallet has ' + w.addresses.length + ' example addresses. Balance and history above belong to the selected address, not the whole wallet.');
  body.append(description);
  const options = n('div', 'receive-address-options');
  w.addresses.forEach((a, index) => {
    const isActive = index === addressIndex(w);
    const button = b('receive-address' + (isActive ? ' selected' : ''), '', () => selectAddress(index));
    button.append(n('span', 'receive-address-no', String(index + 1).padStart(2, '0')),
      n('span', 'receive-address-text', a.display),
      n('span', 'receive-address-balance', a.amount + ' FAE'));
    button.setAttribute('aria-pressed', String(isActive));
    options.append(button);
  });
  body.append(options, n('p', 'context-note', 'Addresses are deliberately masked; copying is disabled in this Studio.'));
  content.append(body);
}
function showSend() {
  const w = activeWallet();
  const panel = $('actionDetail'), title = $('actionEyebrow'), content = $('actionContent');
  if (!w || !panel || !title || !content) return;
  panel.hidden = false; title.textContent = 'SEND / ' + walletName(w).toUpperCase();
  content.innerHTML = '';
  const body = n('div', '');
  body.append(n('strong', '', 'Send from address ' + String(addressIndex(w) + 1).padStart(2,'0')));
  body.append(n('p', '', 'Before a real send: recipient, spendable amount, fee, active wallet and address must be reviewed. This Studio does not accept inputs, sign or broadcast.'));
  content.append(body, n('div', 'detail-side', 'NO BROADCAST · VISUAL EXAMPLE'));
}
function closeSettings() {
  const overlay = $('walletSettingsOverlay');
  if (overlay) { overlay.hidden = true; overlay.remove(); }
  settingsId = null; pendingRemove = false;
  lastSettingsTrigger?.focus();
}
function openSettings(id: string, trigger: HTMLButtonElement) {
  const w = wallets.find(x => x.id === id);
  if (!w) return;
  lastSettingsTrigger = trigger; settingsId = id; pendingRemove = false;
  drawSettings();
}
function drawSettings() {
  const w = wallets.find(x => x.id === settingsId);
  if (!w) { closeSettings(); return; }
  let overlay = $('walletSettingsOverlay');
  if (!overlay) {
    overlay = n('div','settings-overlay');overlay.id='walletSettingsOverlay';
    overlay.addEventListener('click', event => { if (event.target === overlay) closeSettings(); });
    document.body.append(overlay);
  }
  overlay.hidden = false;
  overlay.innerHTML = '';
  const dialog = n('section','settings-dialog');
  dialog.setAttribute('role','dialog');
  dialog.setAttribute('aria-modal','true');
  dialog.setAttribute('aria-labelledby','settingsHeading');
  const head = n('div','settings-dialog-head');
  head.append(n('span','eyebrow','WALLET SETTINGS'),b('settings-dismiss','×',closeSettings));
  dialog.append(head,n('h2','settings-dialog-title','Settings'));
  const which = n('p','settings-wallet-name',walletName(w));which.id='settingsHeading';dialog.append(which);
  dialog.append(n('div','settings-wallet-address',w.addresses[0].display));
  const label = n('label','settings-label','Nickname (optional)') as HTMLLabelElement;
  label.htmlFor='settingsNickname';
  dialog.append(label);
  const input = n('input','settings-nickname') as HTMLInputElement;
  input.id='settingsNickname';input.value=w.nickname;input.maxLength=32;
  input.placeholder='e.g. Daily';input.autocomplete='off';
  dialog.append(input);
  dialog.append(b('settings-save','Save nickname',()=>{
    const s=input.value.trim();
    w.nickname=s;
    paint();
    closeSettings();
    notice(s ? 'Nickname saved: '+s : 'Nickname cleared; neutral wallet name restored.');
  }));
  dialog.append(n('div','settings-divider'));
  dialog.append(b('settings-remove','Remove wallet',()=>{pendingRemove=true;drawSettings();}));
  if (pendingRemove) {
    const confirm = n('div','settings-confirm');
    confirm.append(n('p','', 'Remove '+walletName(w)+' from this device? Verify your recovery backup first. This Studio only removes an example.'));
    confirm.append(b('settings-confirm-yes','Remove example',()=>removeWallet(w.id)),
      b('settings-confirm-no','Cancel',()=>{pendingRemove=false;drawSettings();}));
    dialog.append(confirm);
  }
  dialog.append(n('p','settings-footnote','These changes affect only this example session. Keys and actual wallets remain untouched.'));
  overlay.append(dialog);
  // This is a real visible modal; focus is moved to the dialog rather than below the fold.
  (pendingRemove ? dialog.querySelector<HTMLButtonElement>('.settings-confirm-no') : input)?.focus();
}
function removeWallet(id: string) {
  const w = wallets.find(x => x.id === id);
  if (!w) return;
  wallets = wallets.filter(x => x.id !== id);
  if (activeId === id && wallets.length) activeId = wallets[0].id;
  closeSettings();
  if (!wallets.length) { expanded = false; show('empty'); notice('No wallets remain.'); return; }
  selectedTxId = activeTransactions()[0]?.id || null;
  expanded = false;
  paint();
  notice(walletName(w) + ' removed from this example.');
}
function addWordGrid() {
  const grid = $('wordGrid');
  if (!grid) return;
  grid.innerHTML = '';
  for (let i = 1; i <= 24; i++) {
    const group = n('div','word-position');
    group.setAttribute('aria-label','Empty recovery word position ' + i);
    group.append(n('span','word-index', String(i).padStart(2,'0')),n('span','word-space'));
    grid.append(group);
  }
}
function bootstrap() {
  studioMenu();
  addWordGrid();
  const footer = document.querySelector('.foot strong');
  if (footer) footer.textContent = 'VR-11 / ART DIRECTION REVIEW';
  const empty = document.querySelector('.empty-bottom span');
  if (empty) empty.textContent = 'No wallets yet.';
  $('startNew')?.addEventListener('click', () => show('create'));
  $('startRecovery')?.addEventListener('click', () => show('recovery'));
  document.querySelector('[data-back]')?.addEventListener('click', () => show(wallets.length ? 'active':'empty'));
  document.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.action === 'receive') showReceive();
      else showSend();
    });
  });
  $('dismissAction')?.addEventListener('click', () => {closeAction();clearNotice();});
  const passphraseToggle = $('passphraseToggle') as HTMLButtonElement | null;
  const note = $('passphraseNote');
  passphraseToggle?.addEventListener('click', () => {
    if (!note) return;
    const expand = note.hidden;
    note.hidden = !expand;
    passphraseToggle.setAttribute('aria-expanded',String(expand));
    passphraseToggle.textContent = expand ? 'Optional −' : 'Optional ＋';
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && $('fullHistoryOverlay')) dismissAllTransactions();
    else if (event.key === 'Escape' && $('walletSettingsOverlay')) closeSettings();
  });
  show('active');paint();
}
bootstrap();
