const crypto = require("crypto");

const SESSION_COOKIE = "meet_session";
const STATE_COOKIE = "oauth_state";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Constant-time string comparison.
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

function sign(value, secret) {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

function cookieString(name, value, maxAgeSeconds) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

function getCookie(req, name) {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      try {
        return decodeURIComponent(part.slice(idx + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

// Stateless signed-cookie session: base64url(payload).HMAC — nothing to store server-side,
// so it keeps working across serverless restarts.
function sessionCookie(secret) {
  const payload = Buffer.from(JSON.stringify({ auth: true, iat: Date.now() })).toString("base64url");
  return cookieString(SESSION_COOKIE, `${payload}.${sign(payload, secret)}`, SESSION_TTL_MS / 1000);
}

function isLoggedIn(req) {
  const token = getCookie(req, SESSION_COOKIE);
  if (!token) return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;
  if (!safeEqual(signature, sign(payload, req.app.locals.sessionSecret))) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return data.auth === true && Date.now() - data.iat < SESSION_TTL_MS;
  } catch {
    return false;
  }
}

module.exports = {
  STATE_COOKIE,
  safeEqual,
  sessionCookie,
  clearSessionCookie: () => cookieString(SESSION_COOKIE, "", 0),
  stateCookie: (state) => cookieString(STATE_COOKIE, state, 600),
  clearStateCookie: () => cookieString(STATE_COOKIE, "", 0),
  isLoggedIn,
  getCookie,
};
