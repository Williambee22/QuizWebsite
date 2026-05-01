const express = require("express");
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "crownsucks67";

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const PRESETS_FILE = path.join(DATA_DIR, "question-presets.json");

fs.mkdirSync(DATA_DIR, { recursive: true });

function loadQuestionPresets() {
  try {
    if (!fs.existsSync(PRESETS_FILE)) {
      fs.writeFileSync(PRESETS_FILE, "[]", "utf8");
      return [];
    }

    const raw = fs.readFileSync(PRESETS_FILE, "utf8");
    const parsed = JSON.parse(raw);

    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error("Failed to load question presets:", err);
    return [];
  }
}

function saveQuestionPresets(presets) {
  fs.writeFileSync(PRESETS_FILE, JSON.stringify(presets, null, 2), "utf8");
}

let questionPresets = loadQuestionPresets();

app.use(express.static("public"));

/**
 * Server is the single source of truth.
 * Everyone sees the same quiz state because every change is emitted from here.
 */
const state = {
  phase: "lobby", // lobby | countdown | question | reveal | leaderboard | finalResults
  question: "",
  options: [],
  correctKey: "",
  durationSeconds: 15,
  endsAt: null,

  countdownEndsAt: null,
  countdownSeconds: 3,
  pendingQuestion: null,

  players: {},
  lastResults: null,
  leaderboard: null,
  previousLeaderboardRanks: {},
  questionScored: false,
  questionStartedAt: null,
  finalResults: null,
};

let timerInterval = null;

function publicState() {
  const now = Date.now();

  const timeLeftMs =
    state.phase === "question" && state.endsAt
      ? Math.max(0, state.endsAt - now)
      : 0;

  const countdownLeftMs =
    state.phase === "countdown" && state.countdownEndsAt
      ? Math.max(0, state.countdownEndsAt - now)
      : 0;

  return {
    phase: state.phase,
    question: state.phase === "countdown" && state.pendingQuestion
      ? state.pendingQuestion.question
      : state.question,
    
    options: state.phase === "countdown" && state.pendingQuestion
      ? state.pendingQuestion.options
      : state.options,
    durationSeconds: state.durationSeconds,
    timeLeftMs,
    countdownLeftMs,
    countdownSeconds: state.countdownSeconds,
    players: Object.values(state.players).map((p) => ({
      id: p.id,
      name: p.name,
      answerKey: p.answerKey,
      hasAnswered: Boolean(p.answerKey),
      score: p.score || 0,
      correctStreak: p.correctStreak || 0,
      lastPointsEarned: p.lastPointsEarned || 0,
      lastBasePoints: p.lastBasePoints || 0,
      lastSpeedBonus: p.lastSpeedBonus || 0,
      lastStreakBonus: p.lastStreakBonus || 0,
      lastCorrect: Boolean(p.lastCorrect),
    })),
    lastResults: state.lastResults,
    leaderboard: state.leaderboard,
    finalResults: state.finalResults,
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
      correctStreak: p.correctStreak || 0,
      lastPointsEarned: p.lastPointsEarned || 0,
      lastBasePoints: p.lastBasePoints || 0,
      lastSpeedBonus: p.lastSpeedBonus || 0,
      lastStreakBonus: p.lastStreakBonus || 0,
      lastCorrect: Boolean(p.lastCorrect),
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
      correctStreak: p.correctStreak || 0,
      pointsEarned: p.lastPointsEarned || 0,
      basePoints: p.lastBasePoints || 0,
      speedBonus: p.lastSpeedBonus || 0,
      streakBonus: p.lastStreakBonus || 0,
    })),
  };
}

function getStreakBonus(streak) {
  if (streak >= 5) return 500;
  if (streak === 4) return 300;
  if (streak === 3) return 200;
  if (streak === 2) return 100;
  return 0;
}

function getSpeedBonus(answeredAt) {
  if (!state.questionStartedAt || !answeredAt) return 0;

  const elapsedMs = Math.max(0, answeredAt - state.questionStartedAt);

  // Bonus only exists for the first 5 seconds.
  if (elapsedMs >= 5000) return 0;

  // Per .1 second:
  // 0.0s = 100
  // 0.1s = 98
  // 1.0s = 80
  // 4.8s = 4
  // 5.0s = 0
  const elapsedTenths = Math.floor(elapsedMs / 100);
  return Math.max(0, 100 - elapsedTenths * 2);
}

function revealQuestion() {
  clearTimer();

  if (state.phase === "reveal") {
    emitState();
    return;
  }

  if (!state.questionScored) {
    for (const player of Object.values(state.players)) {
      const wasCorrect = player.answerKey === state.correctKey;

      player.lastPointsEarned = 0;
      player.lastBasePoints = 0;
      player.lastSpeedBonus = 0;
      player.lastStreakBonus = 0;
      player.lastCorrect = wasCorrect;

      if (wasCorrect) {
        player.correctStreak = (player.correctStreak || 0) + 1;

        const basePoints = 1000;
        const speedBonus = getSpeedBonus(player.answeredAt);
        const streakBonus = getStreakBonus(player.correctStreak);
        const totalPoints = basePoints + speedBonus + streakBonus;

        player.lastBasePoints = basePoints;
        player.lastSpeedBonus = speedBonus;
        player.lastStreakBonus = streakBonus;
        player.lastPointsEarned = totalPoints;

        player.score = (player.score || 0) + totalPoints;
      } else {
        player.correctStreak = 0;
      }
    }

    state.questionScored = true;
  }

  state.phase = "reveal";
  state.endsAt = null;
  state.countdownEndsAt = null;
  state.pendingQuestion = null;
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

function beginQuestionNow() {
  if (!state.pendingQuestion) return;

  const pending = state.pendingQuestion;

  state.phase = "question";
  state.question = pending.question;
  state.options = pending.options;
  state.correctKey = pending.correctKey;
  state.durationSeconds = pending.durationSeconds;
  state.questionStartedAt = Date.now();
  state.endsAt = state.questionStartedAt + pending.durationSeconds * 1000;
  state.countdownEndsAt = null;
  state.pendingQuestion = null;
  state.lastResults = null;
  state.leaderboard = null;
  state.questionScored = false;

  emitState();
  startTimer();
}

function startCountdown() {
  clearTimer();

  state.phase = "countdown";
  state.countdownSeconds = 3;
  state.countdownEndsAt = Date.now() + state.countdownSeconds * 1000;

  timerInterval = setInterval(() => {
    if (state.phase !== "countdown" || !state.countdownEndsAt) {
      clearTimer();
      return;
    }

    if (Date.now() >= state.countdownEndsAt) {
      clearTimer();
      beginQuestionNow();
      return;
    }

    emitState();
  }, 100);

  emitState();
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

function buildFinalResultsEntries() {
  return Object.values(state.players)
    .map((p) => ({
      id: p.id,
      name: p.name,
      score: p.score || 0,
      correctStreak: p.correctStreak || 0,
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.name.localeCompare(b.name);
    })
    .map((player, index) => ({
      ...player,
      rank: index + 1,
    }));
}

function getFinalRevealDelay(nextEntry) {
  if (!nextEntry) return 0;

  // Delay before revealing 3rd place.
  if (nextEntry.rank === 3) return 3000;

  // Delay before revealing 2nd and 1st place.
  if (nextEntry.rank === 2) return 4000;
  if (nextEntry.rank === 1) return 4000;

  // Normal reveal speed.
  return 1000;
}

function revealNextFinalResult() {
  if (state.phase !== "finalResults" || !state.finalResults) {
    clearTimer();
    return;
  }

  const revealOrder = state.finalResults.revealOrder;

  if (state.finalResults.revealedCount >= revealOrder.length) {
    state.finalResults.complete = true;
    clearTimer();
    emitState();
    return;
  }

  state.finalResults.revealedCount += 1;
  state.finalResults.revealedEntries = revealOrder.slice(
    0,
    state.finalResults.revealedCount
  );

  const nextEntry = revealOrder[state.finalResults.revealedCount];

  if (!nextEntry) {
    state.finalResults.complete = true;
    clearTimer();
    emitState();
    return;
  }

  const delay = getFinalRevealDelay(nextEntry);

  emitState();

  timerInterval = setTimeout(() => {
    revealNextFinalResult();
  }, delay);
}

function startFinalResultsReveal() {
  clearTimer();

  const rankedEntries = buildFinalResultsEntries();

  // Reveal from bottom to top.
  const revealOrder = [...rankedEntries].reverse();

  state.phase = "finalResults";
  state.endsAt = null;
  state.countdownEndsAt = null;
  state.pendingQuestion = null;
  state.leaderboard = null;

  state.finalResults = {
    rankedEntries,
    revealOrder,
    revealedEntries: [],
    revealedCount: 0,
    complete: false,
    startedAt: Date.now(),
  };

  emitState();

  // First placement appears immediately.
  revealNextFinalResult();
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
      correctStreak: 0,
      lastPointsEarned: 0,
      lastBasePoints: 0,
      lastSpeedBonus: 0,
      lastStreakBonus: 0,
      lastCorrect: false,
    };

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
    const durationSeconds = Math.max(
      5,
      Math.min(120, Number(payload?.durationSeconds || 15))
    );

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

    state.pendingQuestion = {
      question,
      options,
      correctKey,
      durationSeconds,
    };

    state.question = "";
    state.options = [];
    state.correctKey = "";
    state.durationSeconds = durationSeconds;
    state.endsAt = null;
    state.countdownEndsAt = null;
    state.questionStartedAt = null;
    state.lastResults = null;
    state.leaderboard = null;
    state.questionScored = false;
    state.finalResults = null;

    for (const player of Object.values(state.players)) {
      player.answerKey = null;
      player.answeredAt = null;
      player.lastPointsEarned = 0;
      player.lastBasePoints = 0;
      player.lastSpeedBonus = 0;
      player.lastStreakBonus = 0;
      player.lastCorrect = false;
    }

    callback?.({ ok: true });
    startCountdown();
  });

  socket.on("showFinalResults", (callback) => {
    if (!socket.rooms.has("admins")) {
      callback?.({ ok: false, error: "Admin only." });
      return;
    }
  
    startFinalResultsReveal();
  
    callback?.({ ok: true });
  });

  
  socket.on("getQuestionPresets", (callback) => {
    if (!socket.rooms.has("admins")) {
      callback?.({ ok: false, error: "Admin only." });
      return;
    }
  
    callback?.({
      ok: true,
      presets: questionPresets,
    });
  });
  
  socket.on("saveQuestionPreset", (payload, callback) => {
    if (!socket.rooms.has("admins")) {
      callback?.({ ok: false, error: "Admin only." });
      return;
    }
  
    const title = String(payload?.title || "").trim().slice(0, 80);
    const question = String(payload?.question || "").trim();
    const options = normalizeOptions(payload?.options || []);
    const correctKey = String(payload?.correctKey || "").trim().toUpperCase();
    const durationSeconds = Math.max(
      5,
      Math.min(120, Number(payload?.durationSeconds || 15))
    );
  
    if (!title) {
      callback?.({ ok: false, error: "Preset title is required." });
      return;
    }
  
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
  
    const preset = {
      id: crypto.randomUUID(),
      title,
      question,
      options: options.map((o) => o.text),
      correctKey,
      durationSeconds,
      createdAt: Date.now(),
    };
  
    questionPresets.push(preset);
    saveQuestionPresets(questionPresets);
  
    callback?.({
      ok: true,
      preset,
      presets: questionPresets,
    });
  });
  
  socket.on("deleteQuestionPreset", (presetId, callback) => {
    if (!socket.rooms.has("admins")) {
      callback?.({ ok: false, error: "Admin only." });
      return;
    }
  
    const id = String(presetId || "");
    const beforeCount = questionPresets.length;
  
    questionPresets = questionPresets.filter((preset) => preset.id !== id);
  
    if (questionPresets.length === beforeCount) {
      callback?.({ ok: false, error: "Preset not found." });
      return;
    }
  
    saveQuestionPresets(questionPresets);
  
    callback?.({
      ok: true,
      presets: questionPresets,
    });
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
      revealQuestion();
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

  socket.on("showLeaderboard", (callback) => {
    if (!socket.rooms.has("admins")) {
      callback?.({ ok: false, error: "Admin only." });
      return;
    }

    clearTimer();

    state.phase = "leaderboard";
    state.endsAt = null;
    state.countdownEndsAt = null;
    state.pendingQuestion = null;
    state.leaderboard = buildLeaderboard();
    state.finalResults = null;

    callback?.({ ok: true });
    emitState();
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
    state.countdownEndsAt = null;
    state.pendingQuestion = null;
    state.questionStartedAt = null;
    state.lastResults = null;
    state.leaderboard = null;
    state.previousLeaderboardRanks = {};
    state.questionScored = false;

    for (const player of Object.values(state.players)) {
      player.answerKey = null;
      player.answeredAt = null;
      player.score = 0;
      player.correctStreak = 0;
      player.lastPointsEarned = 0;
      player.lastBasePoints = 0;
      player.lastSpeedBonus = 0;
      player.lastStreakBonus = 0;
      player.lastCorrect = false;
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
      player.correctStreak = 0;
      player.lastPointsEarned = 0;
      player.lastBasePoints = 0;
      player.lastSpeedBonus = 0;
      player.lastStreakBonus = 0;
      player.lastCorrect = false;
    }

    state.previousLeaderboardRanks = {};
    state.leaderboard = null;
    state.finalResults = null;

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
