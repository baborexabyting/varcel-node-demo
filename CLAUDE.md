# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An Express app (deployed to Vercel) that backs a Slack slash command: `POST /api/slash`
creates a **unique instant Google Meet space** per invocation (Google Meet REST API
`spaces.create`) and replies in-channel with the link. A small admin web panel
(email/password login from `.env`) drives the Google OAuth 2 connection.

## Commands

```bash
npm install
npm start        # runs `node server`; listens on process.env.PORT or 8080
```

There are no tests or linters configured. Node ≥ 20.12 is required
(`engines` field; uses `process.loadEnvFile()` and global `fetch` — no dotenv dependency).

## Architecture

```
server.js            Express wiring: login, dashboard, Google OAuth routes, /api/slash
lib/config.js        Reads .env (via process.loadEnvFile), exports typed config
lib/session.js       Stateless HMAC-signed-cookie sessions + cookie helpers + safeEqual
lib/tokenStore.js    In-memory Google tokens, refresh token seeded from GOOGLE_REFRESH_TOKEN env
lib/google.js        OAuth auth URL, code exchange, token refresh, Meet space creation
lib/slack.js         Slack request-signature verification (only when SLACK_SIGNING_SECRET set)
lib/pages.js         Inline-HTML pages (login/dashboard/error), no template engine
```

Request flow worth knowing:

- **Auth**: `POST /login` compares credentials against `ADMIN_EMAIL`/`ADMIN_PASSWORD`
  (timing-safe) and sets a signed cookie. `requireLogin` middleware guards the dashboard
  and OAuth routes. The session is stateless (signed payload, no server-side store), so
  it works across serverless cold starts.
- **Google OAuth**: `/auth/google` sets a short-lived random `oauth_state` cookie and
  redirects to Google (`access_type=offline&prompt=consent` so a refresh token is always
  issued). The callback validates state, exchanges the code, and persists tokens via
  `tokenStore`.
- **Slash command**: `/api/slash` verifies the Slack signature (`req.rawBody` is captured
  via body-parser's `verify` callback for this), then `google.createMeetSpace(tokenStore)`
  creates the meeting. Token handling lives inside it, axios-interceptor style: the stored
  token is refreshed proactively when near expiry, and if the API call still answers 401
  it force-refreshes once and replays the request (refresh is single-flight, so concurrent
  requests share one round-trip). `invalid_grant` clears the token store and the Slack
  reply asks the admin to reconnect. The link is posted `in_channel`; errors go back as
  ephemeral messages so only the invoking user sees them.

## Environment

Config comes from `.env` locally (see `.env.example`; `.env` is gitignored) and from the
Vercel dashboard in production. Key vars: `ADMIN_EMAIL`, `ADMIN_PASSWORD`,
`SESSION_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`
(must exactly match the redirect URI registered in Google Cloud Console), `GOOGLE_REFRESH_TOKEN`
(seeds the in-memory token store at boot), optional `SLACK_SIGNING_SECRET` and
`GOOGLE_ACCOUNT_EMAIL` (display-only hint).

## Vercel caveats

- `vercel.json` uses the legacy `builds` + `routes` config: `server.js` is built with
  `@vercel/node` and every path (`/(.*)`) routes into it.
- Token storage is in-memory only (no file writes, Vercel-safe): the refresh
  token is seeded from `GOOGLE_REFRESH_TOKEN` at boot and access tokens live in
  process memory, refreshed on demand. After OAuth connect, copy the dashboard's
  refresh token into the env var so it survives restarts.
- The Google Meet API must be enabled on the Google Cloud project (setup steps in README.md).
- Express 5 is used — differs from v4 in routing/error handling (async rejections are
  forwarded to the error handler automatically).
