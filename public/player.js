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
  for (const element of [lobbyView, questionView, lockedView, revealView, leaderboardView]) {
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

  for (const [key, count] of Object.entries(results.counts)) {
    const row = document.createElement("div");
    row.className = key === results.correctKey ? "resultRow correctRow" : "resultRow";
    row.innerHTML = `<strong>${key}</strong><span>${count} answer${count === 1 ? "" : "s"}</span>`;
    resultsList.appendChild(row);
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


function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
