// Loads .env for local development (no-op on Vercel, where env vars come from the dashboard).
try {
  process.loadEnvFile();
} catch {
  // No .env file present — fine.
}

const crypto = require("crypto");

let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  console.warn(
    "[config] SESSION_SECRET is not set — using a random secret (logins won't survive restarts)."
  );
  sessionSecret = crypto.randomBytes(32).toString("hex");
}

module.exports = {
  adminEmail: process.env.ADMIN_EMAIL || "",
  adminPassword: process.env.ADMIN_PASSWORD || "",
  sessionSecret,
  slackSigningSecret: process.env.SLACK_SIGNING_SECRET || "",
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    redirectUri: process.env.GOOGLE_REDIRECT_URI || "",
  },
  port: process.env.PORT || 8080,
};
