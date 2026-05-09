import { Router } from "express";
import { db, usersTable, chatSessionsTable, rollbacksTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import Groq from "groq-sdk";
import { logger } from "../lib/logger";

const router = Router();
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const DELETE_SENTINEL = "__DELETE__";

const SYSTEM_PROMPT = `You are Nano, an AI code assistant integrated with GitHub. You help users manage their code repositories.

When the user asks you to create or update files, respond with a JSON block in this exact format:
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

When the user asks you to delete one or more files, respond with a JSON block in this exact format:
\`\`\`json
{
  "action": "delete_files",
  "files": [
    {
      "path": "relative/path/to/file.ext",
      "message": "reason for deletion"
    }
  ],
  "summary": "What you did in plain English"
}
\`\`\`

You can also combine updates and deletions in a single response by using both blocks.

When you want to just chat or explain (no file changes), respond normally in plain text.

Rules:
- Always provide complete file contents for updates, never partial snippets
- When deleting, only include the path and message — no content field
- Be concise and precise
- After every code change, remind the user they can use /update to apply changes
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
    let fileDeletions: Array<{ path: string; message: string }> = [];
    let summary = "";

    // Parse all JSON blocks from the reply
    const jsonMatches = [...reply.matchAll(/```json\s*([\s\S]*?)```/g)];
    for (const match of jsonMatches) {
      try {
        const parsed = JSON.parse(match[1]);

        if (parsed.action === "update_files" && Array.isArray(parsed.files)) {
          fileChanges.push(...parsed.files);
          summary = parsed.summary ?? summary;
          for (const f of parsed.files) {
            pendingFiles[f.path] = { content: f.content, message: f.message };
          }
        }

        if (parsed.action === "delete_files" && Array.isArray(parsed.files)) {
          fileDeletions.push(...parsed.files);
          summary = parsed.summary ?? summary;
          for (const f of parsed.files) {
            // Use sentinel value to mark this as a deletion
            pendingFiles[f.path] = { content: DELETE_SENTINEL, message: f.message || `Delete ${f.path}` };
          }
        }
      } catch {}
    }

    await db.update(chatSessionsTable).set({
      history: JSON.stringify(history),
      pendingFiles: JSON.stringify(pendingFiles),
      updatedAt: new Date(),
    }).where(eq(chatSessionsTable.channelId, channelId));

    res.json({
      reply,
      fileChanges,
      fileDeletions,
      summary,
      pendingCount: Object.keys(pendingFiles).length,
    });
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
  const deleted: string[] = [];

  try {
    for (const [filePath, fileData] of Object.entries(pendingFiles)) {
      const isDelete = fileData.content === DELETE_SENTINEL;

      // Always fetch the current file SHA (needed for both update and delete)
      const existingRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`, {
        headers: { Authorization: `Bearer ${user.githubAccessToken}`, "User-Agent": "NanoAgent" },
      });

      if (isDelete) {
        // Skip if file doesn't exist on GitHub
        if (!existingRes.ok) continue;

        const existing = await existingRes.json() as { sha: string };
        await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${user.githubAccessToken}`,
            "User-Agent": "NanoAgent",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: fileData.message || `Delete ${filePath} via Nano Agent`,
            sha: existing.sha,
          }),
        });
        deleted.push(filePath);
      } else {
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
    }

    const commitRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits?per_page=1`, {
      headers: { Authorization: `Bearer ${user.githubAccessToken}`, "User-Agent": "NanoAgent" },
    });
    const commits = await commitRes.json() as Array<{ sha: string }>;
    const latestSha = commits[0]?.sha ?? "unknown";

    const allChanged = [...applied, ...deleted.map(f => `${f} (deleted)`)];
    const rollbackLabel = `${allChanged.join(", ")} — ${new Date().toISOString()}`;
    const [rollback] = await db.insert(rollbacksTable).values({
      discordId: session.discordId,
      repoFullName: session.repoFullName,
      label: rollbackLabel,
      commitSha: latestSha,
      description: `Auto-checkpoint: updated ${applied.length}, deleted ${deleted.length} file(s)`,
    }).returning();

    await db.update(chatSessionsTable).set({
      pendingFiles: "{}",
      updatedAt: new Date(),
    }).where(eq(chatSessionsTable.channelId, channelId));

    res.json({ success: true, applied, deleted, rollbackId: rollback.id, rollbackLabel, commitSha: latestSha });
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
