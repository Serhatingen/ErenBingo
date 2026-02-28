/* global io */

const qs = new URLSearchParams(location.search);
if (qs.get('debug') === '1') document.body.classList.add('debug-overlay');

window.__HOST_JS_LOADED__ = true;

document.addEventListener('DOMContentLoaded', () => {
  const socket = io();

  const createRoomBtn = document.getElementById('createRoomBtn');
  const newJoinPass = document.getElementById('newJoinPass');
  const newHostPass = document.getElementById('newHostPass');
  const createOut = document.getElementById('createOut');

  const connectBtn = document.getElementById('connectBtn');
  const roomIdEl = document.getElementById('roomId');
  const hostPassEl = document.getElementById('hostPass');
  const connectErr = document.getElementById('connectErr');

  const grid = document.getElementById('grid');
  const roomPill = document.getElementById('roomPill');
  const phasePill = document.getElementById('phasePill');
  const hint = document.getElementById('hint');

  const resetBtn = document.getElementById('resetBtn');
  const pendingBox = document.getElementById('pendingBox');
  const approveBtn = document.getElementById('approveBtn');
  const rejectBtn = document.getElementById('rejectBtn');
  const playersEl = document.getElementById('players');

  let state = null;

  function updateTop(){
    roomPill.textContent = `Oturum: ${state?.roomId || '—'}`;
    phasePill.textContent = `Durum: ${state?.phase || '—'}`;
  }

  function renderBoard(){
    if (!state) return;
    grid.innerHTML = '';

    for (const cell of state.board) {
      const btn = document.createElement('div');
      btn.className = 'cell ' + (cell.unlocked ? 'unlocked' : 'locked');
      btn.dataset.cellId = cell.id;

      const badge = document.createElement('div');
      badge.className = 'badge';
      badge.textContent = cell.unlocked ? 'AÇIK' : 'KAPALI';
      btn.appendChild(badge);

      const txt = document.createElement('div');
      txt.className = 'cell-text';
      txt.textContent = cell.label;
      btn.appendChild(txt);

      btn.addEventListener('click', (e) => {
        e.preventDefault();
        if (!state || state.phase === 'ended') return;
        socket.emit('hostUnlockCell', { cellId: cell.id, unlocked: !cell.unlocked }, (res) => {
          if (!res?.ok) hint.textContent = res?.error || 'İşlem başarısız.';
        });
      });

      grid.appendChild(btn);
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
      name.textContent = p.name;

      const score = document.createElement('div');
      score.className = 'score';
      const dot = p.isActive ? '●' : '○';
      score.textContent = `${dot} ${p.markedCount} kutu`;

      row.appendChild(name);
      row.appendChild(score);
      playersEl.appendChild(row);
    }
  }

  function renderPending(){
    if (!state) return;
    const title = pendingBox.querySelector('.pending-title');
    const sub = pendingBox.querySelector('.pending-sub');

    if (state.winner) {
      title.textContent = `Kazanan: ${state.winner.name} 🎉`;
      sub.textContent = 'Oyun bitmiş durumda.';
      approveBtn.disabled = true;
      rejectBtn.disabled = true;
      return;
    }

    if (!state.pendingWin) {
      title.textContent = 'Bekleyen kazanan: —';
      sub.textContent = 'Henüz kimse bingo iddiası yapmadı.';
      approveBtn.disabled = true;
      rejectBtn.disabled = true;
      return;
    }

    title.textContent = `Bekleyen kazanan: ${state.pendingWin.name}`;
    sub.textContent = `İddia satırı: ${(state.pendingWin.line || []).join(', ')}`;
    approveBtn.disabled = false;
    rejectBtn.disabled = false;
  }

  function renderStats(){
    const s = state?.stats;
    if (!s) { hint.textContent = ''; return; }
    hint.textContent = `Aktif: ${s.activePlayers}/${s.totalPlayers} — Eşik: ${s.requiredVotes} oy / ${Math.round((s.voteWindowMs||6000)/1000)}sn`;
  }

  function hydrate(){
    updateTop();
    renderBoard();
    renderPlayers();
    renderPending();
    renderStats();
    resetBtn.disabled = !state;
  }

  createRoomBtn?.addEventListener('click', async (e) => {
    e.preventDefault();
    createOut.textContent = '';

    const jp = (newJoinPass.value || '').trim();
    const hp = (newHostPass.value || '').trim();
    if (!jp || !hp) {
      createOut.textContent = 'İzleyici ve host şifresi gerekli.';
      return;
    }

    const res = await fetch('/api/create-room', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ joinPassword: jp, hostPassword: hp })
    });
    const data = await res.json();

    if (!data.ok) {
      createOut.textContent = data.error || 'Oluşturulamadı.';
      return;
    }

    const rid = data.roomId;
    createOut.innerHTML = `Oturum oluşturuldu: <b>${rid}</b><br/>İzleyici linki: <code>${location.origin}/?room=${rid}</code><br/>Host linki: <code>${location.origin}/host.html</code>`;
    roomIdEl.value = rid;
    hostPassEl.value = hp;
  });

  connectBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    connectErr.textContent = '';

    const rid = (roomIdEl.value || '').trim().toUpperCase();
    const hp = (hostPassEl.value || '').trim();
    if (!rid || !hp) {
      connectErr.textContent = 'Oturum kodu ve host şifresi gerekli.';
      return;
    }

    socket.emit('joinRoom', { roomId: rid, role: 'host', password: hp }, (res) => {
      if (!res?.ok) {
        connectErr.textContent = res?.error || 'Bağlanamadı.';
        return;
      }
      state = res.state;
      hydrate();
    });
  });

  approveBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    socket.emit('hostResolveWin', { decision: 'approve' }, (res) => {
      if (!res?.ok) hint.textContent = res?.error || 'Onay başarısız.';
    });
  });

  rejectBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    socket.emit('hostResolveWin', { decision: 'reject' }, (res) => {
      if (!res?.ok) hint.textContent = res?.error || 'Reddetme başarısız.';
    });
  });

  resetBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    socket.emit('hostResetGame', {}, (res) => {
      hint.textContent = res?.ok ? 'Oyun sıfırlandı.' : (res?.error || 'Reset başarısız.');
    });
  });

  // password eye toggle
  document.addEventListener('click', (e) => {
    const btn = e.target?.closest?.('.pw-eye');
    if (!btn) return;
    const targetId = btn.getAttribute('data-target');
    const inp = document.getElementById(targetId);
    if (!inp) return;
    inp.type = (inp.type === 'password') ? 'text' : 'password';
  });

  socket.on('state', (s) => {
    state = s;
    hydrate();
  });

  hydrate();
});
