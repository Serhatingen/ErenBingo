/* global io */
const socket = io();

const createRoomBtn = document.getElementById("createRoomBtn");
const newJoinPass = document.getElementById("newJoinPass");
const newHostPass = document.getElementById("newHostPass");
const createOut = document.getElementById("createOut");

const connectBtn = document.getElementById("connectBtn");
const roomIdEl = document.getElementById("roomId");
const hostPassEl = document.getElementById("hostPass");
const connectErr = document.getElementById("connectErr");

const grid = document.getElementById("grid");
const roomPill = document.getElementById("roomPill");
const phasePill = document.getElementById("phasePill");
const hint = document.getElementById("hint");

const resetBtn = document.getElementById("resetBtn");

const pendingBox = document.getElementById("pendingBox");
const approveBtn = document.getElementById("approveBtn");
const rejectBtn = document.getElementById("rejectBtn");

const playersEl = document.getElementById("players");

let state = null;
let roomId = null;
let hostPass = null;

function updateTop(){
  roomPill.textContent = `Oturum: ${state?.roomId || "—"}`;
  phasePill.textContent = `Durum: ${state?.phase || "—"}`;
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

    btn.addEventListener("click", () => {
      if (!state) return;
      if (state.phase === "ended") return;
      const next = !cell.unlocked;
      socket.emit("hostUnlockCell", { cellId: cell.id, unlocked: next }, (res) => {
        if (!res?.ok) hint.textContent = res?.error || "İşlem başarısız.";
      });
    });

    grid.appendChild(btn);
  }
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
    name.textContent = p.name;
    const score = document.createElement("div");
    score.className = "score";
    score.textContent = `${p.markedCount} kutu`;
    row.appendChild(name);
    row.appendChild(score);
    playersEl.appendChild(row);
  }
}

function renderPending(){
  if (!state) return;
  const title = pendingBox.querySelector(".pending-title");
  const sub = pendingBox.querySelector(".pending-sub");

  if (state.winner) {
    title.textContent = `Kazanan: ${state.winner.name} 🎉`;
    sub.textContent = "Oyun bitmiş durumda.";
    approveBtn.disabled = true;
    rejectBtn.disabled = true;
    return;
  }

  if (!state.pendingWin) {
    title.textContent = "Bekleyen kazanan: —";
    sub.textContent = "Henüz kimse bingo iddiası yapmadı.";
    approveBtn.disabled = true;
    rejectBtn.disabled = true;
    return;
  }

  title.textContent = `Bekleyen kazanan: ${state.pendingWin.name}`;
  const line = state.pendingWin.line?.join(", ") || "—";
  sub.textContent = `İddia satırı: ${line}. Onaylarsan oyun biter.`;
  approveBtn.disabled = false;
  rejectBtn.disabled = false;
}

function hydrateUI(){
  updateTop();
  renderBoard();
  renderPlayers();
  renderPending();
  resetBtn.disabled = !state;
  if (state && state.stats) {
    hint.textContent = `Aktif: ${state.stats.activePlayers}/${state.stats.totalPlayers} — Doğrulama eşiği: ${state.stats.requiredVotes} oy / ${Math.round((state.stats.voteWindowMs||6000)/1000)}sn`;
  }
}

createRoomBtn.addEventListener("click", async () => {
  createOut.textContent = "";
  const jp = (newJoinPass.value || "").trim();
  const hp = (newHostPass.value || "").trim();
  if (!jp || !hp) {
    createOut.textContent = "İzleyici ve host şifresi gerekli.";
    return;
  }
  const res = await fetch("/api/create-room", {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify({ joinPassword: jp, hostPassword: hp })
  });
  const data = await res.json();
  if (!data.ok) {
    createOut.textContent = data.error || "Oluşturulamadı.";
    return;
  }
  const rid = data.roomId;
  createOut.innerHTML = `
    Oturum oluşturuldu: <b>${rid}</b><br/>
    İzleyici linki: <code>${location.origin}/?room=${rid}</code><br/>
    Host linki: <code>${location.origin}/host.html</code>
  `;
  // convenience: auto-fill join
  roomIdEl.value = rid;
  hostPassEl.value = hp;
});

connectBtn.addEventListener("click", () => {
  connectErr.textContent = "";
  roomId = (roomIdEl.value || "").trim().toUpperCase();
  hostPass = (hostPassEl.value || "").trim();
  if (!roomId || !hostPass) {
    connectErr.textContent = "Oturum kodu ve host şifresi gerekli.";
    return;
  }
  socket.emit("joinRoom", { roomId, role: "host", password: hostPass }, (res) => {
    if (!res?.ok) {
      connectErr.textContent = res?.error || "Bağlanamadı.";
      return;
    }
    state = res.state;
    hydrateUI();
  });
});

approveBtn.addEventListener("click", () => {
  socket.emit("hostResolveWin", { decision: "approve" }, (res) => {
    if (!res?.ok) hint.textContent = res?.error || "Onay başarısız.";
  });
});
rejectBtn.addEventListener("click", () => {
  socket.emit("hostResolveWin", { decision: "reject" }, (res) => {
    if (!res?.ok) hint.textContent = res?.error || "Reddetme başarısız.";
  });
});
resetBtn.addEventListener("click", () => {
  socket.emit("hostResetGame", {}, (res) => {
    if (!res?.ok) hint.textContent = res?.error || "Reset başarısız.";
    else hint.textContent = "Oyun sıfırlandı.";
  });
});

socket.on("state", (s) => {
  state = s;
  hydrateUI();
});

// initial UI state
hydrateUI();
