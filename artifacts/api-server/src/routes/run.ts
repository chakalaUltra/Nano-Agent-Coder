import { Router } from "express";
import { db, usersTable, chatSessionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { execSync, exec } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { logger } from "../lib/logger.js";
import * as runManager from "../lib/runManager.js";

const router = Router();

const BASE_WORK_DIR = "/tmp/nano-runs";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Fetch a file from GitHub and return its text content, or null if not found.
async function fetchGithubFile(owner: string, repo: string, filePath: string, token: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`, {
      headers: { Authorization: `Bearer ${token}`, "User-Agent": "NanoAgent" },
    });
    if (!res.ok) return null;
    const data = await res.json() as { content?: string; encoding?: string };
    if (!data.content || data.encoding !== "base64") return null;
    return Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf-8");
  } catch {
    return null;
  }
}

// Fetch the repo file tree from GitHub.
async function fetchTree(owner: string, repo: string, token: string): Promise<string[]> {
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`, {
      headers: { Authorization: `Bearer ${token}`, "User-Agent": "NanoAgent" },
    });
    if (!res.ok) return [];
    const data = await res.json() as { tree: Array<{ path: string; type: string }> };
    return data.tree.filter(f => f.type === "blob").map(f => f.path);
  } catch {
    return [];
  }
}

// Parse .env.example to extract variable names.
function parseEnvExample(content: string): string[] {
  const keys: string[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    // Skip vars we set ourselves
    if (["PORT", "NODE_ENV", "HOST", "HOSTNAME"].includes(key)) continue;
    keys.push(key);
  }
  return keys;
}

// Detect project type and a suitable run command from the file tree + package.json content.
function detectProject(files: string[], packageJsonContent: string | null): { projectType: string; runCommand: string } {
  // Node.js via package.json
  if (packageJsonContent) {
    try {
      const pkg = JSON.parse(packageJsonContent) as { scripts?: Record<string, string> };
      const scripts = pkg.scripts ?? {};
      for (const preferred of ["start", "serve", "preview", "dev"]) {
        if (scripts[preferred]) {
          return { projectType: "Node.js", runCommand: `npm run ${preferred}` };
        }
      }
    } catch {}
    // Has package.json but no recognised script — try node on the entry
    const entry = ["index.js", "server.js", "app.js", "main.js"].find(f => files.includes(f));
    return { projectType: "Node.js", runCommand: entry ? `node ${entry}` : "npm start" };
  }

  // Python
  if (files.includes("requirements.txt") || files.includes("setup.py") || files.includes("pyproject.toml")) {
    const entry = ["main.py", "app.py", "server.py", "run.py", "manage.py"].find(f => files.includes(f));
    return { projectType: "Python", runCommand: entry ? `python ${entry}` : "python main.py" };
  }

  // Go
  if (files.includes("go.mod")) {
    return { projectType: "Go", runCommand: "go run ." };
  }

  // Rust
  if (files.includes("Cargo.toml")) {
    return { projectType: "Rust", runCommand: "cargo run" };
  }

  // Ruby
  if (files.includes("Gemfile")) {
    const entry = ["app.rb", "server.rb", "main.rb", "config.ru"].find(f => files.includes(f));
    return { projectType: "Ruby", runCommand: entry ? `ruby ${entry}` : "ruby app.rb" };
  }

  // PHP
  if (files.some(f => f.endsWith(".php"))) {
    return { projectType: "PHP", runCommand: "php -S 0.0.0.0:$PORT" };
  }

  // Fallback
  return { projectType: "Unknown", runCommand: "npm start" };
}

// Build the dependency install command for a project type.
function installCommand(projectType: string, files: string[]): string {
  switch (projectType) {
    case "Node.js": {
      if (files.includes("pnpm-lock.yaml")) return "pnpm install --prod";
      if (files.includes("yarn.lock")) return "yarn install --production";
      return "npm install --omit=dev";
    }
    case "Python":
      return files.includes("requirements.txt") ? "pip install -r requirements.txt" : "true";
    case "Go":
      return "go mod download";
    case "Rust":
      return "cargo build --release";
    case "Ruby":
      return "bundle install";
    default:
      return "true";
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// POST /run/prepare
// Analyses the repo and returns: what env vars are needed, project type, run command.
router.post("/run/prepare", async (req, res) => {
  const { channelId } = req.body as { channelId: string };

  logger.info({ channelId }, "run/prepare called");

  if (!channelId) {
    res.status(400).json({ error: "channelId is required" });
    return;
  }

  const [session] = await db.select().from(chatSessionsTable).where(eq(chatSessionsTable.channelId, channelId)).limit(1);

  logger.info({ channelId, found: !!session }, "run/prepare session lookup");

  if (!session) { res.status(404).json({ error: "No active session — use /start first to pick a repository" }); return; }

  const existing = runManager.getSession(channelId);
  if (existing && existing.status !== "stopped") {
    res.json({ alreadyRunning: true, envVarsNeeded: [], projectType: existing.projectType, runCommand: existing.runCommand });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.discordId, session.discordId)).limit(1);
  if (!user?.githubAccessToken) { res.status(401).json({ error: "GitHub not connected" }); return; }

  const [owner, repo] = session.repoFullName.split("/");
  const token = user.githubAccessToken;

  const [files, packageJsonContent, envExampleContent] = await Promise.all([
    fetchTree(owner, repo, token),
    fetchGithubFile(owner, repo, "package.json", token),
    fetchGithubFile(owner, repo, ".env.example", token)
      .then(c => c ?? fetchGithubFile(owner, repo, ".env.sample", token))
      .then(c => c ?? fetchGithubFile(owner, repo, ".env.template", token)),
  ]);

  const { projectType, runCommand } = detectProject(files, packageJsonContent);
  const envVarsNeeded = envExampleContent ? parseEnvExample(envExampleContent) : [];

  res.json({ alreadyRunning: false, envVarsNeeded, projectType, runCommand });
});

// POST /run/start
// Clones the repo, installs deps, and starts the process. Responds immediately;
// the actual work happens in the background.
router.post("/run/start", async (req, res) => {
  const { channelId, envVars = {} } = req.body as { channelId: string; envVars: Record<string, string> };

  const [session] = await db.select().from(chatSessionsTable).where(eq(chatSessionsTable.channelId, channelId)).limit(1);
  if (!session) { res.status(404).json({ error: "No active session" }); return; }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.discordId, session.discordId)).limit(1);
  if (!user?.githubAccessToken) { res.status(401).json({ error: "GitHub not connected" }); return; }

  const [owner, repo] = session.repoFullName.split("/");
  const token = user.githubAccessToken;

  const [files, packageJsonContent, envExampleContent] = await Promise.all([
    fetchTree(owner, repo, token),
    fetchGithubFile(owner, repo, "package.json", token),
    fetchGithubFile(owner, repo, ".env.example", token)
      .then(c => c ?? fetchGithubFile(owner, repo, ".env.sample", token)),
  ]);

  const { projectType, runCommand } = detectProject(files, packageJsonContent);
  const port = runManager.allocatePort(channelId);
  const workDir = path.join(BASE_WORK_DIR, channelId);
  const devDomain = process.env.REPLIT_DEV_DOMAIN ?? "";

  const runSession = runManager.createSession({
    channelId,
    discordId: session.discordId,
    repoFullName: session.repoFullName,
    port,
    workDir,
    projectType,
    runCommand,
    envVars,
    devDomain,
  });

  res.json({ ok: true, url: runSession.url, port });

  // Clone, install, and run in the background
  setImmediate(async () => {
    try {
      // Clean up previous run dir if it exists
      if (existsSync(workDir)) {
        execSync(`rm -rf "${workDir}"`);
      }
      mkdirSync(workDir, { recursive: true });

      runManager.appendLog(channelId, `Cloning ${session.repoFullName}...`);
      runManager.setStatus(channelId, "cloning");

      const cloneUrl = `https://${token}@github.com/${owner}/${repo}.git`;
      execSync(`git clone --depth=1 "${cloneUrl}" "${workDir}" 2>&1`, { timeout: 60_000 });

      runManager.appendLog(channelId, "Clone complete. Installing dependencies...");
      runManager.setStatus(channelId, "installing");

      const installCmd = installCommand(projectType, files);
      execSync(`cd "${workDir}" && ${installCmd} 2>&1`, { timeout: 120_000 });

      runManager.appendLog(channelId, `Dependencies installed. Starting: ${runCommand}`);
      runManager.startProcess(channelId);
      runManager.appendLog(channelId, `Project started on port ${port}. URL: ${runSession.url}`);
    } catch (err: any) {
      runManager.appendLog(channelId, `[Nano] Startup failed: ${err?.message ?? "unknown error"}`);
      runManager.setStatus(channelId, "error");
      logger.error(err, "run/start background task failed");
    }
  });
});

// GET /run/console/:channelId
// Returns the current console output, status, and any fix/error events.
router.get("/run/console/:channelId", (req, res) => {
  const { channelId } = req.params;
  const session = runManager.getSession(channelId);
  if (!session) {
    res.status(404).json({ error: "No run session" });
    return;
  }
  res.json({
    logs: session.logs,
    status: session.status,
    url: session.url,
    port: session.port,
    autoFixAttempts: session.autoFixAttempts,
    events: session.events,
  });
});

// POST /run/stop
// Kills the running process and cleans up.
router.post("/run/stop", async (req, res) => {
  const { channelId } = req.body as { channelId: string };
  await runManager.stopSession(channelId);
  res.json({ ok: true });
});

export default router;
