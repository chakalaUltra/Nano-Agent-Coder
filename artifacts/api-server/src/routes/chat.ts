import { Router } from "express";
import { db, usersTable, chatSessionsTable, rollbacksTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import Groq from "groq-sdk";
import { logger } from "../lib/logger";

const router = Router();
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const SYSTEM_PROMPT = `You are Nano, an AI code assistant integrated with GitHub. You help users manage their code repositories.

When the user asks you to create, update, or modify files, respond with a JSON block in this exact format (wrapped in triple backticks with json tag):
\`\`\`json
{
  "action": "update_files",
  "files": [
    {
      "path": "relative/path/to/file.ext",
      "content": "full file content here",
      "message": "brief description of what changed"
    }
  ],
  "summary": "What you did in plain English"
}
\`\`\`

When you want to just chat or explain (no file changes), respond normally in plain text.

Rules:
- Always provide complete file contents, never partial snippets
- Be concise and precise
- After every code change, remind the user they can use /update to apply changes or /rollback to save a checkpoint
- Never use emojis`;

router.get("/chat/:channelId", async (req, res) => {
  const { channelId } = req.params;
  const [session] = await db.select().from(chatSessionsTable).where(eq(chatSessionsTable.channelId, channelId)).limit(1);
  res.json(session ?? null);
});

router.post("/chat/session", async (req, res) => {
  const { discordId, channelId, repoFullName } = req.body as { discordId: string; channelId: string; repoFullName: string };

  const [existing] = await db.select().from(chatSessionsTable).where(eq(chatSessionsTable.channelId, channelId)).limit(1);
  if (existing) {
    res.json(existing);
    return;
  }

  const [session] = await db.insert(chatSessionsTable).values({
    discordId,
    channelId,
    repoFullName,
    history: "[]",
    pendingFiles: "{}",
  }).returning();

  res.json(session);
});

router.post("/chat/message", async (req, res) => {
  const { channelId, userMessage } = req.body as { channelId: string; userMessage: string };

  const [session] = await db.select().from(chatSessionsTable).where(eq(chatSessionsTable.channelId, channelId)).limit(1);
  if (!session) {
    res.status(404).json({ error: "No active session" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.discordId, session.discordId)).limit(1);

  let repoContext = "";
  if (user?.githubAccessToken) {
    try {
      const [owner, repo] = session.repoFullName.split("/");
      const treeRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`, {
        headers: { Authorization: `Bearer ${user.githubAccessToken}`, "User-Agent": "NanoAgent" },
      });
      if (treeRes.ok) {
        const tree = await treeRes.json() as { tree: Array<{ path: string; type: string }> };
        const files = tree.tree.filter(f => f.type === "blob").map(f => f.path).slice(0, 50);
        repoContext = `\nRepository: ${session.repoFullName}\nFiles:\n${files.join("\n")}`;
      }
    } catch {}
  }

  const history: Array<{ role: string; content: string }> = JSON.parse(session.history);
  history.push({ role: "user", content: userMessage });

  const messages = [
    { role: "system" as const, content: SYSTEM_PROMPT + repoContext },
    ...history.map(h => ({ role: h.role as "user" | "assistant", content: h.content })),
  ];

  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages,
      max_tokens: 4096,
    });

    const reply = completion.choices[0]?.message?.content ?? "Sorry, I could not generate a response.";
    history.push({ role: "assistant", content: reply });

    let pendingFiles: Record<string, { content: string; message: string }> = JSON.parse(session.pendingFiles);
    let fileChanges: Array<{ path: string; content: string; message: string }> = [];
    let summary = "";

    const jsonMatch = reply.match(/```json\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        if (parsed.action === "update_files" && Array.isArray(parsed.files)) {
          fileChanges = parsed.files;
          summary = parsed.summary ?? "";
          for (const f of fileChanges) {
            pendingFiles[f.path] = { content: f.content, message: f.message };
          }
        }
      } catch {}
    }

    await db.update(chatSessionsTable).set({
      history: JSON.stringify(history),
      pendingFiles: JSON.stringify(pendingFiles),
      updatedAt: new Date(),
    }).where(eq(chatSessionsTable.channelId, channelId));

    res.json({ reply, fileChanges, summary, pendingCount: Object.keys(pendingFiles).length });
  } catch (err) {
    logger.error(err, "Groq API error");
    res.status(500).json({ error: "AI service error" });
  }
});

router.post("/chat/update", async (req, res) => {
  const { channelId } = req.body as { channelId: string };

  const [session] = await db.select().from(chatSessionsTable).where(eq(chatSessionsTable.channelId, channelId)).limit(1);
  if (!session) {
    res.status(404).json({ error: "No active session" });
    return;
  }

  const pendingFiles: Record<string, { content: string; message: string }> = JSON.parse(session.pendingFiles);
  if (Object.keys(pendingFiles).length === 0) {
    res.json({ success: false, message: "No pending changes to apply" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.discordId, session.discordId)).limit(1);
  if (!user?.githubAccessToken) {
    res.status(401).json({ error: "GitHub not connected" });
    return;
  }

  const [owner, repo] = session.repoFullName.split("/");
  const applied: string[] = [];

  try {
    for (const [filePath, fileData] of Object.entries(pendingFiles)) {
      const existingRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`, {
        headers: { Authorization: `Bearer ${user.githubAccessToken}`, "User-Agent": "NanoAgent" },
      });

      const body: Record<string, unknown> = {
        message: fileData.message || `Update ${filePath} via Nano Agent`,
        content: Buffer.from(fileData.content).toString("base64"),
      };

      if (existingRes.ok) {
        const existing = await existingRes.json() as { sha: string };
        body.sha = existing.sha;
      }

      await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${user.githubAccessToken}`,
          "User-Agent": "NanoAgent",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      applied.push(filePath);
    }

    const commitRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits?per_page=1`, {
      headers: { Authorization: `Bearer ${user.githubAccessToken}`, "User-Agent": "NanoAgent" },
    });
    const commits = await commitRes.json() as Array<{ sha: string }>;
    const latestSha = commits[0]?.sha ?? "unknown";

    const rollbackLabel = `Before: ${applied.join(", ")} — ${new Date().toISOString()}`;
    const [rollback] = await db.insert(rollbacksTable).values({
      discordId: session.discordId,
      repoFullName: session.repoFullName,
      label: rollbackLabel,
      commitSha: latestSha,
      description: `Auto-checkpoint after updating: ${applied.join(", ")}`,
    }).returning();

    await db.update(chatSessionsTable).set({
      pendingFiles: "{}",
      updatedAt: new Date(),
    }).where(eq(chatSessionsTable.channelId, channelId));

    res.json({ success: true, applied, rollbackId: rollback.id, rollbackLabel, commitSha: latestSha });
  } catch (err) {
    logger.error(err, "Failed to apply updates");
    res.status(500).json({ error: "Failed to apply changes" });
  }
});

router.delete("/chat/:channelId", async (req, res) => {
  const { channelId } = req.params;
  await db.delete(chatSessionsTable).where(eq(chatSessionsTable.channelId, channelId));
  res.json({ success: true });
});

export default router;
