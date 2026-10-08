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
lib/tokenStore.js    Persists Google tokens to a JSON file (data/ locally, /tmp on Vercel)
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
  via body-parser's `verify` callback for this), then `google.getValidAccessToken()`
  returns the stored access token or refreshes it (on `invalid_grant` the token store is
  cleared and the Slack reply asks the admin to reconnect), then `createMeetSpace()`
  creates the meeting and the link is posted `in_channel`. Errors go back as ephemeral
  messages so only the invoking user sees them.

## Environment

Config comes from `.env` locally (see `.env.example`; `.env` is gitignored) and from the
Vercel dashboard in production. Key vars: `ADMIN_EMAIL`, `ADMIN_PASSWORD`,
`SESSION_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`
(must exactly match the redirect URI registered in Google Cloud Console), optional
`SLACK_SIGNING_SECRET` and `TOKEN_STORE_PATH`.

## Vercel caveats

- `vercel.json` uses the legacy `builds` + `routes` config: `server.js` is built with
  `@vercel/node` and every path (`/(.*)`) routes into it.
- Token persistence: Vercel's filesystem is read-only except `/tmp`, which is wiped on
  cold starts — `tokenStore` falls back to `/tmp/google-tokens.json` there and warns.
  Durable storage (DB / Blob / Redis) would be needed for production.
- The Google Meet API must be enabled on the Google Cloud project (setup steps in README.md).
- Express 5 is used — differs from v4 in routing/error handling (async rejections are
  forwarded to the error handler automatically).
