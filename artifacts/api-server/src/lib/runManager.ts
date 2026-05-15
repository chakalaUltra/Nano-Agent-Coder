import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import Groq from "groq-sdk";

export type RunStatus = "cloning" | "installing" | "running" | "error" | "stopped" | "fixing";

export interface RunSession {
  channelId: string;
  discordId: string;
  repoFullName: string;
  status: RunStatus;
  port: number;
  workDir: string;
  projectType: string;
  runCommand: string;
  envVars: Record<string, string>;
  logs: string[];
  process: ChildProcess | null;
  startedAt: Date;
  autoFixAttempts: number;
  url: string;
}

const sessions = new Map<string, RunSession>();
const MAX_LOGS = 100;
const PORT_BASE = 9100;
let portCursor = 0;

// Allocate a port from a small pool (9100–9119) cycling round-robin.
// If the same channel already has a port, reuse it.
const channelPorts = new Map<string, number>();
export function allocatePort(channelId: string): number {
  if (channelPorts.has(channelId)) return channelPorts.get(channelId)!;
  const port = PORT_BASE + (portCursor % 20);
  portCursor++;
  channelPorts.set(channelId, port);
  return port;
}

export function getSession(channelId: string): RunSession | undefined {
  return sessions.get(channelId);
}

export function createSession(params: {
  channelId: string;
  discordId: string;
  repoFullName: string;
  port: number;
  workDir: string;
  projectType: string;
  runCommand: string;
  envVars: Record<string, string>;
  devDomain: string;
}): RunSession {
  const session: RunSession = {
    channelId: params.channelId,
    discordId: params.discordId,
    repoFullName: params.repoFullName,
    status: "cloning",
    port: params.port,
    workDir: params.workDir,
    projectType: params.projectType,
    runCommand: params.runCommand,
    envVars: params.envVars,
    logs: [],
    process: null,
    startedAt: new Date(),
    autoFixAttempts: 0,
    url: params.devDomain
      ? `https://${params.devDomain}/run-preview/${params.channelId}/`
      : `http://localhost:${params.port}/`,
  };
  sessions.set(params.channelId, session);
  return session;
}

export function appendLog(channelId: string, line: string): void {
  const session = sessions.get(channelId);
  if (!session) return;
  const timestamp = new Date().toLocaleTimeString("en-GB", { hour12: false });
  session.logs.push(`[${timestamp}] ${line}`);
  if (session.logs.length > MAX_LOGS) session.logs.shift();
}

export function setStatus(channelId: string, status: RunStatus): void {
  const session = sessions.get(channelId);
  if (!session) return;
  session.status = status;
}

export function setProcess(channelId: string, proc: ChildProcess): void {
  const session = sessions.get(channelId);
  if (!session) return;
  session.process = proc;
}

export async function stopSession(channelId: string): Promise<void> {
  const session = sessions.get(channelId);
  if (!session) return;
  if (session.process) {
    try { session.process.kill("SIGTERM"); } catch {}
    session.process = null;
  }
  session.status = "stopped";
  try { await rm(session.workDir, { recursive: true, force: true }); } catch {}
  sessions.delete(channelId);
  channelPorts.delete(channelId);
}

// Attempt to detect and fix an error using Groq AI.
// Reads the stderr tail, asks the model for a fix, writes patched files, restarts.
export async function autoFix(channelId: string, groqApiKey: string): Promise<void> {
  const session = sessions.get(channelId);
  if (!session || session.status !== "error" || session.autoFixAttempts >= 3) return;

  session.status = "fixing";
  session.autoFixAttempts++;
  appendLog(channelId, `[Nano] Auto-fix attempt ${session.autoFixAttempts}/3 — analysing error...`);

  // Collect the last ~30 error lines
  const errorLines = session.logs.filter(l => l.includes("Error") || l.includes("error") || l.includes("ERR") || l.includes("Traceback")).slice(-30);
  if (errorLines.length === 0) {
    appendLog(channelId, "[Nano] Could not identify a specific error to fix.");
    session.status = "error";
    return;
  }

  // Read the relevant files from the working directory (package.json + entry file)
  let fileContext = "";
  const candidateFiles = ["index.js", "index.ts", "app.js", "app.ts", "server.js", "server.ts", "main.py", "app.py", "package.json"];
  for (const f of candidateFiles) {
    const p = path.join(session.workDir, f);
    if (existsSync(p)) {
      try {
        const { readFileSync } = await import("node:fs");
        const content = readFileSync(p, "utf-8").slice(0, 4000);
        fileContext += `\n// ===== ${f} =====\n${content}\n`;
      } catch {}
    }
  }

  try {
    const groq = new Groq({ apiKey: groqApiKey });
    const prompt = `You are a debugging assistant. A project is failing to run. Fix it.

Error output:
${errorLines.join("\n")}

Current files:
${fileContext || "(could not read files)"}

Respond ONLY with a JSON block in this exact format — no other text:
\`\`\`json
{
  "action": "update_files",
  "files": [
    { "path": "relative/path.ext", "content": "full corrected file content" }
  ],
  "explanation": "what was wrong and what was fixed"
}
\`\`\``;

    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 4096,
      temperature: 0.1,
    });

    const reply = completion.choices[0]?.message?.content ?? "";
    const match = reply.match(/```json\s*([\s\S]*?)```/);
    if (!match) throw new Error("No JSON block in AI response");

    const parsed = JSON.parse(match[1]);
    if (parsed.action !== "update_files" || !Array.isArray(parsed.files)) throw new Error("Invalid fix format");

    for (const f of parsed.files) {
      const filePath = path.join(session.workDir, f.path);
      const dir = path.dirname(filePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(filePath, f.content, "utf-8");
    }

    appendLog(channelId, `[Nano] Fix applied: ${parsed.explanation ?? "files updated"}`);
    appendLog(channelId, "[Nano] Restarting process...");

    // Kill old process and restart
    if (session.process) {
      try { session.process.kill("SIGTERM"); } catch {}
      session.process = null;
    }

    await new Promise(r => setTimeout(r, 1500));
    startProcess(channelId);
  } catch (err: any) {
    appendLog(channelId, `[Nano] Auto-fix failed: ${err?.message ?? "unknown error"}`);
    session.status = "error";
  }
}

// Spawns the project process. Called after cloning + installing deps.
export function startProcess(channelId: string): void {
  const session = sessions.get(channelId);
  if (!session) return;

  const [cmd, ...args] = session.runCommand.split(" ");
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    ...session.envVars,
    PORT: String(session.port),
    NODE_ENV: "production",
  };

  let proc: ChildProcess;
  try {
    proc = spawn(cmd, args, {
      cwd: session.workDir,
      env,
      shell: true,
    });
  } catch (err: any) {
    appendLog(channelId, `[Nano] Failed to spawn process: ${err?.message}`);
    session.status = "error";
    return;
  }

  session.process = proc;
  session.status = "running";

  proc.stdout?.on("data", (data: Buffer) => {
    const lines = data.toString().split("\n").filter(Boolean);
    for (const line of lines) appendLog(channelId, line);
  });

  let stderrBuffer = "";
  let errorTimeout: ReturnType<typeof setTimeout> | null = null;

  proc.stderr?.on("data", (data: Buffer) => {
    const lines = data.toString().split("\n").filter(Boolean);
    for (const line of lines) {
      appendLog(channelId, `[stderr] ${line}`);
      stderrBuffer += line + "\n";
    }

    // Debounce error detection — if we see stderr, wait 4 seconds then check
    if (errorTimeout) clearTimeout(errorTimeout);
    errorTimeout = setTimeout(() => {
      const s = sessions.get(channelId);
      if (!s || s.status !== "running") return;
      const isFatal = /error|exception|crash|failed|cannot|ENOENT|EADDRINUSE|SyntaxError|TypeError|ReferenceError/i.test(stderrBuffer);
      if (isFatal) {
        s.status = "error";
        const groqKey = process.env.GROQ_API_KEY;
        if (groqKey && s.autoFixAttempts < 3) {
          autoFix(channelId, groqKey);
        }
      }
      stderrBuffer = "";
    }, 4000);
  });

  proc.on("close", (code) => {
    const s = sessions.get(channelId);
    if (!s) return;
    appendLog(channelId, `[Nano] Process exited with code ${code}`);
    if (s.status === "running") s.status = code === 0 ? "stopped" : "error";
    s.process = null;
  });

  proc.on("error", (err) => {
    appendLog(channelId, `[Nano] Spawn error: ${err.message}`);
    const s = sessions.get(channelId);
    if (s) s.status = "error";
  });
}
