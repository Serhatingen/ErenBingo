const path = require("path");
const crypto = require("crypto");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 3000;
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

/** ---------- Game config ---------- */
const BOARD_SIZE = 4; // 4x4
const CELLS = [
  { id: "c0",  label: "SİKİMİ\nAÇICAM" },
  { id: "c1",  label: "DANS\n(TERCİHENTWERK)" },
  { id: "c2",  label: "BATMAN\n(RAGE'Lİ)" },
  { id: "c3",  label: "NAZO\nŞAKŞAK" },

  { id: "c4",  label: "VİCDANSIZ" },
  { id: "c5",  label: "AZMIŞ\nBABÜ" },
  { id: "c6",  label: "HAYVAN\nHAYVAAN" },
  { id: "c7",  label: "AHLAKSIZ\nŞARKI" },

  { id: "c8",  label: "MEHMEETT" },
  { id: "c9",  label: "TTS'E\nKÜFÜR" },
  { id: "c10", label: "SAÇ'A\nLAF" },
  { id: "c11", label: "AZDI\nAZDI" },

  { id: "c12", label: "GS'YE\nLAF" },
  { id: "c13", label: "BAZIR\nBUZUR" },
  { id: "c14", label: "ÜŞTEH" },
  { id: "c15", label: "“...SAATLİK\nUYKUYLA\nDURUYORUM”" },
];

function makeLines() {
  const lines = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    const line = [];
    for (let c = 0; c < BOARD_SIZE; c++) line.push(`c${r * BOARD_SIZE + c}`);
    lines.push(line);
  }
  for (let c = 0; c < BOARD_SIZE; c++) {
    const line = [];
    for (let r = 0; r < BOARD_SIZE; r++) line.push(`c${r * BOARD_SIZE + c}`);
    lines.push(line);
  }
  lines.push(["c0","c5","c10","c15"]);
  lines.push(["c3","c6","c9","c12"]);
  return lines;
}
const WIN_LINES = makeLines();

/** ---------- Crowd validation parameters ---------- */
const ACTIVE_WINDOW_MS = 25_000;  // who is "active"
const VOTE_WINDOW_MS   = 6_000;   // crowd window
const VOTE_FAIL_MS     = 10_000;  // if crowd doesn't follow within this -> wrong pick
const COOLDOWN_MS      = 10_000;  // penalty lockout
const MIN_VOTES        = 2;
const MAX_VOTES        = 12;

/** ---------- In-memory rooms ---------- */
const rooms = new Map();

function randRoomId() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}
function sha256(s) {
  return crypto.createHash("sha256").update(String(s || "")).digest("hex");
}
function now() { return Date.now(); }

function createRoom({ joinPassword, hostPassword }) {
  let roomId;
  do { roomId = randRoomId(); } while (rooms.has(roomId));

  const board = CELLS.map(c => ({ ...c, unlocked: false, unlockedAt: null }));

  const room = {
    id: roomId,
    joinHash: sha256(joinPassword),
    hostHash: sha256(hostPassword),
    createdAt: now(),
    board,
    players: new Map(),        // playerId -> player state
    playerSockets: new Map(),  // playerId -> Set(socketId)
    votes: new Map(),          // cellId -> Map(playerId -> timestamp)
    hostSockets: new Set(),
    pendingWin: null,
    winner: null,
    phase: "running",
  };

  rooms.set(roomId, room);
  return room;
}

function getActiveCount(room) {
  const t = now();
  let count = 0;
  for (const p of room.players.values()) {
    if (t - (p.lastSeenAt || 0) <= ACTIVE_WINDOW_MS) count++;
  }
  return count;
}

function calcRequiredVotes(room) {
  const active = Math.max(1, getActiveCount(room));
  const total = Math.max(1, room.players.size);

  // Active drives most of it; total joiners add a small (clamped) contribution.
  const reqActive = Math.ceil(active * 0.12);       // 12% of active
  const reqTotal  = Math.min(8, Math.ceil(total * 0.02)); // 2% of total, max 8
  const req = Math.max(MIN_VOTES, reqActive, reqTotal);

  return Math.min(MAX_VOTES, req);
}

function publicRoomState(room) {
  const players = [];
  for (const [playerId, p] of room.players.entries()) {
    players.push({
      playerId,
      name: p.name,
      markedCount: p.marks.size,
      joinedAt: p.joinedAt,
      isActive: (now() - (p.lastSeenAt || 0) <= ACTIVE_WINDOW_MS),
      cooldownUntil: p.cooldownUntil || 0,
      pendingVote: p.pendingVote ? { cellId: p.pendingVote.cellId, until: p.pendingVote.until } : null,
    });
  }
  players.sort((a,b) => b.markedCount - a.markedCount || a.joinedAt - b.joinedAt);

  return {
    roomId: room.id,
    phase: room.phase,
    board: room.board.map(c => ({ id: c.id, label: c.label, unlocked: c.unlocked, unlockedAt: c.unlockedAt })),
    players,
    stats: {
      totalPlayers: room.players.size,
      activePlayers: getActiveCount(room),
      requiredVotes: calcRequiredVotes(room),
      voteWindowMs: VOTE_WINDOW_MS,
      voteFailMs: VOTE_FAIL_MS,
      cooldownMs: COOLDOWN_MS,
    },
    pendingWin: room.pendingWin,
    winner: room.winner,
  };
}

function isHost(socket) { return socket.data?.role === "host"; }

function canMarkUnlocked(room, cellId) {
  const cell = room.board.find(c => c.id === cellId);
  return !!cell && cell.unlocked;
}

function checkBingo(room, marksSet) {
  const unlocked = new Set(room.board.filter(c => c.unlocked).map(c => c.id));
  for (const line of WIN_LINES) {
    let ok = true;
    for (const cid of line) {
      if (!marksSet.has(cid) || !unlocked.has(cid)) { ok = false; break; }
    }
    if (ok) return line;
  }
  return null;
}

function sendMarksToPlayer(room, playerId) {
  const p = room.players.get(playerId);
  if (!p) return;
  const socks = room.playerSockets.get(playerId);
  if (!socks) return;
  const marks = Array.from(p.marks);
  for (const sid of socks) io.to(sid).emit("syncMarks", { roomId: room.id, marks });
}

function broadcastState(room) {
  io.to(room.id).emit("state", publicRoomState(room));
}

function pruneOldVotes(room, cellId) {
  const t = now();
  const m = room.votes.get(cellId);
  if (!m) return 0;
  for (const [pid, ts] of m.entries()) {
    if (t - ts > VOTE_WINDOW_MS) m.delete(pid);
  }
  if (m.size === 0) room.votes.delete(cellId);
  return m.size;
}

function handleConsensusIfReached(room, cellId) {
  if (room.phase !== "running") return false;
  if (room.winner) return false;

  const cell = room.board.find(c => c.id === cellId);
  if (!cell || cell.unlocked) return false;

  const required = calcRequiredVotes(room);
  pruneOldVotes(room, cellId);
  const voteMap = room.votes.get(cellId);
  const votes = voteMap ? voteMap.size : 0;

  if (votes >= required) {
    // unlock permanently
    cell.unlocked = true;
    cell.unlockedAt = now();

    // auto-mark for voters
    if (voteMap) {
      for (const pid of voteMap.keys()) {
        const p = room.players.get(pid);
        if (!p) continue;
        p.marks.add(cellId);
        if (p.pendingTimer) { clearTimeout(p.pendingTimer); p.pendingTimer = null; }
        p.pendingVote = null;
        sendMarksToPlayer(room, pid);
      }
    }

    room.votes.delete(cellId);

    io.to(room.id).emit("pulse", { type: "unlock", cellId, label: cell.label, votes, required });
    broadcastState(room);
    return true;
  }
  return false;
}

/** ---------- HTTP API (host convenience) ---------- */
app.post("/api/create-room", (req, res) => {
  const { joinPassword, hostPassword } = req.body || {};
  if (!joinPassword || !hostPassword) {
    return res.status(400).json({ ok: false, error: "joinPassword ve hostPassword gerekli." });
  }
  const room = createRoom({ joinPassword, hostPassword });
  return res.json({ ok: true, roomId: room.id });
});

/** ---------- Socket.IO ---------- */
io.on("connection", (socket) => {
  socket.on("joinRoom", (payload, cb) => {
    try {
      const { roomId, role, password, playerId, name } = payload || {};
      const rid = String(roomId || "").toUpperCase();
      const room = rooms.get(rid);
      if (!room) return cb?.({ ok: false, error: "Oturum bulunamadı." });

      if (role === "host") {
        if (sha256(password) !== room.hostHash) return cb?.({ ok: false, error: "Host şifresi yanlış." });
        socket.data.role = "host";
        socket.data.roomId = rid;
        socket.join(rid);
        room.hostSockets.add(socket.id);
        return cb?.({ ok: true, state: publicRoomState(room) });
      }

      if (sha256(password) !== room.joinHash) return cb?.({ ok: false, error: "Oturum şifresi yanlış." });
      const pid = String(playerId || "").trim();
      if (!pid) return cb?.({ ok: false, error: "playerId eksik." });

      const cleanName = String(name || "").trim().slice(0, 24) || "İzleyici";
      let p = room.players.get(pid);
      if (!p) {
        p = {
          name: cleanName,
          marks: new Set(),
          joinedAt: now(),
          lastSeenAt: now(),
          lastActionAt: 0,
          cooldownUntil: 0,
          pendingVote: null,
          pendingTimer: null,
        };
        room.players.set(pid, p);
      } else {
        p.name = cleanName;
        p.lastSeenAt = now();
      }

      if (!room.playerSockets.has(pid)) room.playerSockets.set(pid, new Set());
      room.playerSockets.get(pid).add(socket.id);

      socket.data.role = "player";
      socket.data.roomId = rid;
      socket.data.playerId = pid;
      socket.join(rid);

      cb?.({ ok: true, state: publicRoomState(room), player: { playerId: pid, name: p.name }, myMarks: Array.from(p.marks) });
      broadcastState(room);
    } catch (e) {
      cb?.({ ok: false, error: "Sunucu hatası: " + (e?.message || e) });
    }
  });

  socket.on("heartbeat", (_, cb) => {
    try {
      const rid = socket.data.roomId;
      const pid = socket.data.playerId;
      if (!rid || !pid) return cb?.({ ok: false });
      const room = rooms.get(rid);
      if (!room) return cb?.({ ok: false });
      const p = room.players.get(pid);
      if (!p) return cb?.({ ok: false });
      p.lastSeenAt = now();
      cb?.({ ok: true });
    } catch {
      cb?.({ ok: false });
    }
  });

  socket.on("toggleMark", (payload, cb) => {
    try {
      const rid = socket.data.roomId;
      const pid = socket.data.playerId;
      if (!rid || !pid) return cb?.({ ok: false, error: "Oturuma bağlı değilsin." });

      const room = rooms.get(rid);
      if (!room) return cb?.({ ok: false, error: "Oturum yok." });
      if (room.phase !== "running") return cb?.({ ok: false, error: "Oyun şu an kilitli." });

      const { cellId, marked } = payload || {};
      const cid = String(cellId || "");
      const wantMark = !!marked;

      const p = room.players.get(pid);
      if (!p) return cb?.({ ok: false, error: "Oyuncu kaydı yok." });

      const t = now();
      p.lastSeenAt = t;

      if (p.cooldownUntil && t < p.cooldownUntil) {
        const left = p.cooldownUntil - t;
        return cb?.({ ok: false, error: `Lütfen bekleyiniz. (${Math.ceil(left/1000)}sn)`, cooldownMs: left });
      }

      // anti-spam
      if (t - p.lastActionAt < 80) return cb?.({ ok: false, error: "Çok hızlı tıklıyorsun." });
      p.lastActionAt = t;

      // If already unlocked: normal mark/unmark
      if (canMarkUnlocked(room, cid)) {
        if (wantMark) p.marks.add(cid);
        else p.marks.delete(cid);

        if (p.pendingTimer) { clearTimeout(p.pendingTimer); p.pendingTimer = null; }
        p.pendingVote = null;

        sendMarksToPlayer(room, pid);
        broadcastState(room);
        return cb?.({ ok: true, mode: "direct" });
      }

      // locked cell: allow "vote"
      if (!wantMark) {
        // cancel pending vote
        if (p.pendingVote && p.pendingVote.cellId === cid) {
          const m = room.votes.get(cid);
          if (m) { m.delete(pid); if (m.size === 0) room.votes.delete(cid); }
          if (p.pendingTimer) { clearTimeout(p.pendingTimer); p.pendingTimer = null; }
          p.pendingVote = null;
          broadcastState(room);
          return cb?.({ ok: true, mode: "cancel" });
        }
        return cb?.({ ok: true, mode: "noop" });
      }

      // one pending vote at a time
      if (p.pendingVote && p.pendingVote.cellId !== cid) {
        const prev = p.pendingVote.cellId;
        const pm = room.votes.get(prev);
        if (pm) { pm.delete(pid); if (pm.size === 0) room.votes.delete(prev); }
        if (p.pendingTimer) { clearTimeout(p.pendingTimer); p.pendingTimer = null; }
        p.pendingVote = null;
      }

      if (!room.votes.has(cid)) room.votes.set(cid, new Map());
      room.votes.get(cid).set(pid, t);

      const until = t + VOTE_FAIL_MS;
      p.pendingVote = { cellId: cid, until };

      p.pendingTimer = setTimeout(() => {
        try {
          const rr = rooms.get(rid);
          if (!rr) return;
          const pp = rr.players.get(pid);
          if (!pp) return;
          const tt = now();

          if (pp.pendingVote && pp.pendingVote.cellId === cid) {
            const cell = rr.board.find(c => c.id === cid);
            if (cell && !cell.unlocked) {
              pp.cooldownUntil = tt + COOLDOWN_MS;

              const vm = rr.votes.get(cid);
              if (vm) { vm.delete(pid); if (vm.size === 0) rr.votes.delete(cid); }

              pp.pendingVote = null;
              if (pp.pendingTimer) { clearTimeout(pp.pendingTimer); pp.pendingTimer = null; }

              const socks = rr.playerSockets.get(pid);
              if (socks) {
                for (const sid of socks) {
                  io.to(sid).emit("notice", {
                    type: "cooldown",
                    message: "Bu seçim kitle tarafından doğrulanmadı. 10 saniye bekle.",
                    cooldownMs: COOLDOWN_MS
                  });
                }
              }

              broadcastState(rr);
            }
          }
        } catch {}
      }, VOTE_FAIL_MS);

      // check consensus immediately
      handleConsensusIfReached(room, cid);
      broadcastState(room);

      const required = calcRequiredVotes(room);
      const currentVotes = pruneOldVotes(room, cid);
      cb?.({ ok: true, mode: "pending", until, currentVotes, required });
    } catch (e) {
      cb?.({ ok: false, error: "Sunucu hatası: " + (e?.message || e) });
    }
  });

  socket.on("claimBingo", (_, cb) => {
    try {
      const rid = socket.data.roomId;
      const pid = socket.data.playerId;
      if (!rid || !pid) return cb?.({ ok: false, error: "Oturuma bağlı değilsin." });

      const room = rooms.get(rid);
      if (!room) return cb?.({ ok: false, error: "Oturum yok." });
      if (room.phase !== "running") return cb?.({ ok: false, error: "Oyun şu an kilitli." });
      if (room.winner) return cb?.({ ok: false, error: "Oyun bitmiş." });
      if (room.pendingWin) return cb?.({ ok: false, error: "Zaten bekleyen bir kazanan var." });

      const p = room.players.get(pid);
      if (!p) return cb?.({ ok: false, error: "Oyuncu kaydı yok." });

      const t = now();
      p.lastSeenAt = t;

      if (p.cooldownUntil && t < p.cooldownUntil) {
        const left = p.cooldownUntil - t;
        return cb?.({ ok: false, error: `Lütfen bekleyiniz. (${Math.ceil(left/1000)}sn)` });
      }
      if (p.pendingVote) return cb?.({ ok: false, error: "Bir kutu doğrulanmayı bekliyor. Onun sonucunu bekle." });

      const line = checkBingo(room, p.marks);
      if (!line) return cb?.({ ok: false, error: "Henüz geçerli bir bingo yok (satır/sütun/çapraz)." });

      room.pendingWin = { playerId: pid, name: p.name, claimedAt: now(), line };
      room.phase = "paused";
      cb?.({ ok: true, pendingWin: room.pendingWin });
      broadcastState(room);
    } catch (e) {
      cb?.({ ok: false, error: "Sunucu hatası: " + (e?.message || e) });
    }
  });

  // Host overrides remain (optional)
  socket.on("hostUnlockCell", (payload, cb) => {
    try {
      const rid = socket.data.roomId;
      if (!rid) return cb?.({ ok: false, error: "Oturuma bağlı değilsin." });
      const room = rooms.get(rid);
      if (!room) return cb?.({ ok: false, error: "Oturum yok." });
      if (!isHost(socket)) return cb?.({ ok: false, error: "Yetkisiz." });
      if (room.phase === "ended") return cb?.({ ok: false, error: "Oyun bitmiş." });

      const { cellId, unlocked } = payload || {};
      const cid = String(cellId || "");
      const cell = room.board.find(c => c.id === cid);
      if (!cell) return cb?.({ ok: false, error: "Kutu yok." });

      cell.unlocked = !!unlocked;
      cell.unlockedAt = cell.unlocked ? now() : null;

      if (!cell.unlocked) {
        for (const p of room.players.values()) {
          p.marks.delete(cid);
          if (p.pendingVote && p.pendingVote.cellId === cid) {
            p.pendingVote = null;
            if (p.pendingTimer) { clearTimeout(p.pendingTimer); p.pendingTimer = null; }
          }
        }
        room.votes.delete(cid);
        for (const pid of room.players.keys()) sendMarksToPlayer(room, pid);
      } else {
        io.to(room.id).emit("pulse", { type: "unlock", cellId: cid, label: cell.label, by: "host" });
      }

      cb?.({ ok: true });
      broadcastState(room);
    } catch (e) {
      cb?.({ ok: false, error: "Sunucu hatası: " + (e?.message || e) });
    }
  });

  socket.on("hostResolveWin", (payload, cb) => {
    try {
      const rid = socket.data.roomId;
      if (!rid) return cb?.({ ok: false, error: "Oturuma bağlı değilsin." });
      const room = rooms.get(rid);
      if (!room) return cb?.({ ok: false, error: "Oturum yok." });
      if (!isHost(socket)) return cb?.({ ok: false, error: "Yetkisiz." });
      if (!room.pendingWin) return cb?.({ ok: false, error: "Bekleyen kazanan yok." });

      const { decision } = payload || {};
      if (decision === "approve") {
        room.winner = { ...room.pendingWin, confirmedAt: now() };
        room.pendingWin = null;
        room.phase = "ended";
      } else if (decision === "reject") {
        room.pendingWin = null;
        room.phase = "running";
      } else {
        return cb?.({ ok: false, error: "decision approve|reject olmalı." });
      }

      cb?.({ ok: true });
      broadcastState(room);
    } catch (e) {
      cb?.({ ok: false, error: "Sunucu hatası: " + (e?.message || e) });
    }
  });

  socket.on("hostResetGame", (_, cb) => {
    try {
      const rid = socket.data.roomId;
      if (!rid) return cb?.({ ok: false, error: "Oturuma bağlı değilsin." });
      const room = rooms.get(rid);
      if (!room) return cb?.({ ok: false, error: "Oturum yok." });
      if (!isHost(socket)) return cb?.({ ok: false, error: "Yetkisiz." });

      room.board.forEach(c => { c.unlocked = false; c.unlockedAt = null; });
      room.votes.clear();

      for (const p of room.players.values()) {
        p.marks.clear();
        p.cooldownUntil = 0;
        p.pendingVote = null;
        if (p.pendingTimer) { clearTimeout(p.pendingTimer); p.pendingTimer = null; }
      }

      room.pendingWin = null;
      room.winner = null;
      room.phase = "running";

      for (const pid of room.players.keys()) sendMarksToPlayer(room, pid);
      cb?.({ ok: true });
      broadcastState(room);
    } catch (e) {
      cb?.({ ok: false, error: "Sunucu hatası: " + (e?.message || e) });
    }
  });

  socket.on("disconnect", () => {
    try {
      const rid = socket.data.roomId;
      if (!rid) return;
      const room = rooms.get(rid);
      if (!room) return;

      if (socket.data.role === "host") room.hostSockets.delete(socket.id);

      if (socket.data.role === "player") {
        const pid = socket.data.playerId;
        if (pid) {
          const sset = room.playerSockets.get(pid);
          if (sset) {
            sset.delete(socket.id);
            if (sset.size === 0) room.playerSockets.delete(pid);
          }
        }
      }
    } catch {}
  });
});

server.listen(PORT, () => {
  console.log(`Eren Bingo running on http://localhost:${PORT}`);
});
