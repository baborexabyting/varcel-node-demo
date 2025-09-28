const express = require("express");
const bodyParser = require("body-parser");

const app = express();

app.use(bodyParser.urlencoded({ extended: true }));

const port = process.env.PORT || 8080;

// Root route (for testing)
app.get("/", (req, res) => {
  res.send("🚀 Express app is running on Vercel");
});

// Slash command route
app.post("/api/slash", (req, res) => {
  const msg = `https://meet.google.com/ikw-ghpa-yqb`;

  res.json({
    response_type: "in_channel",
    text: `${msg}`
  });
});

app.listen(port, () => {
  `Server started on port ${port}`;
});
