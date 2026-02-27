const loginView = document.getElementById("loginView");
const appView = document.getElementById("appView");
const loginForm = document.getElementById("loginForm");
const loginError = document.getElementById("loginError");
const logoutBtn = document.getElementById("logoutBtn");
const addEventBtn = document.getElementById("addEventBtn");
const eventsStrip = document.getElementById("eventsStrip");
const eventModal = document.getElementById("eventModal");
const eventForm = document.getElementById("eventForm");
const cancelEventBtn = document.getElementById("cancelEventBtn");
const eventError = document.getElementById("eventError");
const priceValue = document.getElementById("priceValue");
const pointsBalance = document.getElementById("pointsBalance");
const passwordForm = document.getElementById("passwordForm");
const passwordError = document.getElementById("passwordError");
const adminPanel = document.getElementById("adminPanel");
const adminUserForm = document.getElementById("adminUserForm");
const adminUserError = document.getElementById("adminUserError");
const leaderboardList = document.getElementById("leaderboardList");
const leaderboardTab = document.getElementById("leaderboardTab");

let authToken = localStorage.getItem("token");
let currentUser = null;
let eventsCache = [];
let userBets = [];
let leaderboardCache = [];
let refreshTimer = null;
let lastResolvedWins = new Set();
let confettiCanvas = null;
let confettiActive = false;
let hasRenderedEvents = false;
const SEEN_WINS_KEY = "seenWins";
const SEEN_INIT_KEY = "seenWinsInitialized";

const loadSeenWins = () => {
  try {
    const raw = localStorage.getItem(SEEN_WINS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed);
  } catch (err) {
    return new Set();
  }
};

const saveSeenWins = (set) => {
  localStorage.setItem(SEEN_WINS_KEY, JSON.stringify([...set]));
};

lastResolvedWins = loadSeenWins();

const apiFetch = async (path, options = {}) => {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }
  const response = await fetch(path, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Request failed");
  }
  return payload;
};

const showLogin = () => {
  loginView.classList.remove("hidden");
  appView.classList.add("hidden");
};

const showApp = () => {
  loginView.classList.add("hidden");
  appView.classList.remove("hidden");
};

const setError = (el, message) => {
  el.textContent = message || "";
};

const loadMe = async () => {
  try {
    currentUser = await apiFetch("/api/me");
    pointsBalance.textContent = currentUser.points;
    adminPanel.classList.toggle("hidden", !currentUser.is_admin);
    showApp();
    await refreshEvents();
    await refreshLeaderboardIfVisible();
    if (!refreshTimer) {
      refreshTimer = setInterval(refreshEvents, 8000);
    }
  } catch (err) {
    authToken = null;
    localStorage.removeItem("token");
    showLogin();
  }
};

const refreshEvents = async () => {
  const data = await apiFetch("/api/events");
  eventsCache = (data.events || []).sort((a, b) => {
    const aTime = Date.parse(a.created_at || 0);
    const bTime = Date.parse(b.created_at || 0);
    return bTime - aTime;
  });
  userBets = data.userBets || [];
  renderEvents();
  const me = await apiFetch("/api/me");
  currentUser = me;
  pointsBalance.textContent = me.points;
  await refreshLeaderboardIfVisible();
};

const renderEvents = () => {
  eventsStrip.innerHTML = "";
  if (!eventsCache.length) {
    const empty = document.createElement("div");
    empty.className = "event-card";
    empty.innerHTML = "<h4>No events yet</h4><p>Post the first event to get the market moving.</p>";
    eventsStrip.appendChild(empty);
    return;
  }

  const winsThisRender = new Set();

  eventsCache.forEach((event) => {
    const card = document.createElement("div");
    card.className = "event-card";
    if (!hasRenderedEvents) {
      card.classList.add("animate");
    }
    const userBet = userBets.find((bet) => bet.event_id === event.id);
    const statusBadge = event.status === "resolved"
      ? `Resolved: ${event.outcome.toUpperCase()}`
      : event.status === "closed"
        ? "Closed"
        : "Open";

    card.innerHTML = `
      <div>
        <h4>${event.description}</h4>
        <div class="event-meta">
          <span>By ${event.created_by}</span>
          <span class="badge">${statusBadge}</span>
        </div>
      </div>
      <div class="price-grid">
        <div class="price-card">
          <span>YES price</span>
          <strong>${event.prices.yes} pts</strong>
        </div>
        <div class="price-card no">
          <span>NO price</span>
          <strong>${event.prices.no} pts</strong>
        </div>
      </div>
      <div class="bets">
        <div>YES: ${event.bets.yes.join(", ") || "—"}</div>
        <div>NO: ${event.bets.no.join(", ") || "—"}</div>
      </div>
      <div class="stack" data-event-actions></div>
    `;

    const actions = card.querySelector("[data-event-actions]");

    if (event.status === "open" && !userBet) {
      const yesBtn = document.createElement("button");
      yesBtn.textContent = `Bet YES (${event.prices.yes})`;
      yesBtn.addEventListener("click", () => placeBet(event.id, "yes"));
      const noBtn = document.createElement("button");
      noBtn.textContent = `Bet NO (${event.prices.no})`;
      noBtn.classList.add("btn-no");
      noBtn.addEventListener("click", () => placeBet(event.id, "no"));
      actions.appendChild(yesBtn);
      actions.appendChild(noBtn);
    }

    if (userBet) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = `You bet ${userBet.direction.toUpperCase()} (${userBet.price} pts)`;
      if (event.status === "resolved" && event.outcome === userBet.direction) {
        badge.classList.add("win");
        winsThisRender.add(event.id);
      }
      actions.appendChild(badge);
    }

    if (currentUser?.is_admin && event.status !== "resolved") {
      const adminWrap = document.createElement("div");
      adminWrap.className = "stack";
      if (event.status === "open") {
        const closeBtn = document.createElement("button");
        closeBtn.textContent = "Close betting";
        closeBtn.classList.add("ghost");
        closeBtn.addEventListener("click", () => closeEvent(event.id));
        adminWrap.appendChild(closeBtn);
      }
      const resolveWrap = document.createElement("div");
      resolveWrap.style.display = "grid";
      resolveWrap.style.gridTemplateColumns = "1fr 1fr";
      resolveWrap.style.gap = "8px";
      const resolveYes = document.createElement("button");
      resolveYes.textContent = "Resolve YES";
      resolveYes.addEventListener("click", () => resolveEvent(event.id, "yes"));
      const resolveNo = document.createElement("button");
      resolveNo.textContent = "Resolve NO";
      resolveNo.classList.add("ghost");
      resolveNo.addEventListener("click", () => resolveEvent(event.id, "no"));
      resolveWrap.appendChild(resolveYes);
      resolveWrap.appendChild(resolveNo);
      adminWrap.appendChild(resolveWrap);
      actions.appendChild(adminWrap);
    }

    eventsStrip.appendChild(card);
  });

  hasRenderedEvents = true;
  triggerConfettiForWins(winsThisRender);
};

const refreshLeaderboardIfVisible = async () => {
  if (!leaderboardTab || leaderboardTab.classList.contains("hidden")) return;
  await refreshLeaderboard();
};

const refreshLeaderboard = async () => {
  const data = await apiFetch("/api/leaderboard");
  leaderboardCache = (data.leaderboard || []).slice();
  renderLeaderboard();
};

const renderLeaderboard = () => {
  if (!leaderboardList) return;
  leaderboardList.innerHTML = "";
  if (!leaderboardCache.length) {
    const empty = document.createElement("div");
    empty.className = "card";
    empty.textContent = "No scores yet.";
    leaderboardList.appendChild(empty);
    return;
  }
  leaderboardCache.forEach((entry, index) => {
    const row = document.createElement("div");
    row.className = "leaderboard-row";
    if (currentUser && entry.username === currentUser.username) {
      row.classList.add("me");
    }

    const rank = document.createElement("span");
    rank.className = "leaderboard-rank";
    rank.textContent = `#${index + 1}`;

    const name = document.createElement("span");
    name.className = "leaderboard-name";
    name.textContent = entry.username;

    const points = document.createElement("span");
    points.className = "leaderboard-points";
    points.textContent = `${entry.points} pts`;

    row.appendChild(rank);
    row.appendChild(name);
    row.appendChild(points);
    leaderboardList.appendChild(row);
  });
};

const triggerConfettiForWins = (wins) => {
  const initialized = localStorage.getItem(SEEN_INIT_KEY) === "true";
  if (!initialized) {
    wins.forEach((id) => lastResolvedWins.add(id));
    saveSeenWins(lastResolvedWins);
    localStorage.setItem(SEEN_INIT_KEY, "true");
    return;
  }
  const newWins = [...wins].filter((id) => !lastResolvedWins.has(id));
  if (!newWins.length) return;
  newWins.forEach((id) => lastResolvedWins.add(id));
  saveSeenWins(lastResolvedWins);
  fireConfetti();
};

const setupConfetti = () => {
  if (confettiCanvas) return;
  confettiCanvas = document.createElement("canvas");
  confettiCanvas.className = "confetti";
  document.body.appendChild(confettiCanvas);
  resizeConfetti();
  window.addEventListener("resize", resizeConfetti);
};

const resizeConfetti = () => {
  if (!confettiCanvas) return;
  confettiCanvas.width = window.innerWidth;
  confettiCanvas.height = window.innerHeight;
};

const fireConfetti = () => {
  if (confettiActive) return;
  setupConfetti();
  const ctx = confettiCanvas.getContext("2d");
  const pieces = Array.from({ length: 120 }, () => ({
    x: Math.random() * confettiCanvas.width,
    y: -20 - Math.random() * confettiCanvas.height * 0.3,
    size: 6 + Math.random() * 6,
    speed: 2 + Math.random() * 4,
    drift: -1 + Math.random() * 2,
    color: `hsl(${Math.random() * 360}, 80%, 60%)`,
    rotation: Math.random() * Math.PI,
    rotationSpeed: -0.1 + Math.random() * 0.2,
  }));
  const start = performance.now();
  confettiActive = true;

  const draw = (time) => {
    const elapsed = time - start;
    ctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
    pieces.forEach((piece) => {
      piece.x += piece.drift;
      piece.y += piece.speed;
      piece.rotation += piece.rotationSpeed;
      ctx.save();
      ctx.translate(piece.x, piece.y);
      ctx.rotate(piece.rotation);
      ctx.fillStyle = piece.color;
      ctx.fillRect(-piece.size / 2, -piece.size / 2, piece.size, piece.size * 0.6);
      ctx.restore();
    });
    if (elapsed < 2500) {
      requestAnimationFrame(draw);
    } else {
      confettiActive = false;
      ctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
    }
  };

  requestAnimationFrame(draw);
};

const placeBet = async (eventId, direction) => {
  try {
    await apiFetch(`/api/events/${eventId}/bet`, {
      method: "POST",
      body: JSON.stringify({ direction }),
    });
    await refreshEvents();
  } catch (err) {
    alert(err.message);
  }
};

const closeEvent = async (eventId) => {
  if (!confirm("Close betting for this event?")) return;
  try {
    await apiFetch(`/api/events/${eventId}/close`, { method: "POST" });
    await refreshEvents();
  } catch (err) {
    alert(err.message);
  }
};

const resolveEvent = async (eventId, outcome) => {
  if (!confirm(`Resolve event as ${outcome.toUpperCase()}?`)) return;
  try {
    await apiFetch(`/api/events/${eventId}/resolve`, {
      method: "POST",
      body: JSON.stringify({ outcome }),
    });
    await refreshEvents();
  } catch (err) {
    alert(err.message);
  }
};

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setError(loginError, "");
  const formData = new FormData(loginForm);
  try {
    const data = await apiFetch("/api/login", {
      method: "POST",
      body: JSON.stringify({
        username: formData.get("username"),
        password: formData.get("password"),
      }),
    });
    authToken = data.token;
    localStorage.setItem("token", authToken);
    await loadMe();
  } catch (err) {
    setError(loginError, err.message);
  }
});

logoutBtn.addEventListener("click", async () => {
  try {
    await apiFetch("/api/logout", { method: "POST" });
  } catch (err) {
    // ignore
  }
  authToken = null;
  localStorage.removeItem("token");
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
  showLogin();
});

addEventBtn.addEventListener("click", () => {
  eventModal.classList.remove("hidden");
  const range = eventForm.querySelector('input[name="price"]');
  if (range && priceValue) {
    priceValue.textContent = `${range.value} pts`;
  }
});

cancelEventBtn.addEventListener("click", () => {
  eventModal.classList.add("hidden");
  eventForm.reset();
  setError(eventError, "");
});

eventForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setError(eventError, "");
  const formData = new FormData(eventForm);
  try {
    await apiFetch("/api/events", {
      method: "POST",
      body: JSON.stringify({
        description: formData.get("description"),
        initial_price: Number(formData.get("price")),
      }),
    });
    eventForm.reset();
    eventModal.classList.add("hidden");
    await refreshEvents();
  } catch (err) {
    setError(eventError, err.message);
  }
});

eventForm.addEventListener("input", (event) => {
  if (event.target && event.target.name === "price" && priceValue) {
    priceValue.textContent = `${event.target.value} pts`;
  }
});

passwordForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setError(passwordError, "");
  const formData = new FormData(passwordForm);
  try {
    await apiFetch("/api/password", {
      method: "POST",
      body: JSON.stringify({
        current_password: formData.get("current"),
        new_password: formData.get("next"),
      }),
    });
    passwordForm.reset();
    setError(passwordError, "Password updated.");
  } catch (err) {
    setError(passwordError, err.message);
  }
});

adminUserForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setError(adminUserError, "");
  const formData = new FormData(adminUserForm);
  try {
    await apiFetch("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({
        username: formData.get("username"),
        password: formData.get("password"),
        is_admin: formData.get("is_admin") === "on",
      }),
    });
    adminUserForm.reset();
    setError(adminUserError, "User saved.");
  } catch (err) {
    setError(adminUserError, err.message);
  }
});

const tabButtons = document.querySelectorAll(".tab-btn");
const tabs = document.querySelectorAll(".tab");

tabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    tabButtons.forEach((btn) => btn.classList.remove("active"));
    button.classList.add("active");
    tabs.forEach((tab) => tab.classList.add("hidden"));
    document.getElementById(button.dataset.tab).classList.remove("hidden");
    if (button.dataset.tab === "leaderboardTab") {
      refreshLeaderboard().catch(() => {});
    }
  });
});

loadMe();

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && authToken) {
    refreshEvents().catch(() => {});
    refreshLeaderboardIfVisible().catch(() => {});
  }
});
