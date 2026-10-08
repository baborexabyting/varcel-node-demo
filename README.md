# Meet-on-demand (Vercel + Express + Slack)

A small Express app (deployable to Vercel) that answers a Slack slash command with a
**freshly created Google Meet link** — each `/meet` gets its own unique instant meeting.

It has a tiny web panel: log in with an admin email/password, connect a Google account
via OAuth 2, and the app stores the tokens and uses them to create Meet spaces on demand.

## How it fits together

```
Slack ──POST /api/slash──▶ Express app ──creates──▶ Google Meet API (unique space per call)
                              ▲
Admin ──login (/login)──▶ dashboard (/) ──connect──▶ Google OAuth (/auth/google)
                              │
                     tokens persisted to data/google-tokens.json
```

## Setup

### 1. Configure `.env`

```bash
cp .env.example .env
```

Fill in `ADMIN_EMAIL` / `ADMIN_PASSWORD` (panel login) and a long random `SESSION_SECRET`.

### 2. Google Cloud Console

1. Create/select a project at <https://console.cloud.google.com>.
2. **APIs & Services → Library** → enable the **Google Meet API**.
3. **APIs & Services → OAuth consent screen**: pick *External*, add your own Google
   account as a **test user** (test mode is fine for personal use).
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**,
   type **Web application**.
5. Add an **Authorized redirect URI** that exactly matches `GOOGLE_REDIRECT_URI`:
   - local dev: `http://localhost:8080/auth/google/callback`
   - deployed: `https://<your-app>.vercel.app/auth/google/callback`
6. Copy the client ID / secret into `.env`.

### 3. Run

```bash
npm install
npm start          # http://localhost:8080
```

Log in, click **Connect Google account**, approve the permissions. The dashboard will
show the connected account; tokens are saved to `data/google-tokens.json` (gitignored).

### 4. Slack slash command

1. Create an app at <https://api.slack.com/apps> → **Slash Commands** → create one
   (e.g. `/meet`) with the request URL `https://<your-host>/api/slash`.
2. Recommended: copy the app's **Signing Secret** into `SLACK_SIGNING_SECRET` —
   unsigned requests then get rejected with a 401.
3. Type `/meet` in any channel → the bot replies in-channel with a unique Meet link.

## Deploying to Vercel

Set the same variables (`ADMIN_EMAIL`, `ADMIN_PASSWORD`, `SESSION_SECRET`,
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, optionally
`SLACK_SIGNING_SECRET`) in Vercel → Project → Settings → Environment Variables.

⚠️ **Token persistence caveat:** Vercel's filesystem is read-only except `/tmp`, and
`/tmp` is wiped on cold starts. By default tokens go to `/tmp/google-tokens.json` there,
which means you may need to reconnect the Google account after a cold start. For
production, point `TOKEN_STORE_PATH` at a durable store (or swap `lib/tokenStore.js`
for Vercel Blob / Upstash Redis / a database).

## Routes

| Route | What it does |
| --- | --- |
| `GET /login`, `POST /login`, `GET /logout` | Admin panel auth (credentials from `.env`) |
| `GET /` | Dashboard: connection status + connect/disconnect buttons |
| `GET /auth/google`, `GET /auth/google/callback` | OAuth 2 flow (state-cookie protected) |
| `POST /disconnect` | Delete stored Google tokens |
| `POST /api/slash` | Slack slash command → fresh Meet link, posted in-channel |

## Notes

- No runtime dependencies beyond Express/body-parser: `.env` loading uses Node's
  built-in `process.loadEnvFile()` (Node ≥ 20.12) and all Google calls use `fetch`.
- Login sessions are stateless HMAC-signed cookies (`SESSION_SECRET`), so they survive
  serverless restarts.
- Meet links are created through the Google Meet REST API (`spaces.create`), so nothing
  is added to your calendar.
