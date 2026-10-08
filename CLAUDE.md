# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A minimal Express app deployed to Vercel that backs a Slack slash command. The entire app lives in `server.js`:

- `GET /` — health-check route returning a plain string.
- `POST /api/slash` — Slack slash command endpoint. Slack sends slash command payloads as `application/x-www-form-urlencoded`, which is why `body-parser`'s urlencoded middleware is used. It responds with `response_type: "in_channel"` and a Google Meet link (currently hardcoded).

## Commands

```bash
npm install
npm start        # runs `node server`; listens on process.env.PORT or 8080
```

There are no tests or linters configured.

## Deployment / architecture notes

- `vercel.json` uses the legacy `builds` + `routes` configuration: `server.js` is built with `@vercel/node` and **every** path (`/(.*)`) is routed into it, so the Express router handles all traffic.
- The `app.listen(port, ...)` call in `server.js` is for local development; on Vercel the app runs as a serverless function. The `PORT` env var is set by Vercel automatically.
- Dependencies: Express 5 and body-parser 2. Note Express 5 differs from 4 in routing/error behavior (e.g. async error propagation, changed wildcard route syntax).
