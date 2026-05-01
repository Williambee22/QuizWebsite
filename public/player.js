const socket = io();

const joinCard = document.getElementById("joinCard");
const gameCard = document.getElementById("gameCard");
const joinForm = document.getElementById("joinForm");
const playerName = document.getElementById("playerName");
const joinError = document.getElementById("joinError");

const nameLabel = document.getElementById("nameLabel");
const scoreLabel = document.getElementById("scoreLabel");

const lobbyView = document.getElementById("lobbyView");
const questionView = document.getElementById("questionView");
const lockedView = document.getElementById("lockedView");
const revealView = document.getElementById("revealView");

const timerLabel = document.getElementById("timerLabel");
const timerFill = document.getElementById("timerFill");
const questionText = document.getElementById("questionText");
const optionsGrid = document.getElementById("optionsGrid");
const answerStatus = document.getElementById("answerStatus");
const correctText = document.getElementById("correctText");
const resultsList = document.getElementById("resultsList");
const leaderboardView = document.getElementById("leaderboardView");
const leaderboardList = document.getElementById("leaderboardList");

let joinedName = localStorage.getItem("quizPlayerName") || "";
let myAnswer = null;

if (joinedName) {
  playerName.value = joinedName;
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
  });
});

function showOnly(view) {
  for (const element of [lobbyView, questionView, lockedView, revealView]) {
    element.classList.add("hidden");
  }
  view.classList.remove("hidden");
}

function renderOptions(state) {
  optionsGrid.innerHTML = "";

  for (const option of state.options) {
    const button = document.createElement("button");
    button.className = "optionButton";
    button.disabled = Boolean(myAnswer) || state.phase !== "question";
    button.innerHTML = `<strong>${option.key}</strong><span>${escapeHtml(option.text)}</span>`;

    if (myAnswer === option.key) {
      button.classList.add("selected");
    }

    button.addEventListener("click", () => {
      socket.emit("submitAnswer", option.key, (res) => {
        if (!res.ok) {
          answerStatus.textContent = res.error;
          return;
        }

        myAnswer = option.key;
        answerStatus.textContent = `Answer submitted: ${option.key}`;
      });
    });

    optionsGrid.appendChild(button);
  }
}

function renderResults(results) {
  if (!results) return;

  correctText.textContent = `Correct answer: ${results.correctKey}`;

  resultsList.innerHTML = "";
  for (const [key, count] of Object.entries(results.counts)) {
    const row = document.createElement("div");
    row.className = key === results.correctKey ? "resultRow correctRow" : "resultRow";
    row.innerHTML = `<strong>${key}</strong><span>${count} answer${count === 1 ? "" : "s"}</span>`;
    resultsList.appendChild(row);
  }
}

socket.on("state", (state) => {
  const me = state.players.find((p) => p.name === joinedName);
  if (me) {
    scoreLabel.textContent = me.score;
  }

  if (state.phase === "lobby") {
    myAnswer = null;
    showOnly(lobbyView);
    return;
  }

  if (state.phase === "question") {
    if (!state.players.some((p) => p.name === joinedName && p.hasAnswered)) {
      myAnswer = null;
    }

    showOnly(questionView);
    questionText.textContent = state.question;

    const secondsLeft = Math.max(0, state.timeLeftMs / 1000);
    timerLabel.textContent = secondsLeft.toFixed(1);

    const pct = state.durationSeconds > 0
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
    return;
  }

  if (state.phase === "locked") {
    showOnly(lockedView);
    return;
  }

  if (state.phase === "reveal") {
    showOnly(revealView);
    renderResults(state.lastResults);
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
