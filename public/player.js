const socket = io();

const joinCard = document.getElementById("joinCard");
const gameCard = document.getElementById("gameCard");
const joinForm = document.getElementById("joinForm");
const playerName = document.getElementById("playerName");
const joinError = document.getElementById("joinError");

const nameLabel = document.getElementById("nameLabel");
const scoreLabel = document.getElementById("scoreLabel");

const lobbyView = document.getElementById("lobbyView");
const countdownView = document.getElementById("countdownView");
const questionView = document.getElementById("questionView");
const lockedView = document.getElementById("lockedView");
const revealView = document.getElementById("revealView");
const leaderboardView = document.getElementById("leaderboardView");
const finalResultsView = document.getElementById("finalResultsView");

const timerLabel = document.getElementById("timerLabel");
const timerFill = document.getElementById("timerFill");
const questionText = document.getElementById("questionText");
const optionsGrid = document.getElementById("optionsGrid");
const answerStatus = document.getElementById("answerStatus");
const correctText = document.getElementById("correctText");
const resultsList = document.getElementById("resultsList");
const leaderboardList = document.getElementById("leaderboardList");
const finalResultsList = document.getElementById("finalResultsList");

const countdownNumber = document.getElementById("countdownNumber");
const countdownQuestionText = document.getElementById("countdownQuestionText");


const musicVolume = document.getElementById("musicVolume");

const lobbyMusic = new Audio("/lobby-music.mp3");
lobbyMusic.loop = true;
lobbyMusic.volume = Number(localStorage.getItem("quizMusicVolume") ?? 35) / 100;

let joinedName = localStorage.getItem("quizPlayerName") || "";
let myAnswer = null;
let lastRenderedQuestionKey = "";

if (joinedName) {
  playerName.value = joinedName;
}

if (musicVolume) {
  musicVolume.value = String(Math.round(lobbyMusic.volume * 100));

  musicVolume.addEventListener("input", () => {
    const volume = Number(musicVolume.value) / 100;
    lobbyMusic.volume = volume;
    localStorage.setItem("quizMusicVolume", String(musicVolume.value));
  });
}

function playLobbyMusic() {
  if (!joinedName) return;

  lobbyMusic.play().catch(() => {
    // Browser blocked autoplay. It should work after the player clicks Join.
  });
}

function stopLobbyMusic() {
  lobbyMusic.pause();
  lobbyMusic.currentTime = 0;
}

joinForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const name = playerName.value.trim();

  socket.emit("joinPlayer", name, (res) => {
    if (!res.ok) {
      joinError.textContent = res.error;
      return;
    }

    joinedName = name;
    localStorage.setItem("quizPlayerName", name);
    nameLabel.textContent = name;
    joinCard.classList.add("hidden");
    gameCard.classList.remove("hidden");

    playLobbyMusic();
  });
});

function showOnly(view) {
  const views = [
    lobbyView,
    countdownView,
    questionView,
    lockedView,
    revealView,
    leaderboardView,
    finalResultsView,
  ];

  for (const element of views) {
    if (element) {
      element.classList.add("hidden");
    }
  }

  if (view) {
    view.classList.remove("hidden");
  }
}

function getQuestionRenderKey(state) {
  return JSON.stringify({
    question: state.question || "",
    options: state.options || [],
  });
}

function renderOptions(state, force = false) {
  const renderKey = getQuestionRenderKey(state);

  if (!force && renderKey === lastRenderedQuestionKey) {
    return;
  }

  lastRenderedQuestionKey = renderKey;
  optionsGrid.innerHTML = "";

  for (const option of state.options || []) {
    const button = document.createElement("button");
    button.className = "optionButton";
    button.dataset.answerKey = option.key;
    button.disabled = Boolean(myAnswer) || state.phase !== "question";
    button.innerHTML = `<strong>${option.key}</strong><span>${escapeHtml(option.text)}</span>`;

    if (myAnswer === option.key) {
      button.classList.add("selected");
    }

    button.addEventListener("click", () => {
      if (myAnswer) return;

      button.disabled = true;
      answerStatus.textContent = `Submitting ${option.key}...`;

      socket.emit("submitAnswer", option.key, (res) => {
        if (!res.ok) {
          button.disabled = false;
          answerStatus.textContent = res.error;
          return;
        }

        myAnswer = option.key;
        answerStatus.textContent = `Answer submitted: ${option.key}`;

        for (const btn of optionsGrid.querySelectorAll(".optionButton")) {
          btn.disabled = true;
          btn.classList.toggle("selected", btn.dataset.answerKey === option.key);
        }
      });
    });

    optionsGrid.appendChild(button);
  }
}

function renderCountdownQuestion(state) {
  if (countdownQuestionText) {
    countdownQuestionText.textContent = state.question || "";
  }
}

function renderResults(results) {
  if (!results) return;

  const myResult = results.players?.find((p) => p.name === joinedName);

  if (myResult) {
    if (myResult.correct) {
      correctText.innerHTML = `
        <span class="correct">Correct!</span><br>
        You earned <strong>${myResult.pointsEarned || 0}</strong> points.
        <br>
        <span class="muted">
          Base: ${myResult.basePoints || 0} |
          Speed: +${myResult.speedBonus || 0} |
          Streak: +${myResult.streakBonus || 0}
        </span>
      `;
    } else {
      correctText.innerHTML = `
        <span class="wrong">Wrong.</span><br>
        Correct answer: <strong>${results.correctKey}</strong>
        <br>
        <span class="muted">You earned 0 points. Your streak was reset.</span>
      `;
    }
  } else {
    correctText.textContent = `Correct answer: ${results.correctKey}`;
  }

  resultsList.innerHTML = "";

  for (const [key, count] of Object.entries(results.counts || {})) {
    const row = document.createElement("div");
    row.className = key === results.correctKey ? "resultRow correctRow" : "resultRow";
    row.innerHTML = `<strong>${key}</strong><span>${count} answer${count === 1 ? "" : "s"}</span>`;
    resultsList.appendChild(row);
  }
}

function updateOptionButtonState(state) {
  for (const button of optionsGrid.querySelectorAll(".optionButton")) {
    const key = button.dataset.answerKey;
    button.disabled = Boolean(myAnswer) || state.phase !== "question";
    button.classList.toggle("selected", myAnswer === key);
  }
}


function renderLeaderboard(leaderboard) {
  leaderboardList.innerHTML = "";

  const entries = leaderboard?.topFive || [];

  if (entries.length === 0) {
    leaderboardList.innerHTML = `<p class="muted">No players yet.</p>`;
    return;
  }

  for (const entry of entries) {
    const row = document.createElement("div");
    row.className = `leaderboardRow move-${entry.movement}`;

    let movementText = "—";

    if (entry.movement === "up") {
      movementText = `▲ ${entry.movementAmount}`;
    } else if (entry.movement === "down") {
      movementText = `▼ ${entry.movementAmount}`;
    } else if (entry.movement === "new") {
      movementText = "NEW";
    }

    row.innerHTML = `
      <div class="leaderboardRank">#${entry.rank}</div>
      <div class="leaderboardName">${escapeHtml(entry.name)}</div>
      <div class="leaderboardScore">${entry.score} pts</div>
      <div class="leaderboardMove">${movementText}</div>
    `;

    leaderboardList.appendChild(row);
  }
}

function renderFinalResults(finalResults) {
  if (!finalResultsList) return;

  finalResultsList.innerHTML = "";

  const entries = finalResults?.revealedEntries || [];

  if (entries.length === 0) {
    finalResultsList.innerHTML = `<p class="muted">Final results starting...</p>`;
    return;
  }

  for (const entry of entries) {
    const row = document.createElement("div");

    let medalClass = "";
    let medalText = "";

    if (entry.rank === 1) {
      medalClass = "final-gold";
      medalText = "Gold";
    } else if (entry.rank === 2) {
      medalClass = "final-silver";
      medalText = "Silver";
    } else if (entry.rank === 3) {
      medalClass = "final-bronze";
      medalText = "Bronze";
    }

    row.className = `finalResultRow ${medalClass}`;
    row.innerHTML = `
      <div class="finalPlacement">#${entry.rank}</div>
      <div class="finalName">${escapeHtml(entry.name)}</div>
      <div class="finalScore">${entry.score} pts</div>
      <div class="finalMedal">${medalText}</div>
    `;

    finalResultsList.appendChild(row);
  }
}


socket.on("state", (state) => {
  const me = state.players.find((p) => p.name === joinedName);

  if (me) {
    scoreLabel.textContent = me.score;
  }

  if (state.phase === "lobby") {
    myAnswer = null;
    lastRenderedQuestionKey = "";
    showOnly(lobbyView);
    playLobbyMusic();
    return;
  }

  if (state.phase === "countdown") {
    stopLobbyMusic();
    myAnswer = null;
    lastRenderedQuestionKey = "";
    showOnly(countdownView);
  
    renderCountdownQuestion(state);
  
    const secondsLeft = Math.max(0, state.countdownLeftMs / 1000);
    const displayNumber = Math.max(1, Math.ceil(secondsLeft));
  
    if (countdownNumber) {
      countdownNumber.textContent = String(displayNumber);
  
      countdownNumber.classList.remove("countdownPulse");
      void countdownNumber.offsetWidth;
      countdownNumber.classList.add("countdownPulse");
    }
  
    return;
  }

  if (state.phase === "question") {
    stopLobbyMusic();

    if (!state.players.some((p) => p.name === joinedName && p.hasAnswered)) {
      myAnswer = null;
    }

    showOnly(questionView);
    questionText.textContent = state.question;

    const secondsLeft = Math.max(0, state.timeLeftMs / 1000);
    timerLabel.textContent = secondsLeft.toFixed(1);

    const pct =
      state.durationSeconds > 0
        ? Math.max(0, Math.min(100, (secondsLeft / state.durationSeconds) * 100))
        : 0;

    timerFill.style.width = `${pct}%`;

    const myPlayer = state.players.find((p) => p.name === joinedName);

    if (myPlayer?.answerKey) {
      myAnswer = myPlayer.answerKey;
      answerStatus.textContent = `Answer submitted: ${myAnswer}`;
    } else {
      answerStatus.textContent = "Choose one answer.";
    }

    renderOptions(state);
    updateOptionButtonState(state);
    return;
  }

  if (state.phase === "locked") {
    stopLobbyMusic();
    showOnly(lockedView);
    return;
  }

  if (state.phase === "reveal") {
    stopLobbyMusic();
    showOnly(revealView);
    renderResults(state.lastResults);
    return;
  }

  if (state.phase === "leaderboard") {
    stopLobbyMusic();
    showOnly(leaderboardView);
    renderLeaderboard(state.leaderboard);
    return;
  }

  if (state.phase === "finalResults") {
    stopLobbyMusic();
    showOnly(finalResultsView);
    renderFinalResults(state.finalResults);
    return;
  }
  
});

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
