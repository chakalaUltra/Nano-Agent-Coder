import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import Groq from "groq-sdk";

export type RunStatus = "cloning" | "installing" | "running" | "error" | "stopped" | "fixing";

export interface RunEvent {
  type: "error_detected" | "fix_start" | "fix_done" | "fix_failed" | "info";
  message: string;
  at: string;
}

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
  events: RunEvent[];
  process: ChildProcess | null;
  startedAt: Date;
  autoFixAttempts: number;
  url: string;
}

const sessions = new Map<string, RunSession>();
const MAX_LOGS = 150;
const PORT_BASE = 9100;
let portCursor = 0;

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
    events: [],
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

function addEvent(channelId: string, type: RunEvent["type"], message: string): void {
  const session = sessions.get(channelId);
  if (!session) return;
  session.events.push({ type, message, at: new Date().toISOString() });
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
export async function autoFix(channelId: string, groqApiKey: string): Promise<void> {
  const session = sessions.get(channelId);
  if (!session || session.status !== "error" || session.autoFixAttempts >= 3) {
    if (session && session.autoFixAttempts >= 3) {
      addEvent(channelId, "fix_failed", "Reached maximum fix attempts (3). Manual intervention needed.");
    }
    return;
  }

  session.status = "fixing";
  session.autoFixAttempts++;

  // Collect the error context from recent logs
  const errorLines = session.logs
    .filter(l => /error|Error|ERROR|exception|Exception|Traceback|warn|WARN/i.test(l))
    .slice(-30)
    .join("\n");

  const summary = errorLines.slice(0, 400) || "Unknown error";
  addEvent(channelId, "error_detected", `Error detected:\n\`\`\`\n${summary}\n\`\`\``);
  addEvent(channelId, "fix_start", `Starting auto-fix attempt ${session.autoFixAttempts}/3...`);

  appendLog(channelId, `[Nano] Auto-fix attempt ${session.autoFixAttempts}/3 — analysing error...`);

  // Read relevant source files
  let fileContext = "";
  const candidates = [
    "index.js", "index.ts", "app.js", "app.ts",
    "server.js", "server.ts", "main.py", "app.py",
    "package.json", "requirements.txt",
  ];
  for (const f of candidates) {
    const p = path.join(session.workDir, f);
    if (existsSync(p)) {
      try {
        const content = readFileSync(p, "utf-8").slice(0, 3000);
        fileContext += `\n// ===== ${f} =====\n${content}\n`;
      } catch {}
    }
  }

  try {
    const groq = new Groq({ apiKey: groqApiKey });

    const prompt = `You are a debugging assistant. A running project has crashed or errored. Fix it.

Error output from the process:
${errorLines || "(no stderr captured)"}

Current source files:
${fileContext || "(could not read files)"}

Respond ONLY with a JSON block — no other text:
\`\`\`json
{
  "action": "update_files",
  "files": [
    { "path": "relative/path.ext", "content": "full corrected file content" }
  ],
  "explanation": "short plain-English description of what was wrong and what was fixed"
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
    if (!match) throw new Error("No JSON block returned by the AI");

    const parsed = JSON.parse(match[1]) as {
      action: string;
      files: Array<{ path: string; content: string }>;
      explanation: string;
    };

    if (parsed.action !== "update_files" || !Array.isArray(parsed.files)) {
      throw new Error("Unexpected response format from AI");
    }

    for (const f of parsed.files) {
      const filePath = path.join(session.workDir, f.path);
      const dir = path.dirname(filePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(filePath, f.content, "utf-8");
    }

    const explanation = parsed.explanation ?? "files updated";
    appendLog(channelId, `[Nano] Fix applied: ${explanation}`);
    addEvent(channelId, "fix_done", `Fix applied: ${explanation}`);

    // Kill old process and restart
    if (session.process) {
      try { session.process.kill("SIGTERM"); } catch {}
      session.process = null;
    }
    await new Promise(r => setTimeout(r, 1500));
    appendLog(channelId, "[Nano] Restarting process after fix...");
    startProcess(channelId);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "unknown error";
    appendLog(channelId, `[Nano] Auto-fix failed: ${msg}`);
    addEvent(channelId, "fix_failed", `Fix attempt ${session.autoFixAttempts} failed: ${msg}`);
    session.status = "error";
  }
}

export function startProcess(channelId: string): void {
  const session = sessions.get(channelId);
  if (!session) return;

  const [cmd, ...args] = session.runCommand.split(" ");
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
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
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "spawn error";
    appendLog(channelId, `[Nano] Failed to spawn process: ${msg}`);
    session.status = "error";
    return;
  }

  session.process = proc;
  session.status = "running";

  proc.stdout?.on("data", (data: Buffer) => {
    for (const line of data.toString().split("\n").filter(Boolean)) {
      appendLog(channelId, line);
    }
  });

  let stderrBuffer = "";
  let errorTimeout: ReturnType<typeof setTimeout> | null = null;

  proc.stderr?.on("data", (data: Buffer) => {
    for (const line of data.toString().split("\n").filter(Boolean)) {
      appendLog(channelId, `[stderr] ${line}`);
      stderrBuffer += line + "\n";
    }

    if (errorTimeout) clearTimeout(errorTimeout);
    errorTimeout = setTimeout(() => {
      const s = sessions.get(channelId);
      if (!s || s.status !== "running") return;

      const isFatal = /error|exception|crash|failed|ENOENT|EADDRINUSE|SyntaxError|TypeError|ReferenceError/i.test(stderrBuffer);
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
    if (s.status === "running") {
      s.status = code === 0 ? "stopped" : "error";
      if (code !== 0 && s.autoFixAttempts < 3) {
        const groqKey = process.env.GROQ_API_KEY;
        if (groqKey) autoFix(channelId, groqKey);
      }
    }
    s.process = null;
  });

  proc.on("error", (err) => {
    appendLog(channelId, `[Nano] Spawn error: ${err.message}`);
    const s = sessions.get(channelId);
    if (s) s.status = "error";
  });
}
