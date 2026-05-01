const socket = io();

const loginCard = document.getElementById("loginCard");
const adminCard = document.getElementById("adminCard");
const loginForm = document.getElementById("loginForm");
const password = document.getElementById("password");
const loginError = document.getElementById("loginError");

const questionForm = document.getElementById("questionForm");
const question = document.getElementById("question");
const duration = document.getElementById("duration");
const correctKey = document.getElementById("correctKey");
const optionInputs = document.getElementById("optionInputs");
const addOptionBtn = document.getElementById("addOptionBtn");
const adminError = document.getElementById("adminError");

const revealBtn = document.getElementById("revealBtn");
const resetBtn = document.getElementById("resetBtn");
const clearScoresBtn = document.getElementById("clearScoresBtn");

const phaseLabel = document.getElementById("phaseLabel");
const timeLeftLabel = document.getElementById("timeLeftLabel");
const answeredLabel = document.getElementById("answeredLabel");
const playersList = document.getElementById("playersList");
const countsList = document.getElementById("countsList");

const keys = ["A", "B", "C", "D", "E", "F"];

function addOptionInput(value = "") {
  const currentCount = optionInputs.querySelectorAll("input").length;
  if (currentCount >= 6) return;

  const key = keys[currentCount];
  const wrap = document.createElement("label");
  wrap.className = "answerInput";
  wrap.innerHTML = `<span>${key}</span><input placeholder="Answer ${key}" value="${escapeHtml(value)}" />`;
  optionInputs.appendChild(wrap);
}

for (let i = 0; i < 4; i++) addOptionInput();

addOptionBtn.addEventListener("click", () => addOptionInput());

loginForm.addEventListener("submit", (event) => {
  event.preventDefault();

  socket.emit("adminLogin", password.value, (res) => {
    if (!res.ok) {
      loginError.textContent = res.error;
      return;
    }

    loginCard.classList.add("hidden");
    adminCard.classList.remove("hidden");
  });
});

questionForm.addEventListener("submit", (event) => {
  event.preventDefault();
  adminError.textContent = "";

  const options = [...optionInputs.querySelectorAll("input")].map((input) => input.value);

  socket.emit(
    "startQuestion",
    {
      question: question.value,
      options,
      correctKey: correctKey.value,
      durationSeconds: Number(duration.value || 15),
    },
    (res) => {
      if (!res.ok) {
        adminError.textContent = res.error;
      }
    }
  );
});

revealBtn.addEventListener("click", () => {
  socket.emit("revealAnswer", (res) => {
    if (!res.ok) adminError.textContent = res.error;
  });
});

resetBtn.addEventListener("click", () => {
  socket.emit("resetLobby", (res) => {
    if (!res.ok) adminError.textContent = res.error;
  });
});

clearScoresBtn.addEventListener("click", () => {
  socket.emit("clearScores", (res) => {
    if (!res.ok) adminError.textContent = res.error;
  });
});

socket.on("adminState", renderAdminState);

function renderAdminState(state) {
  phaseLabel.textContent = state.phase;
  timeLeftLabel.textContent = (state.timeLeftMs / 1000).toFixed(1);

  const answered = state.players.filter((p) => p.hasAnswered).length;
  answeredLabel.textContent = `${answered} / ${state.players.length}`;

  playersList.innerHTML = "";
  for (const player of state.players.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))) {
    const row = document.createElement("div");
    row.className = "playerRow";
    row.innerHTML = `
      <strong>${escapeHtml(player.name)}</strong>
      <span>Score: ${player.score}</span>
      <span>${player.hasAnswered ? `Answered ${player.answerKey}` : "Waiting"}</span>
    `;
    playersList.appendChild(row);
  }

  countsList.innerHTML = "";
  const counts = {};
  for (const option of state.options || []) counts[option.key] = 0;

  for (const player of state.players) {
    if (player.answerKey) counts[player.answerKey] = (counts[player.answerKey] || 0) + 1;
  }

  for (const [key, count] of Object.entries(counts)) {
    const row = document.createElement("div");
    row.className = key === state.correctKey ? "resultRow correctRow" : "resultRow";
    row.innerHTML = `<strong>${key}</strong><span>${count}</span>`;
    countsList.appendChild(row);
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