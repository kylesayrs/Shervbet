const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const PUBLIC_DIR = path.join(__dirname, "public");

const PRICE_INCREMENT = 5;
const DEFAULT_POINTS = 1000;

const sessions = new Map();

function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const usersPath = path.join(DATA_DIR, "users.csv");
  const eventsPath = path.join(DATA_DIR, "events.csv");
  const betsPath = path.join(DATA_DIR, "bets.csv");

  if (!fs.existsSync(usersPath)) {
    const { hash, salt } = hashPassword("admin");
    const header = [
      "username",
      "password_hash",
      "salt",
      "is_admin",
      "points",
      "created_at",
    ].join(",");
    const adminRow = [
      "admin",
      hash,
      salt,
      "true",
      String(DEFAULT_POINTS),
      new Date().toISOString(),
    ];
    fs.writeFileSync(usersPath, `${header}\n${encodeCsvRow(adminRow)}\n`);
  }

  if (!fs.existsSync(eventsPath)) {
    const header = [
      "id",
      "description",
      "base_yes_price",
      "base_no_price",
      "status",
      "outcome",
      "created_by",
      "created_at",
    ].join(",");
    fs.writeFileSync(eventsPath, `${header}\n`);
  }

  if (!fs.existsSync(betsPath)) {
    const header = [
      "id",
      "event_id",
      "username",
      "direction",
      "price",
      "created_at",
    ].join(",");
    fs.writeFileSync(betsPath, `${header}\n`);
  }
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto
    .pbkdf2Sync(password, salt, 100000, 64, "sha512")
    .toString("hex");
  return { hash, salt };
}

function verifyPassword(password, hash, salt) {
  const { hash: verify } = hashPassword(password, salt);
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(verify, "hex"));
}

function encodeCsvValue(value) {
  const str = String(value ?? "");
  if (str.includes("\"") || str.includes(",") || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function encodeCsvRow(values) {
  return values.map(encodeCsvValue).join(",");
}

function parseCsv(content) {
  const rows = [];
  let current = "";
  let inQuotes = false;
  const row = [];

  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];
    const next = content[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        current += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === ",") {
      row.push(current);
      current = "";
      continue;
    }

    if (char === "\n") {
      row.push(current);
      rows.push([...row]);
      row.length = 0;
      current = "";
      continue;
    }

    if (char === "\r") {
      continue;
    }

    current += char;
  }

  if (current.length || row.length) {
    row.push(current);
    rows.push([...row]);
  }

  return rows;
}

function readCsv(file) {
  if (!fs.existsSync(file)) return [];
  const content = fs.readFileSync(file, "utf8").trim();
  if (!content) return [];
  const rows = parseCsv(content);
  if (rows.length === 0) return [];
  const [header, ...data] = rows;
  return data
    .filter((row) => row.some((cell) => cell !== ""))
    .map((row) => {
      const obj = {};
      header.forEach((key, index) => {
        obj[key] = row[index] ?? "";
      });
      return obj;
    });
}

function writeCsv(file, header, rows) {
  const output = [header.join(",")];
  for (const row of rows) {
    output.push(encodeCsvRow(header.map((key) => row[key] ?? "")));
  }
  fs.writeFileSync(file, `${output.join("\n")}\n`);
}

function getAuthUser(req) {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  const username = sessions.get(token);
  if (!username) return null;
  const users = readCsv(path.join(DATA_DIR, "users.csv"));
  return users.find((user) => user.username === username) || null;
}

function jsonResponse(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1e6) {
        req.destroy();
        reject(new Error("Payload too large"));
      }
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(err);
      }
    });
  });
}

function getEventPrices(event, bets) {
  const yesCount = bets.filter(
    (bet) => bet.event_id === event.id && bet.direction === "yes"
  ).length;
  const noCount = bets.filter(
    (bet) => bet.event_id === event.id && bet.direction === "no"
  ).length;
  return {
    yes: Number(event.base_yes_price) + yesCount * PRICE_INCREMENT,
    no: Number(event.base_no_price) + noCount * PRICE_INCREMENT,
  };
}

function enrichEvent(event, bets) {
  const prices = getEventPrices(event, bets);
  const eventBets = bets.filter((bet) => bet.event_id === event.id);
  const yesUsers = eventBets.filter((bet) => bet.direction === "yes").map((bet) => bet.username);
  const noUsers = eventBets.filter((bet) => bet.direction === "no").map((bet) => bet.username);
  return {
    ...event,
    prices,
    bets: {
      yes: yesUsers,
      no: noUsers,
    },
  };
}

function serveStatic(req, res) {
  const urlPath = req.url.split("?")[0];
  const filePath = urlPath === "/" ? "/index.html" : urlPath;
  const safePath = path.normalize(filePath).replace(/^\.+/, "");
  const absolutePath = path.join(PUBLIC_DIR, safePath);
  if (!absolutePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(absolutePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(absolutePath);
    const typeMap = {
      ".html": "text/html",
      ".css": "text/css",
      ".js": "application/javascript",
      ".png": "image/png",
      ".svg": "image/svg+xml",
    };
    res.writeHead(200, { "Content-Type": typeMap[ext] || "text/plain" });
    res.end(data);
  });
}

function requireAuth(req, res) {
  const user = getAuthUser(req);
  if (!user) {
    jsonResponse(res, 401, { error: "Unauthorized" });
    return null;
  }
  return user;
}

function updateUser(users, username, updater) {
  const next = users.map((user) => {
    if (user.username !== username) return user;
    return { ...user, ...updater(user) };
  });
  return next;
}

function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (req.method === "POST" && pathname === "/api/login") {
    return parseBody(req)
      .then(({ username, password }) => {
        const users = readCsv(path.join(DATA_DIR, "users.csv"));
        const user = users.find((u) => u.username === username);
        if (!user || !verifyPassword(password || "", user.password_hash, user.salt)) {
          jsonResponse(res, 401, { error: "Invalid credentials" });
          return;
        }
        const token = crypto.randomBytes(24).toString("hex");
        sessions.set(token, user.username);
        jsonResponse(res, 200, {
          token,
          user: {
            username: user.username,
            is_admin: user.is_admin === "true",
            points: Number(user.points),
          },
        });
      })
      .catch(() => jsonResponse(res, 400, { error: "Invalid request" }));
  }

  if (req.method === "POST" && pathname === "/api/logout") {
    const auth = req.headers.authorization || "";
    if (auth.startsWith("Bearer ")) sessions.delete(auth.slice(7));
    jsonResponse(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && pathname === "/api/me") {
    const user = requireAuth(req, res);
    if (!user) return;
    jsonResponse(res, 200, {
      username: user.username,
      is_admin: user.is_admin === "true",
      points: Number(user.points),
    });
    return;
  }

  if (req.method === "GET" && pathname === "/api/events") {
    const user = requireAuth(req, res);
    if (!user) return;
    const events = readCsv(path.join(DATA_DIR, "events.csv"));
    const bets = readCsv(path.join(DATA_DIR, "bets.csv"));
    const enriched = events.map((event) => enrichEvent(event, bets));
    const userBets = bets.filter((bet) => bet.username === user.username);
    jsonResponse(res, 200, { events: enriched, userBets });
    return;
  }

  if (req.method === "POST" && pathname === "/api/events") {
    const user = requireAuth(req, res);
    if (!user) return;
    return parseBody(req)
      .then(({ description, initial_price }) => {
        if (!description || typeof description !== "string") {
          jsonResponse(res, 400, { error: "Description required" });
          return;
        }
        const initial = Number(initial_price);
        if (!Number.isFinite(initial) || initial <= 0 || initial >= 100) {
          jsonResponse(res, 400, { error: "Initial price must be 1-99" });
          return;
        }
        const eventsPath = path.join(DATA_DIR, "events.csv");
        const events = readCsv(eventsPath);
        const id = crypto.randomUUID();
        const baseYes = Math.round(initial);
        const baseNo = Math.max(1, Math.min(99, 100 - baseYes));
        const event = {
          id,
          description: description.trim(),
          base_yes_price: String(baseYes),
          base_no_price: String(baseNo),
          status: "open",
          outcome: "",
          created_by: user.username,
          created_at: new Date().toISOString(),
        };
        const header = [
          "id",
          "description",
          "base_yes_price",
          "base_no_price",
          "status",
          "outcome",
          "created_by",
          "created_at",
        ];
        writeCsv(eventsPath, header, [...events, event]);
        jsonResponse(res, 201, { event });
      })
      .catch(() => jsonResponse(res, 400, { error: "Invalid request" }));
  }

  if (req.method === "POST" && pathname.match(/^\/api\/events\/([^/]+)\/bet$/)) {
    const user = requireAuth(req, res);
    if (!user) return;
    const id = pathname.split("/")[3];
    return parseBody(req)
      .then(({ direction }) => {
        if (direction !== "yes" && direction !== "no") {
          jsonResponse(res, 400, { error: "Invalid direction" });
          return;
        }
        const eventsPath = path.join(DATA_DIR, "events.csv");
        const betsPath = path.join(DATA_DIR, "bets.csv");
        const usersPath = path.join(DATA_DIR, "users.csv");

        const events = readCsv(eventsPath);
        const event = events.find((evt) => evt.id === id);
        if (!event) {
          jsonResponse(res, 404, { error: "Event not found" });
          return;
        }
        if (event.status !== "open") {
          jsonResponse(res, 400, { error: "Event is closed" });
          return;
        }
        const bets = readCsv(betsPath);
        if (bets.some((bet) => bet.event_id === id && bet.username === user.username)) {
          jsonResponse(res, 400, { error: "You already bet on this event" });
          return;
        }
        const prices = getEventPrices(event, bets);
        const price = prices[direction];

        const users = readCsv(usersPath);
        const currentUser = users.find((u) => u.username === user.username);
        if (!currentUser) {
          jsonResponse(res, 400, { error: "User missing" });
          return;
        }
        if (Number(currentUser.points) < price) {
          jsonResponse(res, 400, { error: "Insufficient points" });
          return;
        }

        const bet = {
          id: crypto.randomUUID(),
          event_id: id,
          username: user.username,
          direction,
          price: String(price),
          created_at: new Date().toISOString(),
        };

        const updatedUsers = updateUser(users, user.username, (u) => ({
          points: String(Number(u.points) - price),
        }));
        writeCsv(usersPath, [
          "username",
          "password_hash",
          "salt",
          "is_admin",
          "points",
          "created_at",
        ], updatedUsers);

        const betsHeader = [
          "id",
          "event_id",
          "username",
          "direction",
          "price",
          "created_at",
        ];
        writeCsv(betsPath, betsHeader, [...bets, bet]);
        jsonResponse(res, 201, { bet, price });
      })
      .catch(() => jsonResponse(res, 400, { error: "Invalid request" }));
  }

  if (req.method === "POST" && pathname.match(/^\/api\/events\/([^/]+)\/close$/)) {
    const user = requireAuth(req, res);
    if (!user) return;
    if (user.is_admin !== "true") {
      jsonResponse(res, 403, { error: "Admin only" });
      return;
    }
    const id = pathname.split("/")[3];
    const eventsPath = path.join(DATA_DIR, "events.csv");
    const events = readCsv(eventsPath);
    const event = events.find((evt) => evt.id === id);
    if (!event) {
      jsonResponse(res, 404, { error: "Event not found" });
      return;
    }
    if (event.status !== "open") {
      jsonResponse(res, 400, { error: "Event already closed" });
      return;
    }
    const updated = events.map((evt) =>
      evt.id === id ? { ...evt, status: "closed" } : evt
    );
    writeCsv(eventsPath, [
      "id",
      "description",
      "base_yes_price",
      "base_no_price",
      "status",
      "outcome",
      "created_by",
      "created_at",
    ], updated);
    jsonResponse(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && pathname.match(/^\/api\/events\/([^/]+)\/resolve$/)) {
    const user = requireAuth(req, res);
    if (!user) return;
    if (user.is_admin !== "true") {
      jsonResponse(res, 403, { error: "Admin only" });
      return;
    }
    const id = pathname.split("/")[3];
    return parseBody(req)
      .then(({ outcome }) => {
        if (outcome !== "yes" && outcome !== "no") {
          jsonResponse(res, 400, { error: "Outcome required" });
          return;
        }
        const eventsPath = path.join(DATA_DIR, "events.csv");
        const betsPath = path.join(DATA_DIR, "bets.csv");
        const usersPath = path.join(DATA_DIR, "users.csv");

        const events = readCsv(eventsPath);
        const event = events.find((evt) => evt.id === id);
        if (!event) {
          jsonResponse(res, 404, { error: "Event not found" });
          return;
        }
        if (event.status === "resolved") {
          jsonResponse(res, 400, { error: "Event already resolved" });
          return;
        }

        const bets = readCsv(betsPath);
        const users = readCsv(usersPath);

        const winners = bets.filter(
          (bet) => bet.event_id === id && bet.direction === outcome
        );

        let updatedUsers = users;
        for (const bet of winners) {
          updatedUsers = updateUser(updatedUsers, bet.username, (u) => ({
            points: String(Number(u.points) + 100),
          }));
        }

        writeCsv(usersPath, [
          "username",
          "password_hash",
          "salt",
          "is_admin",
          "points",
          "created_at",
        ], updatedUsers);

        const updatedEvents = events.map((evt) =>
          evt.id === id
            ? { ...evt, status: "resolved", outcome }
            : evt
        );
        writeCsv(eventsPath, [
          "id",
          "description",
          "base_yes_price",
          "base_no_price",
          "status",
          "outcome",
          "created_by",
          "created_at",
        ], updatedEvents);

        jsonResponse(res, 200, { ok: true });
      })
      .catch(() => jsonResponse(res, 400, { error: "Invalid request" }));
  }

  if (req.method === "POST" && pathname === "/api/password") {
    const user = requireAuth(req, res);
    if (!user) return;
    return parseBody(req)
      .then(({ current_password, new_password }) => {
        if (!verifyPassword(current_password || "", user.password_hash, user.salt)) {
          jsonResponse(res, 401, { error: "Current password incorrect" });
          return;
        }
        if (!new_password || new_password.length < 4) {
          jsonResponse(res, 400, { error: "New password too short" });
          return;
        }
        const usersPath = path.join(DATA_DIR, "users.csv");
        const users = readCsv(usersPath);
        const { hash, salt } = hashPassword(new_password);
        const updated = updateUser(users, user.username, () => ({
          password_hash: hash,
          salt,
        }));
        writeCsv(usersPath, [
          "username",
          "password_hash",
          "salt",
          "is_admin",
          "points",
          "created_at",
        ], updated);
        jsonResponse(res, 200, { ok: true });
      })
      .catch(() => jsonResponse(res, 400, { error: "Invalid request" }));
  }

  if (req.method === "POST" && pathname === "/api/admin/users") {
    const user = requireAuth(req, res);
    if (!user) return;
    if (user.is_admin !== "true") {
      jsonResponse(res, 403, { error: "Admin only" });
      return;
    }
    return parseBody(req)
      .then(({ username, password, is_admin }) => {
        if (!username || !password) {
          jsonResponse(res, 400, { error: "Username and password required" });
          return;
        }
        const usersPath = path.join(DATA_DIR, "users.csv");
        const users = readCsv(usersPath);
        const { hash, salt } = hashPassword(password);
        const existing = users.find((u) => u.username === username);
        let nextUsers;
        if (existing) {
          nextUsers = updateUser(users, username, (u) => ({
            password_hash: hash,
            salt,
            is_admin: typeof is_admin === "boolean" ? String(is_admin) : u.is_admin,
          }));
        } else {
          nextUsers = [
            ...users,
            {
              username,
              password_hash: hash,
              salt,
              is_admin: String(Boolean(is_admin)),
              points: String(DEFAULT_POINTS),
              created_at: new Date().toISOString(),
            },
          ];
        }
        writeCsv(usersPath, [
          "username",
          "password_hash",
          "salt",
          "is_admin",
          "points",
          "created_at",
        ], nextUsers);
        jsonResponse(res, 200, { ok: true });
      })
      .catch(() => jsonResponse(res, 400, { error: "Invalid request" }));
  }

  res.writeHead(404);
  res.end("Not found");
}

ensureDataFiles();

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/")) {
    handleApi(req, res);
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Prediction market app running at http://localhost:${PORT}`);
});
