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

// Reverse proxy: /run-preview/:channelId/* → the user's running process.
// Must be registered BEFORE express.json() so the request body is not pre-consumed.
app.use("/run-preview/:channelId", (req, res) => {
  const { channelId } = req.params;
  const session = getSession(channelId);

  if (!session || session.status !== "running" || !session.port) {
    res.status(503).send("Project is not running. Use /run-project in Discord to start it.");
    return;
  }

  // Strip the /run-preview/:channelId prefix from the forwarded path
  const targetPath = req.url || "/";
  const proxyOptions: http.RequestOptions = {
    hostname: "localhost",
    port: session.port,
    path: targetPath,
    method: req.method,
    headers: {
      ...req.headers,
      host: `localhost:${session.port}`,
    },
  };

  const proxyReq = http.request(proxyOptions, (proxyRes) => {
    // Forward status + headers
    res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on("error", (err) => {
    logger.warn({ err, channelId, port: session.port }, "Proxy connection failed");
    if (!res.headersSent) {
      res.status(502).send("Could not connect to the running project. It may still be starting up.");
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
