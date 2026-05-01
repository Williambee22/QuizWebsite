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
const leaderboardBtn = document.getElementById("leaderboardBtn");

const phaseLabel = document.getElementById("phaseLabel");
const timeLeftLabel = document.getElementById("timeLeftLabel");
const answeredLabel = document.getElementById("answeredLabel");
const playersList = document.getElementById("playersList");
const countsList = document.getElementById("countsList");

const presetQuestionsList = document.getElementById("presetQuestionsList");
const savePresetForm = document.getElementById("savePresetForm");
const presetTitle = document.getElementById("presetTitle");
const finalResultsBtn = document.getElementById("finalResultsBtn");
const countdownDuration = document.getElementById("countdownDuration");

const keys = ["A", "B", "C", "D", "E", "F"];

let savedPresets = [];

function addOptionInput(value = "") {
  const currentCount = optionInputs.querySelectorAll("input").length;
  if (currentCount >= 6) return;

  const key = keys[currentCount];
  const wrap = document.createElement("label");
  wrap.className = "answerInput";
  wrap.innerHTML = `<span>${key}</span><input placeholder="Answer ${key}" value="${escapeHtml(value)}" />`;
  optionInputs.appendChild(wrap);
}

function clearOptionInputs() {
  optionInputs.innerHTML = "";
}

function preloadQuestion(preset) {
  question.value = preset.question;
  duration.value = preset.durationSeconds || 15;
  correctKey.value = preset.correctKey;
  countdownDuration.value = preset.countdownSeconds ?? 3;

  clearOptionInputs();

  for (const optionText of preset.options.slice(0, 6)) {
    addOptionInput(optionText);
  }

  adminError.textContent = "";
}

function renderPresetQuestions() {
  if (!presetQuestionsList) return;

  presetQuestionsList.innerHTML = "";

  if (savedPresets.length === 0) {
    presetQuestionsList.innerHTML = `<p class="muted">No saved questions yet.</p>`;
    return;
  }

  for (const preset of savedPresets) {
    const row = document.createElement("div");
    row.className = "presetQuestionRow";

    const loadButton = document.createElement("button");
    loadButton.type = "button";
    loadButton.className = "presetQuestionButton";
    loadButton.innerHTML = `
      <strong>${escapeHtml(preset.title)}</strong>
      <span>${escapeHtml(preset.question)}</span>
    `;

    loadButton.addEventListener("click", () => {
      preloadQuestion(preset);
    });

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "danger presetDeleteButton";
    deleteButton.textContent = "Delete";

    deleteButton.addEventListener("click", () => {
      socket.emit("deleteQuestionPreset", preset.id, (res) => {
        if (!res.ok) {
          adminError.textContent = res.error;
          return;
        }

        savedPresets = res.presets || [];
        renderPresetQuestions();
      });
    });

    row.appendChild(loadButton);
    row.appendChild(deleteButton);
    presetQuestionsList.appendChild(row);
  }
}

function loadSavedPresets() {
  socket.emit("getQuestionPresets", (res) => {
    if (!res.ok) {
      adminError.textContent = res.error;
      return;
    }

    savedPresets = res.presets || [];
    renderPresetQuestions();
  });
}

for (let i = 0; i < 4; i++) addOptionInput();

addOptionBtn.addEventListener("click", () => addOptionInput());

if (savePresetForm) {
  savePresetForm.addEventListener("submit", (event) => {
    event.preventDefault();
    adminError.textContent = "";

    const options = [...optionInputs.querySelectorAll("input")].map((input) => input.value);

    socket.emit(
      "saveQuestionPreset",
      {
        title: presetTitle.value,
        question: question.value,
        options,
        correctKey: correctKey.value,
        durationSeconds: Number(duration.value || 15),
        countdownSeconds: Number(countdownDuration.value || 3),
      },
      (res) => {
        if (!res.ok) {
          adminError.textContent = res.error;
          return;
        }

        savedPresets = res.presets || [];
        presetTitle.value = "";
        renderPresetQuestions();
      }
    );
  });
}

loginForm.addEventListener("submit", (event) => {
  event.preventDefault();

  socket.emit("adminLogin", password.value, (res) => {
    if (!res.ok) {
      loginError.textContent = res.error;
      return;
    }

    loginCard.classList.add("hidden");
    adminCard.classList.remove("hidden");
    loadSavedPresets();
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
      countdownSeconds: Number(countdownDuration.value || 3),
    },
    (res) => {
      if (!res.ok) {
        adminError.textContent = res.error;
      }
    }
  );
});

finalResultsBtn.addEventListener("click", () => {
  socket.emit("showFinalResults", (res) => {
    if (!res.ok) adminError.textContent = res.error;
  });
});


leaderboardBtn.addEventListener("click", () => {
  socket.emit("showLeaderboard", (res) => {
    if (!res.ok) adminError.textContent = res.error;
  });
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

  if (state.phase === "countdown") {
    timeLeftLabel.textContent = `${(state.countdownLeftMs / 1000).toFixed(1)} countdown`;
  } else {
    timeLeftLabel.textContent = (state.timeLeftMs / 1000).toFixed(1);
  }

  const answered = state.players.filter((p) => p.hasAnswered).length;
  answeredLabel.textContent = `${answered} / ${state.players.length}`;

  playersList.innerHTML = "";

  for (const player of state.players.sort(
    (a, b) => b.score - a.score || a.name.localeCompare(b.name)
  )) {
    const row = document.createElement("div");
    row.className = "playerRow";
    row.innerHTML = `
      <strong>${escapeHtml(player.name)}</strong>
      <span>Score: ${player.score}</span>
      <span>Streak: ${player.correctStreak || 0}</span>
      <span>${player.hasAnswered ? `Answered ${player.answerKey}` : "Waiting"}</span>
    `;
    playersList.appendChild(row);
  }

  countsList.innerHTML = "";

  const counts = {};
  for (const option of state.options || []) {
    counts[option.key] = 0;
  }

  for (const player of state.players) {
    if (player.answerKey) {
      counts[player.answerKey] = (counts[player.answerKey] || 0) + 1;
    }
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
