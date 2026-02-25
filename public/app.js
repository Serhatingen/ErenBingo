/* global io */
const socket = io();

const qs = new URLSearchParams(location.search);
const joinModal = document.getElementById("joinModal");
const roomIdEl = document.getElementById("roomId");
const joinPassEl = document.getElementById("joinPass");
const displayNameEl = document.getElementById("displayName");
const joinBtn = document.getElementById("joinBtn");
const joinError = document.getElementById("joinError");

const grid = document.getElementById("grid");
const roomPill = document.getElementById("roomPill");
const phasePill = document.getElementById("phasePill");
const bingoBtn = document.getElementById("bingoBtn");
const hint = document.getElementById("hint");
const statusRow = document.getElementById("statusRow");
const playersEl = document.getElementById("players");

let state = null;
let me = { playerId: null, name: null };
let myMarks = new Set();
let pendingVote = null; // { cellId, until }
let cooldownUntil = 0;

let audioArmed = false;
let audioEnabled = true;

function getOrCreatePlayerId(){
  const key = "erenBingoPlayerId";
  let v = localStorage.getItem(key);
  if (!v) {
    v = crypto.getRandomValues(new Uint32Array(4)).join("-");
    localStorage.setItem(key, v);
  }
  return v;
}

function showJoinModal(show){
  joinModal.classList.toggle("show", !!show);
}

function isInCooldown(){
  return Date.now() < cooldownUntil;
}
function msLeft(t){
  return Math.max(0, t - Date.now());
}

function renderBoard(){
  if (!state) return;
  grid.innerHTML = "";

  for (const cell of state.board) {
    const btn = document.createElement("div");
    btn.className = "cell " + (cell.unlocked ? "unlocked" : "locked");
    btn.dataset.cellId = cell.id;

    const badge = document.createElement("div");
    badge.className = "badge";
    badge.textContent = cell.unlocked ? "AÇIK" : "KAPALI";
    btn.appendChild(badge);

    btn.appendChild(document.createTextNode(cell.label));

    if (myMarks.has(cell.id)) btn.classList.add("marked");

    if (pendingVote && pendingVote.cellId === cell.id && !cell.unlocked) {
      btn.classList.add("pending");
      badge.textContent = "BEKLE";
    }

    btn.addEventListener("click", () => onCellClick(cell));
    grid.appendChild(btn);
  }
}

function onCellClick(cell){
  if (!state) return;
  armAudioOnce();

  if (state.phase !== "running") {
    hint.textContent = "Oyun kilitli (kazanan onayı / bitti).";
    return;
  }
  if (isInCooldown()) {
    hint.textContent = `Lütfen bekleyiniz. (${Math.ceil(msLeft(cooldownUntil)/1000)}sn)`;
    return;
  }

  // Locked cell => "vote" for crowd validation
  if (!cell.unlocked) {
    pendingVote = { cellId: cell.id, until: Date.now() + (state.stats?.voteFailMs || 10_000) };
    renderBoard();
    updateBingoButton();
    hint.textContent = "Doğrulama bekleniyor… (kitle aynı kutuya basarsa açılır)";

    socket.emit("toggleMark", { cellId: cell.id, marked: true }, (res) => {
      if (!res?.ok) {
        if (res?.cooldownMs) cooldownUntil = Date.now() + res.cooldownMs;
        hint.textContent = res?.error || "İşaretleme başarısız.";
        if (pendingVote?.cellId === cell.id) pendingVote = null;
        renderBoard();
        updateBingoButton();
        return;
      }
      if (res.mode === "pending") {
        pendingVote = { cellId: cell.id, until: res.until };
        hint.textContent = `Doğrulama: ${res.currentVotes}/${res.required} oy…`;
        renderBoard();
        updateBingoButton();
      }
    });

    return;
  }

  // Unlocked cell => normal mark/unmark
  const next = !myMarks.has(cell.id);
  socket.emit("toggleMark", { cellId: cell.id, marked: next }, (res) => {
    if (!res?.ok) {
      if (res?.cooldownMs) cooldownUntil = Date.now() + res.cooldownMs;
      hint.textContent = res?.error || "İşaretleme başarısız.";
    }
  });
}

function computeBingoPossible(){
  if (!state) return false;
  const unlocked = new Set(state.board.filter(c => c.unlocked).map(c => c.id));
  const has = (id) => myMarks.has(id);

  const lines = [
    ["c0","c1","c2","c3"],
    ["c4","c5","c6","c7"],
    ["c8","c9","c10","c11"],
    ["c12","c13","c14","c15"],
    ["c0","c4","c8","c12"],
    ["c1","c5","c9","c13"],
    ["c2","c6","c10","c14"],
    ["c3","c7","c11","c15"],
    ["c0","c5","c10","c15"],
    ["c3","c6","c9","c12"],
  ];

  return lines.some(line => line.every(id => unlocked.has(id) && has(id)));
}

function updateTop(){
  roomPill.textContent = `Oturum: ${state?.roomId || "—"}`;
  phasePill.textContent = `Durum: ${state?.phase || "—"}`;
}

function renderPlayers(){
  if (!state) return;
  playersEl.innerHTML = "";
  const list = state.players.slice(0, 30);
  if (!list.length) {
    playersEl.innerHTML = `<div class="player"><div class="name">Henüz kimse yok</div><div class="score">—</div></div>`;
    return;
  }
  for (const p of list) {
    const row = document.createElement("div");
    row.className = "player";
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = p.name + (p.playerId === me.playerId ? " (sen)" : "");
    const score = document.createElement("div");
    score.className = "score";
    const activeDot = p.isActive ? "●" : "○";
    score.textContent = `${activeDot} ${p.markedCount} kutu`;
    row.appendChild(name);
    row.appendChild(score);
    playersEl.appendChild(row);
  }
}

function updateStatus(){
  if (!state) return;
  const unlockedCount = state.board.filter(c => c.unlocked).length;
  const stats = state.stats || {};
  const act = stats.activePlayers ?? "—";
  const tot = stats.totalPlayers ?? "—";
  const req = stats.requiredVotes ?? "—";

  let msg = `Açık kutu sayısı: <b>${unlockedCount}</b> / 16. `;
  msg += `Katılımcı: <b>${tot}</b> (aktif: <b>${act}</b>). Doğrulama eşiği: <b>${req}</b> oy / ${Math.round((stats.voteWindowMs||6000)/1000)}sn.`;

  if (pendingVote && !isInCooldown()) {
    msg += `<br><b>Bekleyen seçim:</b> ${pendingVote.cellId} (${Math.ceil(msLeft(pendingVote.until)/1000)}sn)`;
  }
  if (state.pendingWin) {
    msg += `<br><b>Bekleyen kazanan:</b> ${escapeHtml(state.pendingWin.name)} (host onayı bekleniyor).`;
  }
  if (state.winner) {
    msg += `<br><b>Kazanan:</b> ${escapeHtml(state.winner.name)} 🎉`;
  }
  if (isInCooldown()) {
    msg += `<br><b>Timeout:</b> ${Math.ceil(msLeft(cooldownUntil)/1000)}sn`;
  }

  statusRow.innerHTML = msg;
}

function updateBingoButton(){
  if (!state) return;
  const possible = computeBingoPossible();
  bingoBtn.disabled = !(state.phase === "running" && possible && !pendingVote && !isInCooldown());
  if (isInCooldown()) {
    hint.textContent = `Lütfen bekleyiniz. (${Math.ceil(msLeft(cooldownUntil)/1000)}sn)`;
  } else if (pendingVote) {
    hint.textContent = "Doğrulama bekleniyor…";
  } else {
    hint.textContent = possible ? "Bingo çizgin hazır görünüyor. “BINGO!” bas." : "Bingo için satır/sütun/çapraz tamamla.";
  }
}

function escapeHtml(s){
  return String(s || "").replace(/[&<>"']/g, (m) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
}

bingoBtn.addEventListener("click", () => {
  armAudioOnce();
  if (isInCooldown() || pendingVote) return;
  bingoBtn.disabled = true;
  hint.textContent = "Bingo iddiası gönderildi…";
  socket.emit("claimBingo", {}, (res) => {
    if (!res?.ok) {
      hint.textContent = res?.error || "Bingo iddiası reddedildi.";
      updateBingoButton();
    } else {
      hint.textContent = "Bingo beklemeye alındı. Host onaylarsa oyun biter.";
    }
  });
});

joinBtn.addEventListener("click", () => doJoin());

function doJoin(){
  joinError.textContent = "";
  const roomId = (roomIdEl.value || "").trim().toUpperCase();
  const pass = (joinPassEl.value || "").trim();
  const name = (displayNameEl.value || "").trim() || "İzleyici";
  if (!roomId || !pass) {
    joinError.textContent = "Oturum kodu ve şifre gerekli.";
    return;
  }

  me.playerId = getOrCreatePlayerId();
  me.name = name;

  socket.emit("joinRoom", { roomId, role: "player", password: pass, playerId: me.playerId, name }, (res) => {
    if (!res?.ok) {
      joinError.textContent = res?.error || "Bağlanamadı.";
      return;
    }
    state = res.state;
    myMarks = new Set(res.myMarks || []);
    pendingVote = null;
    cooldownUntil = 0;
    showJoinModal(false);
    hydrateUI();
    startHeartbeat();
  });
}

function hydrateUI(){
  updateTop();
  renderBoard();
  renderPlayers();
  updateStatus();
  updateBingoButton();
}

socket.on("syncMarks", (payload) => {
  if (!payload || payload.roomId !== state?.roomId) return;
  myMarks = new Set(payload.marks || []);
  renderBoard();
  updateBingoButton();
});

socket.on("state", (s) => {
  state = s;
  if (pendingVote) {
    const cell = state.board.find(c => c.id === pendingVote.cellId);
    if (cell && cell.unlocked) pendingVote = null;
    if (Date.now() > pendingVote.until) pendingVote = null;
  }
  updateTop();
  renderBoard();
  renderPlayers();
  updateStatus();
  updateBingoButton();
});

socket.on("notice", (n) => {
  if (!n) return;
  if (n.type === "cooldown") {
    cooldownUntil = Date.now() + (n.cooldownMs || 10_000);
    pendingVote = null;
    hint.textContent = n.message || "Lütfen bekleyiniz.";
    if (audioEnabled) playBuzz();
  }
  updateStatus();
  updateBingoButton();
  renderBoard();
});

socket.on("pulse", (p) => {
  if (!p) return;
  if (p.type === "unlock") {
    if (audioEnabled) playBeep();
  }
});

let hbTimer = null;
function startHeartbeat(){
  if (hbTimer) clearInterval(hbTimer);
  hbTimer = setInterval(() => {
    socket.emit("heartbeat", {});
    if (pendingVote && Date.now() > pendingVote.until) {
      pendingVote = null;
      renderBoard();
      updateBingoButton();
    }
    updateStatus();
  }, 5000);
}

/** ---- Audio (WebAudio beep) ---- **/
function armAudioOnce(){
  if (audioArmed) return;
  audioArmed = true;
}
function playBeep(){
  if (!audioArmed) return;
  try{
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = 880;
    g.gain.value = 0.03;
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    setTimeout(() => { o.stop(); ctx.close(); }, 120);
  }catch{}
}
function playBuzz(){
  if (!audioArmed) return;
  try{
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "square";
    o.frequency.value = 140;
    g.gain.value = 0.025;
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    setTimeout(() => { o.stop(); ctx.close(); }, 160);
  }catch{}
}

roomIdEl.value = (qs.get("room") || "").toUpperCase();
displayNameEl.value = localStorage.getItem("erenBingoDisplayName") || "";
displayNameEl.addEventListener("input", () => {
  localStorage.setItem("erenBingoDisplayName", displayNameEl.value);
});

window.addEventListener("keydown", (e) => {
  if (e.key.toLowerCase() === "m") {
    audioEnabled = !audioEnabled;
    hint.textContent = audioEnabled ? "Ses açık." : "Ses kapalı.";
  }
});

showJoinModal(true);
