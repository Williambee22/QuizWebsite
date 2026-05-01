const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

app.use(express.static("public"));

/**
 * Server is the single source of truth.
 * Everyone sees the same quiz state because every change is emitted from here.
 */
const state = {
  phase: "lobby", // lobby | question | locked | reveal | leaderboard
  question: "",
  options: [],
  correctKey: "",
  durationSeconds: 15,
  endsAt: null,
  players: {},
  lastResults: null,
  leaderboard: null,
  previousLeaderboardRanks: {},
};

let timerInterval = null;

function publicState() {
  const now = Date.now();
  const timeLeftMs =
    state.phase === "question" && state.endsAt
      ? Math.max(0, state.endsAt - now)
      : 0;

  return {
    phase: state.phase,
    question: state.question,
    options: state.options,
    durationSeconds: state.durationSeconds,
    timeLeftMs,
    players: Object.values(state.players).map((p) => ({
      id: p.id,
      name: p.name,
      answerKey: p.answerKey,
      hasAnswered: Boolean(p.answerKey),
      score: p.score || 0,
    })),
    lastResults: state.lastResults,
    leaderboard: state.leaderboard,
  };
}

function adminState() {
  return {
    ...publicState(),
    correctKey: state.correctKey,
    players: Object.values(state.players).map((p) => ({
      id: p.id,
      name: p.name,
      answerKey: p.answerKey,
      hasAnswered: Boolean(p.answerKey),
      score: p.score || 0,
      answeredAt: p.answeredAt,
    })),
  };
}

function emitState() {
  io.emit("state", publicState());
  io.to("admins").emit("adminState", adminState());
}

function clearTimer() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;
}

function revealQuestion() {
  clearTimer();

  if (state.phase === "reveal") return;

  for (const player of Object.values(state.players)) {
    if (player.answerKey === state.correctKey) {
      player.score = (player.score || 0) + 1;
    }
  }

  state.phase = "reveal";
  state.endsAt = null;
  state.lastResults = buildResults();

  emitState();
}

function startTimer() {
  clearTimer();
  timerInterval = setInterval(() => {
    if (state.phase !== "question" || !state.endsAt) {
      clearTimer();
      return;
    }

    if (Date.now() >= state.endsAt) {
      revealQuestion();
      return;
    }

    emitState();
  }, 250);
}

function normalizeOptions(rawOptions) {
  const keys = ["A", "B", "C", "D", "E", "F"];

  return rawOptions
    .slice(0, 6)
    .map((text, index) => ({
      key: keys[index],
      text: String(text || "").trim(),
    }))
    .filter((option) => option.text.length > 0);
}

function buildResults() {
  const counts = {};
  for (const option of state.options) {
    counts[option.key] = 0;
  }

  let totalAnswers = 0;

  for (const player of Object.values(state.players)) {
    if (player.answerKey) {
      counts[player.answerKey] = (counts[player.answerKey] || 0) + 1;
      totalAnswers += 1;
    }
  }

  return {
    question: state.question,
    correctKey: state.correctKey,
    counts,
    totalAnswers,
    players: Object.values(state.players).map((p) => ({
      name: p.name,
      answerKey: p.answerKey || null,
      correct: p.answerKey === state.correctKey,
      score: p.score || 0,
    })),
  };
}

function buildLeaderboard() {
  const sortedPlayers = Object.values(state.players)
    .map((p) => ({
      id: p.id,
      name: p.name,
      score: p.score || 0,
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.name.localeCompare(b.name);
    });

  const currentRanks = {};

  sortedPlayers.forEach((player, index) => {
    currentRanks[player.id] = index + 1;
  });

  const topFive = sortedPlayers.slice(0, 5).map((player, index) => {
    const rank = index + 1;
    const previousRank = state.previousLeaderboardRanks[player.id] || null;

    let movement = "same";
    let movementAmount = 0;

    if (previousRank === null) {
      movement = "new";
    } else if (previousRank > rank) {
      movement = "up";
      movementAmount = previousRank - rank;
    } else if (previousRank < rank) {
      movement = "down";
      movementAmount = rank - previousRank;
    }

    return {
      id: player.id,
      name: player.name,
      score: player.score,
      rank,
      previousRank,
      movement,
      movementAmount,
    };
  });

  state.previousLeaderboardRanks = currentRanks;

  return {
    topFive,
    shownAt: Date.now(),
  };
}



io.on("connection", (socket) => {
  socket.emit("state", publicState());

  socket.on("joinPlayer", (name, callback) => {
    const cleanName = String(name || "").trim().slice(0, 30);

    if (!cleanName) {
      callback?.({ ok: false, error: "Enter a player name." });
      return;
    }

    state.players[socket.id] = {
      id: socket.id,
      name: cleanName,
      answerKey: null,
      answeredAt: null,
      score: 0,
    };

    callback?.({ ok: true });
    emitState();
  });

  socket.on("showLeaderboard", (callback) => {
    if (!socket.rooms.has("admins")) {
      callback?.({ ok: false, error: "Admin only." });
      return;
    }
  
    clearTimer();
  
    state.phase = "leaderboard";
    state.endsAt = null;
    state.leaderboard = buildLeaderboard();
  
    callback?.({ ok: true });
    emitState();
  });

  
  socket.on("adminLogin", (password, callback) => {
    if (password !== ADMIN_PASSWORD) {
      callback?.({ ok: false, error: "Wrong admin password." });
      return;
    }

    socket.join("admins");
    callback?.({ ok: true });
    socket.emit("adminState", adminState());
  });

  socket.on("startQuestion", (payload, callback) => {
    if (!socket.rooms.has("admins")) {
      callback?.({ ok: false, error: "Admin only." });
      return;
    }

    const question = String(payload?.question || "").trim();
    const options = normalizeOptions(payload?.options || []);
    const correctKey = String(payload?.correctKey || "").trim().toUpperCase();
    const durationSeconds = Math.max(5, Math.min(120, Number(payload?.durationSeconds || 15)));

    if (!question) {
      callback?.({ ok: false, error: "Question is required." });
      return;
    }

    if (options.length < 2) {
      callback?.({ ok: false, error: "At least 2 answer choices are required." });
      return;
    }

    if (!options.some((o) => o.key === correctKey)) {
      callback?.({ ok: false, error: "Correct answer must match one of the choices." });
      return;
    }

    state.phase = "question";
    state.question = question;
    state.options = options;
    state.correctKey = correctKey;
    state.durationSeconds = durationSeconds;
    state.endsAt = Date.now() + durationSeconds * 1000;
    state.lastResults = null;
    leaderboard: null,
    previousLeaderboardRanks: {},
    state.leaderboard = null;

    for (const player of Object.values(state.players)) {
      player.answerKey = null;
      player.answeredAt = null;
    }

    callback?.({ ok: true });
    emitState();
    startTimer();
  });

  socket.on("submitAnswer", (answerKey, callback) => {
    const player = state.players[socket.id];

    if (!player) {
      callback?.({ ok: false, error: "Join as a player first." });
      return;
    }

    if (state.phase !== "question") {
      callback?.({ ok: false, error: "No active question." });
      return;
    }

    if (Date.now() > state.endsAt) {
      lockQuestion();
      callback?.({ ok: false, error: "Time is up." });
      return;
    }

    if (player.answerKey) {
      callback?.({ ok: false, error: "You already answered." });
      return;
    }

    const cleanKey = String(answerKey || "").toUpperCase();
    if (!state.options.some((o) => o.key === cleanKey)) {
      callback?.({ ok: false, error: "Invalid answer choice." });
      return;
    }

    player.answerKey = cleanKey;
    player.answeredAt = Date.now();
    
    callback?.({ ok: true });
    
    const players = Object.values(state.players);
    const everyoneAnswered =
      players.length > 0 && players.every((p) => Boolean(p.answerKey));
    
    if (everyoneAnswered) {
      revealQuestion();
    } else {
      emitState();
    }
  });

  socket.on("revealAnswer", (callback) => {
    if (!socket.rooms.has("admins")) {
      callback?.({ ok: false, error: "Admin only." });
      return;
    }
  
    revealQuestion();
  
    callback?.({ ok: true });
  });

  socket.on("resetLobby", (callback) => {
    if (!socket.rooms.has("admins")) {
      callback?.({ ok: false, error: "Admin only." });
      return;
    }

    clearTimer();

    state.phase = "lobby";
    state.question = "";
    state.options = [];
    state.correctKey = "";
    state.endsAt = null;
    state.lastResults = null;
    state.leaderboard = null;

    for (const player of Object.values(state.players)) {
      player.answerKey = null;
      player.answeredAt = null;
    }

    callback?.({ ok: true });
    emitState();
  });

  socket.on("clearScores", (callback) => {
    if (!socket.rooms.has("admins")) {
      callback?.({ ok: false, error: "Admin only." });
      return;
    }

    for (const player of Object.values(state.players)) {
      player.score = 0;
    }

    callback?.({ ok: true });
    emitState();
  });

  socket.on("disconnect", () => {
    delete state.players[socket.id];
    emitState();
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Quiz site running on port ${PORT}`);
  console.log(`Admin page: /admin.html`);
  console.log(`Default admin password: ${ADMIN_PASSWORD}`);
});
