// In-memory Google token store, seeded from the GOOGLE_REFRESH_TOKEN env var.
//
// Why: Vercel's filesystem is read-only except /tmp, and /tmp is per-instance
// and wiped on cold starts — file persistence can't work there. Instead:
//   - At boot, the refresh token is read from GOOGLE_REFRESH_TOKEN (set in
//     `.env` locally or in the Vercel dashboard in production).
//   - Access tokens + expiry + account email live only in process memory and
//     are refreshed on demand via the stored refresh token (see lib/google.js).
//
// After connecting via the dashboard OAuth flow, copy the displayed refresh
// token into GOOGLE_REFRESH_TOKEN so it survives restarts / redeploys.

let memory = null;

function seedFromEnv() {
  const refreshToken = (process.env.GOOGLE_REFRESH_TOKEN || "").trim();
  if (!refreshToken) return null;
  return {
    refresh_token: refreshToken,
    access_token: null,
    expiry_date: 0,
    scope: "",
    account_email: (process.env.GOOGLE_ACCOUNT_EMAIL || "").trim(),
    source: "env",
  };
}

memory = seedFromEnv();
if (memory) {
  console.log("[tokenStore] seeded refresh token from GOOGLE_REFRESH_TOKEN env var");
}

// Re-read env (useful in tests / when env changes after require).
function reseed() {
  const seeded = seedFromEnv();
  if (seeded) memory = seeded;
  return load();
}

function load() {
  return memory ? { ...memory } : null;
}

function save(tokens) {
  const prev = memory || {};
  // Google only returns a refresh_token on the first consent / when
  // prompt=consent is used — never wipe a good stored one with undefined.
  const refreshToken = tokens.refresh_token || prev.refresh_token || "";
  if (!refreshToken) return null;

  // Track where the refresh token came from so the dashboard can tell the
  // admin whether they still need to copy it into the env var.
  const envToken = (process.env.GOOGLE_REFRESH_TOKEN || "").trim();
  const source =
    refreshToken && refreshToken === envToken ? "env" : tokens.source || prev.source || "oauth";

  memory = {
    ...prev,
    ...tokens,
    refresh_token: refreshToken,
    source,
  };
  return load();
}

function clear() {
  memory = null;
}

// Where the current refresh token came from: "env" | "oauth" | null.
function getSource() {
  return (memory && memory.source) || null;
}

module.exports = { load, save, clear, reseed, getSource };
