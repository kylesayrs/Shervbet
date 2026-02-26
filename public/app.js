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
const pointsBalance = document.getElementById("pointsBalance");
const passwordForm = document.getElementById("passwordForm");
const passwordError = document.getElementById("passwordError");
const adminPanel = document.getElementById("adminPanel");
const adminUserForm = document.getElementById("adminUserForm");
const adminUserError = document.getElementById("adminUserError");
const welcomeName = document.getElementById("welcomeName");

let authToken = localStorage.getItem("token");
let currentUser = null;
let eventsCache = [];
let userBets = [];
let refreshTimer = null;

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
    welcomeName.textContent = `Welcome, ${currentUser.username}`;
    pointsBalance.textContent = currentUser.points;
    adminPanel.classList.toggle("hidden", !currentUser.is_admin);
    showApp();
    await refreshEvents();
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
  eventsCache = data.events || [];
  userBets = data.userBets || [];
  renderEvents();
  const me = await apiFetch("/api/me");
  currentUser = me;
  pointsBalance.textContent = me.points;
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

  eventsCache.forEach((event) => {
    const card = document.createElement("div");
    card.className = "event-card";
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
        <div>YES bettors: ${event.bets.yes.join(", ") || "—"}</div>
        <div>NO bettors: ${event.bets.no.join(", ") || "—"}</div>
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
      noBtn.classList.add("ghost");
      noBtn.addEventListener("click", () => placeBet(event.id, "no"));
      actions.appendChild(yesBtn);
      actions.appendChild(noBtn);
    }

    if (userBet) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = `You bet ${userBet.direction.toUpperCase()} (${userBet.price} pts)`;
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
  });
});

loadMe();

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && authToken) {
    refreshEvents().catch(() => {});
  }
});
