import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import http from "node:http";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";
import { getSession } from "./lib/runManager.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

app.use(cors({ origin: true, credentials: true }));

// ---------------------------------------------------------------------------
// Reverse proxy: /run-preview/<channelId>/<...rest> → running project port
// Mounted WITHOUT a path param so the matching works reliably in Express 5.
// We parse channelId and the sub-path manually from req.path.
// Must be before express.json() so body stream is not consumed.
// ---------------------------------------------------------------------------
app.use("/run-preview", (req, res) => {
  // req.path here is "/<channelId>" or "/<channelId>/rest/of/path"
  const parts = req.path.split("/").filter(Boolean);
  const channelId = parts[0];

  if (!channelId) {
    res.status(400).send("Missing channel ID in path.");
    return;
  }

  const session = getSession(channelId);

  if (!session) {
    res.status(503).send(
      "No run session found for this channel. Use /run-project in Discord to start your project."
    );
    return;
  }

  if (session.status !== "running") {
    const label: Record<string, string> = {
      cloning: "Cloning repository…",
      installing: "Installing dependencies…",
      fixing: "Nano is auto-fixing an error…",
      error: "The project encountered an error. Nano is attempting to fix it.",
      stopped: "The project has been stopped.",
    };
    res.status(503).send(
      `<html><body style="font-family:sans-serif;padding:2rem">` +
      `<h2>Project not running yet</h2>` +
      `<p>${label[session.status] ?? "Starting…"}</p>` +
      `<p>Status: <strong>${session.status}</strong></p>` +
      `<meta http-equiv="refresh" content="5">` +
      `</body></html>`
    );
    return;
  }

  const subPath = "/" + parts.slice(1).join("/") + (req.url.includes("?") ? "?" + req.url.split("?")[1] : "");

  const proxyOptions: http.RequestOptions = {
    hostname: "localhost",
    port: session.port,
    path: subPath || "/",
    method: req.method,
    headers: {
      ...req.headers,
      host: `localhost:${session.port}`,
      "x-forwarded-host": req.headers.host ?? "",
      "x-forwarded-proto": "https",
    },
  };

  const proxyReq = http.request(proxyOptions, (proxyRes) => {
    res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on("error", (err) => {
    logger.warn({ err, channelId, port: session.port }, "Proxy connection failed");
    if (!res.headersSent) {
      res.status(502).send(
        `<html><body style="font-family:sans-serif;padding:2rem">` +
        `<h2>Cannot reach project</h2>` +
        `<p>Could not connect to the running project on port ${session.port}. ` +
        `It may still be starting up — try refreshing in a few seconds.</p>` +
        `<meta http-equiv="refresh" content="3">` +
        `</body></html>`
      );
    }
  });

  req.pipe(proxyReq, { end: true });
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

const staticDir = path.resolve(__dirname, "../../web/dist/public");
if (existsSync(staticDir)) {
  app.use(express.static(staticDir));
  app.get("/{*path}", (_req, res) => {
    res.sendFile(path.join(staticDir, "index.html"));
  });
}

export default app;
