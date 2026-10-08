const crypto = require("crypto");
const config = require("./config");

// Verifies Slack's signed requests
// (https://api.slack.com/authentication/verifying-requests-from-slack).
// Verification is skipped when SLACK_SIGNING_SECRET is not configured.
function verifyRequest(req, rawBody) {
  if (!config.slackSigningSecret) return true;

  const timestamp = req.headers["x-slack-request-timestamp"];
  const signature = req.headers["x-slack-signature"];
  if (!timestamp || !signature) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 60 * 5) return false; // replay window

  const expected =
    "v0=" +
    crypto
      .createHmac("sha256", config.slackSigningSecret)
      .update(`v0:${timestamp}:${rawBody ?? ""}`)
      .digest("hex");

  return (
    expected.length === signature.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
  );
}

module.exports = { verifyRequest };
