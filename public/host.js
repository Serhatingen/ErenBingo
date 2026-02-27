const qs = new URLSearchParams(location.search);
if (qs.get('debug') === '1') document.body.classList.add('debug-overlay');

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

// Audio
const audioFile = document.getElementById("audioFile");
const uploadAudioBtn = document.getElementById("uploadAudioBtn");
const sendAlertBtn = document.getElementById("sendAlertBtn");
const audioStatus = document.getElementById("audioStatus");

let state = null;

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
    if (cell.unlocked) badge.textContent = "AÇIK";
    else {
      const cnt = state?.stats?.votesByCell?.[cell.id] || 0;
      badge.textContent = cnt ? `OY:${cnt}` : "KAPALI";
    }
    btn.appendChild(badge);

    const txt = document.createElement("div");
    txt.className = "cell-text";
    txt.textContent = cell.label;
    btn.appendChild(txt);

    btn.addEventListener("click", () => {
      if (!state) return;
      if (state.phase === "ended") return;
      socket.emit("hostUnlockCell", { cellId: cell.id, unlocked: !cell.unlocked }, (res) => {
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
    const activeDot = p.isActive ? "●" : "○";
    const voted = p.hasVoted ? "✓" : "";
    score.textContent = `${activeDot} ${p.markedCount} kutu ${voted}`;
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
  sub.textContent = `İddia satırı: ${(state.pendingWin.line||[]).join(", ")}`;
  approveBtn.disabled = false;
  rejectBtn.disabled = false;
}

function renderStats(){
  if (!state?.stats) return;
  const s = state.stats;
  const fv = s.firstVoterName ? `İlk oy: ${s.firstVoterName}` : "İlk oy: —";
  hint.textContent = `Aktif: ${s.activePlayers}/${s.totalPlayers} — Oy kullanan: ${s.votersCount} — Eşik: ${s.requiredVotes} oy / ${Math.round((s.voteWindowMs||6000)/1000)}sn — ${fv}`;
  if (audioStatus) audioStatus.textContent = s.hasSound ? `Ses yüklü (id: ${s.soundId}).` : "Ses dosyası yok.";
  if (sendAlertBtn) sendAlertBtn.disabled = !s.hasSound;
}

function hydrateUI(){
  updateTop();
  renderBoard();
  renderPlayers();
  renderPending();
  renderStats();
  resetBtn.disabled = !state;
}

document.getElementById("createRoomBtn")?.addEventListener("click", async () => {
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
  roomIdEl.value = rid;
  hostPassEl.value = hp;
});

document.getElementById("connectBtn")?.addEventListener("click", () => {
  connectErr.textContent = "";
  const roomId = (roomIdEl.value || "").trim().toUpperCase();
  const hostPass = (hostPassEl.value || "").trim();
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

approveBtn?.addEventListener("click", () => {
  socket.emit("hostResolveWin", { decision: "approve" }, (res) => {
    if (!res?.ok) hint.textContent = res?.error || "Onay başarısız.";
  });
});
rejectBtn?.addEventListener("click", () => {
  socket.emit("hostResolveWin", { decision: "reject" }, (res) => {
    if (!res?.ok) hint.textContent = res?.error || "Reddetme başarısız.";
  });
});
resetBtn?.addEventListener("click", () => {
  socket.emit("hostResetGame", {}, (res) => {
    hint.textContent = res?.ok ? "Oyun sıfırlandı." : (res?.error || "Reset başarısız.");
  });
});

/* Audio upload & alert */
uploadAudioBtn?.addEventListener("click", async () => {
  if (!audioFile?.files?.length) {
    audioStatus.textContent = "Önce bir audio dosyası seç.";
    return;
  }
  const file = audioFile.files[0];
  audioStatus.textContent = "Yükleniyor…";
  try {
    const buf = await file.arrayBuffer();
    socket.emit("hostUploadSound", { mime: file.type || "audio/mpeg", data: buf }, (res) => {
      audioStatus.textContent = res?.ok ? "Yüklendi." : (res?.error || "Yükleme başarısız.");
    });
  } catch {
    audioStatus.textContent = "Dosya okunamadı.";
  }
});

sendAlertBtn?.addEventListener("click", () => {
  socket.emit("hostSendAlert", {}, (res) => {
    audioStatus.textContent = res?.ok ? "Uyarı gönderildi." : (res?.error || "Uyarı gönderilemedi.");
  });
});

/* Password eye */
document.addEventListener("click", (e) => {
  const btn = e.target?.closest?.(".pw-eye");
  if (!btn) return;
  const targetId = btn.getAttribute("data-target");
  const inp = document.getElementById(targetId);
  if (!inp) return;
  inp.type = (inp.type === "password") ? "text" : "password";
});

socket.on("state", (s) => {
  state = s;
  hydrateUI();
});

hydrateUI();
