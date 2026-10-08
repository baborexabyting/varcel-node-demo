const fs = require("fs");
const path = require("path");

let warnedAboutVercel = false;

// Tokens live in a JSON file. Locally that's ./data/google-tokens.json (gitignored).
// On Vercel the filesystem is read-only except /tmp, and /tmp is per-instance and
// ephemeral — tokens will be lost on cold starts. Set TOKEN_STORE_PATH to a durable
// location, or swap this module for a real store (DB / Vercel Blob / Upstash), when
// running in production.
function storePath() {
  if (process.env.TOKEN_STORE_PATH) return process.env.TOKEN_STORE_PATH;
  if (process.env.VERCEL) return "/tmp/google-tokens.json";
  return path.join(__dirname, "..", "data", "google-tokens.json");
}

function load() {
  try {
    return JSON.parse(fs.readFileSync(storePath(), "utf8"));
  } catch {
    return null;
  }
}

function save(tokens) {
  const file = storePath();
  if (process.env.VERCEL && !warnedAboutVercel) {
    warnedAboutVercel = true;
    console.warn(
      "[tokenStore] On Vercel tokens go to /tmp and are lost on cold starts — reconnect after redeployments, or point TOKEN_STORE_PATH at a durable store."
    );
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ ...tokens, saved_at: new Date().toISOString() }, null, 2), {
    mode: 0o600, // contains secrets
  });
}

function clear() {
  try {
    fs.unlinkSync(storePath());
  } catch {
    // Nothing stored — fine.
  }
}

module.exports = { load, save, clear, storePath };
