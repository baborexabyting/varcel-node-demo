function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

const CSS = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px;
  font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  background: #f5f6f8; color: #1c1e21; }
main { width: 100%; max-width: 460px; }
.card { background: #fff; border: 1px solid #e2e5ea; border-radius: 12px; padding: 28px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.06); }
h1 { margin: 0 0 16px; font-size: 20px; }
label { display: block; margin-bottom: 14px; font-size: 14px; font-weight: 600; }
input { width: 100%; margin-top: 6px; padding: 10px 12px; border: 1px solid #c9ced6;
  border-radius: 8px; font: inherit; }
input:focus { outline: 2px solid #2563eb; outline-offset: 1px; border-color: #2563eb; }
button { padding: 10px 16px; border: 0; border-radius: 8px; background: #2563eb; color: #fff;
  font: inherit; font-weight: 600; cursor: pointer; }
button:hover { background: #1d4ed8; }
button.secondary { background: #6b7280; }
button.secondary:hover { background: #4b5563; }
.status { border-radius: 8px; padding: 12px; margin-bottom: 18px; }
.status.ok { background: #ecfdf5; color: #065f46; }
.status.warn { background: #fffbeb; color: #92400e; }
.status.bad { background: #fef2f2; color: #991b1b; }
.actions { display: flex; flex-direction: column; gap: 10px; align-items: flex-start; }
.muted { color: #6b7280; font-size: 14px; }
.error { color: #b91c1c; background: #fef2f2; padding: 10px 12px; border-radius: 8px; }
.hint { margin-top: 20px; font-size: 13px; color: #6b7280; }
code { background: #eef0f3; padding: 2px 6px; border-radius: 4px; }
a { color: #2563eb; }
`;

function layout(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${CSS}</style>
</head>
<body><main>${body}</main></body>
</html>`;
}

function login(error) {
  return layout(
    "Login",
    `<div class="card">
      <h1>🔐 Admin login</h1>
      ${error ? `<p class="error">${esc(error)}</p>` : ""}
      <form method="post" action="/login">
        <label>Email <input type="email" name="email" required autofocus></label>
        <label>Password <input type="password" name="password" required></label>
        <button type="submit">Log in</button>
      </form>
    </div>`
  );
}

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

function dashboard({ connected, account, lastRefreshedAt, checked }) {
  const banner =
    checked === "ok"
      ? `<section class="status ok">✅ Connection check passed — token refreshed successfully.</section>`
      : checked === "failed"
        ? `<section class="status bad">❌ Connection check failed — if it keeps failing, reconnect the account. (Reason is in the server log.)</section>`
        : "";
  const lastVerified = lastRefreshedAt ? `<div class="muted" style="margin-top:6px">Last verified: ${esc(fmtDate(lastRefreshedAt))}</div>` : "";

  return layout(
    "Dashboard",
    `<div class="card">
      <h1>🚀 Meet-on-demand</h1>
      ${banner}
      <section class="status ${connected ? "ok" : "warn"}">
        ${
          connected
            ? `✅ Google account connected${account ? `: <strong>${esc(account)}</strong>` : ""}.`
            : "⚠️ No Google account connected yet — connect one to generate Meet links."
        }
      </section>
      ${lastVerified}
      <div class="actions" style="margin-top:16px">
        ${
          connected
            ? `<form method="post" action="/check-connection">
                 <button type="submit">Check connection</button>
               </form>
               <form method="get" action="/auth/google">
                 <button class="secondary" type="submit">Reconnect / switch account</button>
               </form>`
            : `<form method="get" action="/auth/google">
                 <button type="submit">Connect Google account</button>
               </form>`
        }
        <a class="muted" href="/logout">Log out</a>
      </div>
      <section class="hint">
        Slack slash command: <code>POST /api/slash</code> — replies with a freshly created Google Meet link.
        <strong>Check connection</strong> verifies the Google session by refreshing the token.
      </section>
    </div>`
  );
}

function errorPage(message) {
  return layout(
    "Error",
    `<div class="card">
      <h1>😖 Something went wrong</h1>
      <p class="error">${esc(message)}</p>
      <p><a href="/">Back to dashboard</a></p>
    </div>`
  );
}

module.exports = { login, dashboard, error: errorPage };
