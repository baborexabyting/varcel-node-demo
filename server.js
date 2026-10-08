const crypto = require("crypto");
const express = require("express");
const bodyParser = require("body-parser");

const config = require("./lib/config");
const session = require("./lib/session");
const tokenStore = require("./lib/tokenStore");
const google = require("./lib/google");
const slack = require("./lib/slack");
const pages = require("./lib/pages");

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
  res.send(
    pages.dashboard({
      connected: Boolean(tokens && tokens.refresh_token),
      account: (tokens && tokens.account_email) || "",
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
    res.redirect("/");
  } catch (err) {
    console.error("[auth] token exchange failed:", err.message);
    res.status(502).send(pages.error(`Google token exchange failed: ${err.message}`));
  }
});

app.post("/disconnect", requireLogin, (req, res) => {
  tokenStore.clear();
  res.redirect("/");
});

// --- Slack slash command ----------------------------------------------------------

app.post("/api/slash", async (req, res) => {
  if (!slack.verifyRequest(req, req.rawBody)) {
    return res.status(401).send("Invalid Slack signature");
  }

  let link;
  try {
    link = await google.createMeetSpace(tokenStore);
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
});
