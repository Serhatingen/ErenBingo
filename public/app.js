/* global io */

window.__APP_JS_LOADED__ = true;

const socket = io();
const qs = new URLSearchParams(location.search);
if (qs.get('debug') === '1') document.body.classList.add('debug-overlay');

const joinModal = document.getElementById('joinModal');
const roomIdEl = document.getElementById('roomId');
const joinPassEl = document.getElementById('joinPass');
const displayNameEl = document.getElementById('displayName');
const joinBtn = document.getElementById('joinBtn');
const joinError = document.getElementById('joinError');

const grid = document.getElementById('grid');
const roomPill = document.getElementById('roomPill');
const phasePill = document.getElementById('phasePill');
const bingoBtn = document.getElementById('bingoBtn');
const hint = document.getElementById('hint');
const statusRow = document.getElementById('statusRow');
const playersEl = document.getElementById('players');

const totalCountEl = document.getElementById('totalCount');
const activeCountEl = document.getElementById('activeCount');
const votersCountEl = document.getElementById('votersCount');
const firstVoterNameEl = document.getElementById('firstVoterName');

let state = null;
let me = { playerId: null, name: null };
let myMarks = new Set();
let cooldownUntil = 0;
let pendingVote = null; // {cellId, until}

function showJoinModal(show){
  joinModal.classList.toggle('show', !!show);
}

function msLeft(t){ return Math.max(0, t - Date.now()); }
function isInCooldown(){ return Date.now() < cooldownUntil; }

function computeDeviceSig(){
  try{
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    const hc = navigator.hardwareConcurrency || 0;
    const dm = navigator.deviceMemory || 0;
    const sw = (screen && screen.width) ? screen.width : 0;
    const sh = (screen && screen.height) ? screen.height : 0;
    const dpr = window.devicePixelRatio || 1;
    const lang = navigator.language || '';
    const langs = (navigator.languages || []).slice(0,3).join(',');
    return `${tz}|hc:${hc}|dm:${dm}|scr:${sw}x${sh}@${dpr}|lang:${lang}|langs:${langs}`;
  } catch {
    return 'unknown';
  }
}

function getOrCreatePlayerId(){
  const key = 'erenBingoPlayerId';
  let v = localStorage.getItem(key);
  if (!v) {
    v = crypto.getRandomValues(new Uint32Array(4)).join('-');
    localStorage.setItem(key, v);
  }
  return v;
}

function updateTop(){
  roomPill.textContent = `Oturum: ${state?.roomId || '—'}`;
  phasePill.textContent = `Durum: ${state?.phase || '—'}`;
}

function renderCounts(){
  const s = state?.stats;
  if (!s) return;
  if (totalCountEl) totalCountEl.textContent = String(s.totalPlayers ?? '—');
  if (activeCountEl) activeCountEl.textContent = String(s.activePlayers ?? '—');
  if (votersCountEl) votersCountEl.textContent = String(s.votersCount ?? '—');
  if (firstVoterNameEl) firstVoterNameEl.textContent = s.firstVoterName || '—';
}

function renderBoard(){
  if (!state) return;
  grid.innerHTML = '';
  for (const cell of state.board) {
    const el = document.createElement('div');
    el.className = 'cell ' + (cell.unlocked ? 'unlocked' : 'locked');
    el.dataset.cellId = cell.id;

    const badge = document.createElement('div');
    badge.className = 'badge';
    badge.textContent = cell.unlocked ? 'AÇIK' : 'KAPALI';
    el.appendChild(badge);

    const txt = document.createElement('div');
    txt.className = 'cell-text';
    txt.textContent = cell.label;
    el.appendChild(txt);

    if (myMarks.has(cell.id)) el.classList.add('marked');

    if (pendingVote && pendingVote.cellId === cell.id && !cell.unlocked) {
      el.classList.add('pending');
      badge.textContent = 'BEKLE';
    }

    el.addEventListener('click', () => onCellClick(cell));
    grid.appendChild(el);
  }
}

function renderPlayers(){
  if (!state) return;
  playersEl.innerHTML = '';
  const list = (state.players || []).slice(0, 30);
  if (!list.length) {
    playersEl.innerHTML = '<div class="player"><div class="name">Henüz kimse yok</div><div class="score">—</div></div>';
    return;
  }

  for (const p of list) {
    const row = document.createElement('div');
    row.className = 'player';

    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = p.name + (p.playerId === me.playerId ? ' (sen)' : '');

    const score = document.createElement('div');
    score.className = 'score';
    const dot = p.isActive ? '●' : '○';
    score.textContent = `${dot} ${p.markedCount} kutu`;

    row.appendChild(name);
    row.appendChild(score);
    playersEl.appendChild(row);
  }
}

function computeBingoPossible(){
  if (!state) return false;
  const unlocked = new Set(state.board.filter(c => c.unlocked).map(c => c.id));
  const has = (id) => myMarks.has(id);

  const lines = [
    ['c0','c1','c2','c3'],
    ['c4','c5','c6','c7'],
    ['c8','c9','c10','c11'],
    ['c12','c13','c14','c15'],
    ['c0','c4','c8','c12'],
    ['c1','c5','c9','c13'],
    ['c2','c6','c10','c14'],
    ['c3','c7','c11','c15'],
    ['c0','c5','c10','c15'],
    ['c3','c6','c9','c12'],
  ];

  return lines.some(line => line.every(id => unlocked.has(id) && has(id)));
}

function updateBingoButton(){
  if (!state) return;
  const possible = computeBingoPossible();
  const disabled = !(state.phase === 'running' && possible && !pendingVote && !isInCooldown());
  bingoBtn.disabled = disabled;

  if (isInCooldown()) {
    hint.textContent = `Lütfen bekleyiniz. (${Math.ceil(msLeft(cooldownUntil)/1000)}sn)`;
  } else if (pendingVote) {
    hint.textContent = 'Doğrulama bekleniyor…';
  } else {
    hint.textContent = possible ? 'Bingo çizgin hazır. “BINGO!” bas.' : 'Bingo için satır/sütun/çapraz tamamla.';
  }
}

function updateStatus(){
  if (!state) return;
  const unlockedCount = state.board.filter(c => c.unlocked).length;
  const s = state.stats || {};
  let msg = `Açık kutu sayısı: <b>${unlockedCount}</b> / 16. `;
  msg += `Katılımcı: <b>${s.totalPlayers ?? '—'}</b> (aktif: <b>${s.activePlayers ?? '—'}</b>).`;

  if (pendingVote && !isInCooldown()) {
    msg += `<br><b>Bekleyen seçim:</b> ${pendingVote.cellId} (${Math.ceil(msLeft(pendingVote.until)/1000)}sn)`;
  }
  if (state.pendingWin) msg += `<br><b>Bekleyen kazanan:</b> ${escapeHtml(state.pendingWin.name)} (host onayı bekleniyor).`;
  if (state.winner) msg += `<br><b>Kazanan:</b> ${escapeHtml(state.winner.name)} 🎉`;
  if (isInCooldown()) msg += `<br><b>Timeout:</b> ${Math.ceil(msLeft(cooldownUntil)/1000)}sn`;

  statusRow.innerHTML = msg;
}

function escapeHtml(s){
  return String(s || '').replace(/[&<>"']/g, (m) => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
  }[m]));
}

function onCellClick(cell){
  if (!state) return;

  if (state.phase !== 'running') {
    hint.textContent = 'Oyun kilitli (kazanan onayı / bitti).';
    return;
  }
  if (isInCooldown()) {
    hint.textContent = `Lütfen bekleyiniz. (${Math.ceil(msLeft(cooldownUntil)/1000)}sn)`;
    return;
  }

  if (!cell.unlocked) {
    // still supports server-side crowd validation (future model will change)
    pendingVote = { cellId: cell.id, until: Date.now() + (state.stats?.voteFailMs || 10_000) };
    renderBoard();
    updateBingoButton();

    socket.emit('toggleMark', { cellId: cell.id, marked: true }, (res) => {
      if (!res?.ok) {
        if (res?.cooldownMs) cooldownUntil = Date.now() + res.cooldownMs;
        hint.textContent = res?.error || 'İşaretleme başarısız.';
        pendingVote = null;
        renderBoard();
        updateBingoButton();
        return;
      }
      if (res.mode === 'pending') {
        pendingVote = { cellId: cell.id, until: res.until };
        hint.textContent = `Doğrulama: ${res.currentVotes}/${res.required} oy…`;
        renderBoard();
        updateBingoButton();
      }
    });

    return;
  }

  const next = !myMarks.has(cell.id);
  socket.emit('toggleMark', { cellId: cell.id, marked: next }, (res) => {
    if (!res?.ok) {
      if (res?.cooldownMs) cooldownUntil = Date.now() + res.cooldownMs;
      hint.textContent = res?.error || 'İşaretleme başarısız.';
    }
  });
}

bingoBtn.addEventListener('click', () => {
  if (isInCooldown() || pendingVote) return;
  bingoBtn.disabled = true;
  hint.textContent = 'Bingo iddiası gönderildi…';
  socket.emit('claimBingo', {}, (res) => {
    if (!res?.ok) {
      hint.textContent = res?.error || 'Bingo iddiası reddedildi.';
      updateBingoButton();
    } else {
      hint.textContent = 'Bingo beklemeye alındı. Host onaylarsa oyun biter.';
    }
  });
});

joinBtn.addEventListener('click', () => doJoin());

function doJoin(){
  joinError.textContent = '';

  const roomId = (roomIdEl.value || '').trim().toUpperCase();
  const pass = (joinPassEl.value || '').trim();
  const name = (displayNameEl.value || '').trim() || 'İzleyici';

  if (!roomId || !pass) {
    joinError.textContent = 'Oturum kodu ve şifre gerekli.';
    return;
  }

  me.playerId = getOrCreatePlayerId();
  me.name = name;

  socket.emit('joinRoom', {
    roomId,
    role: 'player',
    password: pass,
    playerId: me.playerId,
    name,
    deviceSig: computeDeviceSig()
  }, (res) => {
    if (!res?.ok) {
      joinError.textContent = res?.error || 'Bağlanamadı.';
      return;
    }

    state = res.state;
    myMarks = new Set(res.myMarks || []);
    pendingVote = null;
    cooldownUntil = 0;

    showJoinModal(false);
    hydrate();
    startHeartbeat();
  });
}

function hydrate(){
  updateTop();
  renderCounts();
  renderBoard();
  renderPlayers();
  updateStatus();
  updateBingoButton();
}

socket.on('syncMarks', (payload) => {
  if (!payload || payload.roomId !== state?.roomId) return;
  myMarks = new Set(payload.marks || []);
  renderBoard();
  updateBingoButton();
});

socket.on('state', (s) => {
  state = s;

  // clear pending vote if unlocked or timed out
  if (pendingVote) {
    const cell = state.board.find(c => c.id === pendingVote.cellId);
    if (cell && cell.unlocked) pendingVote = null;
    if (pendingVote && Date.now() > pendingVote.until) pendingVote = null;
  }

  hydrate();
});

socket.on('notice', (n) => {
  if (!n) return;
  if (n.type === 'cooldown') {
    cooldownUntil = Date.now() + (n.cooldownMs || 10_000);
    pendingVote = null;
    hint.textContent = n.message || 'Lütfen bekleyiniz.';
  }
  updateStatus();
  updateBingoButton();
  renderBoard();
});

let hbTimer = null;
function startHeartbeat(){
  if (hbTimer) clearInterval(hbTimer);
  hbTimer = setInterval(() => {
    socket.emit('heartbeat', {});
    if (pendingVote && Date.now() > pendingVote.until) {
      pendingVote = null;
      renderBoard();
      updateBingoButton();
    }
    updateStatus();
  }, 5000);
}

// password eye toggle
document.addEventListener('click', (e) => {
  const btn = e.target?.closest?.('.pw-eye');
  if (!btn) return;
  const targetId = btn.getAttribute('data-target');
  const inp = document.getElementById(targetId);
  if (!inp) return;
  inp.type = (inp.type === 'password') ? 'text' : 'password';
});

// prefill room from URL
roomIdEl.value = (qs.get('room') || '').toUpperCase();
displayNameEl.value = localStorage.getItem('erenBingoDisplayName') || '';
displayNameEl.addEventListener('input', () => localStorage.setItem('erenBingoDisplayName', displayNameEl.value));

// Ensure join modal visible at start
showJoinModal(true);
