const config = require("./config");

const SCOPES = [
  "openid",
  "email", // identify which account got connected (shown on the dashboard)
  "https://www.googleapis.com/auth/meetings.space.created", // create Google Meet spaces
];

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";
const MEET_SPACES_ENDPOINT = "https://meet.googleapis.com/v2/spaces";

function missingConfig() {
  const missing = [];
  if (!config.google.clientId) missing.push("GOOGLE_CLIENT_ID");
  if (!config.google.clientSecret) missing.push("GOOGLE_CLIENT_SECRET");
  if (!config.google.redirectUri) missing.push("GOOGLE_REDIRECT_URI");
  return missing;
}

function notConnected(message) {
  const err = new Error(message);
  err.code = "GOOGLE_NOT_CONNECTED";
  return err;
}

function authUrl(state) {
  const params = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: config.google.redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline", // ask for a refresh token
    prompt: "consent", // ...every time, so reconnects still get one
    state,
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

async function postForm(endpoint, params) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function fetchEmail(accessToken) {
  try {
    const res = await fetch(USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await res.json();
    return data.email || "";
  } catch {
    return ""; // cosmetic only — don't fail the whole connect over it
  }
}

// Exchanges the OAuth code for tokens and returns what we persist.
async function exchangeCode(code) {
  const { ok, status, data } = await postForm(TOKEN_ENDPOINT, {
    code,
    client_id: config.google.clientId,
    client_secret: config.google.clientSecret,
    redirect_uri: config.google.redirectUri,
    grant_type: "authorization_code",
  });
  if (!ok) {
    throw new Error(`token exchange failed (${status}): ${data.error_description || data.error}`);
  }

  const tokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    scope: data.scope,
    expiry_date: Date.now() + (data.expires_in || 3600) * 1000,
  };
  tokens.account_email = await fetchEmail(tokens.access_token);
  return tokens;
}

// --- Access-token management ---------------------------------------------------

// Returns a usable access token, refreshing (and persisting) it when expired.
// `forceRefresh` skips the expiry check — used when an API call came back 401
// even though the stored token still looked valid (revoked early, clock skew…).
async function getValidAccessToken(tokenStore, { forceRefresh = false } = {}) {
  const tokens = tokenStore.load();
  if (!tokens || !tokens.refresh_token) {
    throw notConnected("No Google account connected yet");
  }

  if (!forceRefresh && tokens.access_token && tokens.expiry_date - 60_000 > Date.now()) {
    return tokens.access_token;
  }

  return refreshAccessToken(tokenStore);
}

let refreshInFlight = null;

// Single-flight refresh: concurrent callers share one round-trip to Google.
function refreshAccessToken(tokenStore) {
  if (!refreshInFlight) {
    refreshInFlight = doRefresh(tokenStore).finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

async function doRefresh(tokenStore) {
  const tokens = tokenStore.load();
  if (!tokens || !tokens.refresh_token) {
    throw notConnected("No Google account connected yet");
  }

  console.log("Start refreshing google access_token");
  const { ok, status, data } = await postForm(TOKEN_ENDPOINT, {
    client_id: config.google.clientId,
    client_secret: config.google.clientSecret,
    refresh_token: tokens.refresh_token,
    grant_type: "refresh_token",
  });

  if (!ok) {
    if (data.error === "invalid_grant") {
      tokenStore.clear(); // refresh token revoked/expired — admin must reconnect
      throw notConnected("Google session expired. Reconnect the account from the dashboard.");
    }
    throw new Error(`token refresh failed (${status}): ${data.error_description || data.error}`);
  }

  tokenStore.save({
    ...tokens,
    access_token: data.access_token,
    expiry_date: Date.now() + (data.expires_in || 3600) * 1000,
  });

  console.log("Refreshing google access_token success");
  return data.access_token;
}

// --- Authorized API calls --------------------------------------------------------

// axios-interceptor-style wrapper: run the request, and if Google answers 401,
// force one token refresh and replay the request with the fresh token.
async function withAuthRetry(tokenStore, run) {
  let accessToken = await getValidAccessToken(tokenStore);

  let res = await run(accessToken);
  if (res.status !== 401) return res;

  accessToken = await refreshAccessToken(tokenStore); // forced — skips the expiry check
  return run(accessToken); // exactly one retry; a second 401 surfaces as a normal error
}

// Creates a fresh Meet space and returns its joining URI (https://meet.google.com/...).
async function createMeetSpace(tokenStore) {
  const res = await withAuthRetry(tokenStore, (accessToken) =>
    fetch(MEET_SPACES_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    })
  );
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const message = data.error?.message || data.error_description || "unknown error";
    throw new Error(`Meet space creation failed (${res.status}): ${message}`);
  }

  const uri = data.meetingUri || (data.meetingCode && `https://meet.google.com/${data.meetingCode}`);
  if (!uri) throw new Error("Meet API returned no meeting URI");
  return uri;
}

module.exports = { missingConfig, authUrl, exchangeCode, createMeetSpace };
