const crypto = require("crypto");
const express = require("express");
const bodyParser = require("body-parser");

const config = require("./lib/config");
const session = require("./lib/session");
const tokenStore = require("./lib/tokenStore");
const google = require("./lib/google");
const slack = require("./lib/slack");
const pages = require("./lib/pages");
const meetCache = require("./lib/meetCache");

// Pre-warmed FIFO pool of Meet links: serve from cache, refill in background.
meetCache.configure({
  target: config.meetCacheSize,
  create: () => google.createMeetSpace(tokenStore),
});
// Kick off the initial fill without blocking boot (also covers serverless
// cold starts where the listen callback below may not run).
setImmediate(() => meetCache.start());

const app = express();
app.locals.sessionSecret = config.sessionSecret;

// Keep the raw body around so Slack request signatures can be verified.
app.use(
  bodyParser.urlencoded({
    extended: true,
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);

function requireLogin(req, res, next) {
  if (session.isLoggedIn(req)) return next();
  res.redirect("/login");
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- Login -------------------------------------------------------------------

app.get("/login", (req, res) => {
  if (session.isLoggedIn(req)) return res.redirect("/");
  res.send(pages.login());
});

app.post("/login", async (req, res) => {
  if (!config.adminEmail || !config.adminPassword) {
    return res.status(500).send(pages.login("ADMIN_EMAIL / ADMIN_PASSWORD are not configured in .env"));
  }

  const { email, password } = req.body || {};
  const ok =
    session.safeEqual(email || "", config.adminEmail) &&
    session.safeEqual(password || "", config.adminPassword);

  if (!ok) {
    await delay(400); // slow brute-force attempts down
    return res.status(401).send(pages.login("Wrong email or password."));
  }

  res.setHeader("Set-Cookie", session.sessionCookie(config.sessionSecret));
  res.redirect("/");
});

app.get("/logout", (req, res) => {
  res.setHeader("Set-Cookie", session.clearSessionCookie());
  res.redirect("/login");
});

// --- Dashboard ----------------------------------------------------------------

app.get("/", requireLogin, (req, res) => {
  const tokens = tokenStore.load();
  const checked = req.query.checked === "ok" || req.query.checked === "failed" ? req.query.checked : "";
  res.send(
    pages.dashboard({
      connected: Boolean(tokens && tokens.refresh_token),
      account: (tokens && tokens.account_email) || "",
      lastRefreshedAt: (tokens && tokens.last_refreshed_at) || "",
      checked,
      cache: meetCache.status(),
    })
  );
});

// --- Google OAuth ---------------------------------------------------------------

app.get("/auth/google", requireLogin, (req, res) => {
  const missing = google.missingConfig();
  if (missing.length) {
    return res
      .status(500)
      .send(pages.error(`Missing env var(s): ${missing.join(", ")} — set them in .env and restart.`));
  }

  const state = crypto.randomBytes(16).toString("hex");
  res.setHeader("Set-Cookie", session.stateCookie(state));
  res.redirect(google.authUrl(state));
});

app.get("/auth/google/callback", requireLogin, async (req, res) => {
  const { code, error, state } = req.query;

  if (error) {
    return res.status(400).send(pages.error(`Google returned an error: ${error}`));
  }

  const expectedState = session.getCookie(req, session.STATE_COOKIE);
  if (!code || !state || !expectedState || state !== expectedState) {
    return res.status(400).send(pages.error("Invalid OAuth state — start again from the dashboard."));
  }

  try {
    const tokens = await google.exchangeCode(code);
    tokenStore.save(tokens);
    res.setHeader("Set-Cookie", session.clearStateCookie());
    // An account was just connected — fill the pre-warmed Meet link pool.
    meetCache.start();
    res.redirect("/");
  } catch (err) {
    console.error("[auth] token exchange failed:", err.message);
    res.status(502).send(pages.error(`Google token exchange failed: ${err.message}`));
  }
});

// Verifies the Google connection by forcing a refresh-token round-trip.
app.post("/check-connection", requireLogin, async (req, res) => {
  const result = await google.checkConnection(tokenStore);
  if (!result.connected) console.warn("[auth] connection check failed:", result.reason);
  res.redirect(`/?checked=${result.connected ? "ok" : "failed"}`);
});

// --- Slack slash command ----------------------------------------------------------

app.post("/api/slash", async (req, res) => {
  if (!slack.verifyRequest(req, req.rawBody)) {
    return res.status(401).send("Invalid Slack signature");
  }

  // Fast path: serve a pre-warmed link, then top the pool back up in the
  // background (fire-and-forget — the response never waits for Google).
  const cached = meetCache.take();
  if (cached) {
    meetCache.refillInBackground();
    return res.json({
      response_type: "in_channel",
      text: `${cached}`,
    });
  }

  // Pool empty (still warming, burst traffic, or refill failing) — fall back
  // to creating on demand, and kick off a refill for the next request.
  let link;
  try {
    link = await google.createMeetSpace(tokenStore);
    meetCache.refillInBackground();
  } catch (err) {
    const notConnected = err.code === "GOOGLE_NOT_CONNECTED";
    if (!notConnected) console.error("[meet] creating space failed:", err.message);
    return res.json({
      response_type: "ephemeral",
      text: notConnected
        ? "⚠️ No Google account is connected yet — the workspace admin needs to connect one from the app dashboard."
        : `⚠️ Could not create a Meet link: ${err.message}`,
    });
  }

  res.json({
    response_type: "in_channel",
    text: `${link}`,
  });
});

// --- Fallbacks ---------------------------------------------------------------------

app.use((req, res) => res.status(404).send(pages.error("Not found")));

app.use((err, req, res, next) => {
  console.error("[error]", err);
  res.status(500).send(pages.error("Unexpected server error."));
});

app.listen(config.port, () => {
  console.log(`Server started on port ${config.port}`);
  // Fill the Meet link pool in the background without blocking boot.
  meetCache.start();
});
