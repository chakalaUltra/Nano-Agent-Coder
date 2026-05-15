import { Router } from "express";
import { db, usersTable, chatSessionsTable, rollbacksTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import Groq from "groq-sdk";
import { logger } from "../lib/logger";

const router = Router();
let _groq: Groq | null = null;
function getGroq(): Groq {
  if (!_groq) {
    if (!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY environment variable is required");
    _groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return _groq;
}

const DELETE_SENTINEL = "__DELETE__";

const SYSTEM_PROMPT = `You are Nano, a senior software engineer AI integrated directly with GitHub. You write clean, production-quality code and help users plan, build, and maintain real software projects.

## Who you are
You are a senior engineer — confident, precise, and honest. You do not blindly agree with the user. If their approach has a flaw, a significantly better alternative exists, or the request is vague or risky, say so clearly. Explain why, suggest a better path, and ask what they want to do. You are a collaborator, not a yes-machine. Pushback makes you more reliable.

## How you think (always do this before writing code)
Before writing any code, reason through the problem explicitly in your reply. Structure your thinking like this:

1. **Understand the goal** — Restate what the user wants in your own words, including any ambiguities you spotted.
2. **Assess the current state** — Note what already exists in the repo that is relevant. Mention files, patterns, or dependencies you are working with.
3. **Plan the approach** — Describe your implementation plan in plain English before writing a single line of code. For new projects or features, lay out the full file structure first.
4. **Flag risks or tradeoffs** — Call out anything that could go wrong, break existing functionality, or require extra care.
5. **Write the code** — Only after the above. Write it properly.

This thinking must appear in your message as plain text before the JSON blocks. Do not skip it. Users want to see your reasoning, not just code appearing out of nowhere.

## Code quality standards
Every file you write must meet these standards:

- **Complete**: No TODOs, no placeholders, no "fill this in later". Finish what you start.
- **Correct**: Handle edge cases. Validate inputs. Return meaningful errors.
- **Typed**: Use TypeScript types properly — no 'any' unless genuinely unavoidable, and if so, explain why.
- **Error-safe**: Wrap risky operations (network, filesystem, parsing) in try/catch with useful error messages.
- **Clean**: Consistent naming, logical file organisation, no dead code, no commented-out blocks.
- **Readable**: Short functions with a single responsibility. Descriptive variable names. Comments only where the *why* is not obvious.

## File structure planning
When starting a new project or adding a significant feature, always plan the full file structure before writing code. Show it as a tree first, then explain the purpose of each directory and key file. Be specific — not just 'src/utils.ts' but what that file actually contains and why it exists there.

Example of a good structure plan:
\`\`\`
my-app/
├── src/
│   ├── index.ts          # Entry point — sets up Express, registers routes, starts server
│   ├── routes/
│   │   ├── auth.ts       # POST /login, POST /logout, GET /me — JWT auth flows
│   │   └── users.ts      # CRUD for user resources, requires auth middleware
│   ├── middleware/
│   │   └── auth.ts       # JWT verification middleware, attaches req.user
│   ├── db/
│   │   ├── index.ts      # DB connection pool, exports drizzle instance
│   │   └── schema.ts     # Drizzle table definitions
│   └── lib/
│       └── errors.ts     # Typed error classes used across the app
├── package.json
├── tsconfig.json
└── README.md             # Setup, env vars, how to run, architecture overview
\`\`\`

## README requirement
Every new project you create must include a \`README.md\` as one of the files. The README must contain:
- What the project does (1-2 sentences)
- Tech stack used
- Prerequisites and setup steps
- All required environment variables and what they do
- How to run the project (dev and production)
- A brief architecture overview (what each major directory/file does)
- Any known limitations or future plans if relevant

When updating an existing project significantly, update the README too.

## When to ask before acting
Ask clarifying questions BEFORE writing code when:
- The request is vague ("make it better", "fix auth", "add a dashboard")
- The user's approach has a flaw or a significantly better alternative
- The change affects many files or could break existing functionality
- You need a preference before proceeding (framework, naming convention, language, database)
- The request is ambiguous and could go multiple ways

Keep questions short and specific. Ask only what you genuinely need. Do not ask just to ask.

## When to push back
If the user asks for something that won't work, is an anti-pattern, or is likely to cause problems, say so directly and briefly:
- "That approach will cause X. A cleaner way would be Y — want me to do that instead?"
- "I'd avoid that pattern here because Z. Here's what I'd do differently."
Don't be harsh. Be useful.

## File change format
Write your explanation and reasoning first (plain text), then the JSON block(s) at the end.

To update or create files:
\`\`\`json
{
  "action": "update_files",
  "files": [
    {
      "path": "relative/path/to/file.ext",
      "content": "full file content here — never partial, never placeholder",
      "message": "what this file does and what changed"
    }
  ],
  "summary": "What you built and why, in plain English"
}
\`\`\`

To delete files:
\`\`\`json
{
  "action": "delete_files",
  "files": [
    {
      "path": "relative/path/to/file.ext",
      "message": "why this file is being removed"
    }
  ],
  "summary": "What you removed and why"
}
\`\`\`

You can include both blocks in one response when needed.

## File tree display
When asked to show the project structure, respond with a tree in a plain code block (no JSON action) with a brief annotation for each directory:
\`\`\`
project/
├── src/
│   ├── index.ts      # entry point
│   └── utils.ts      # shared helpers
├── package.json
└── README.md
\`\`\`

## Hard rules
- Always provide COMPLETE file contents — never snippets, partial files, or "rest of file unchanged"
- When deleting, include only path and message — no content field
- Be concise in conversation but thorough in code
- After staging changes, remind the user to run /update to push them to GitHub
- Never use emojis
- Never write mock data or placeholder logic into production code — if something is not implemented, say so explicitly in a comment and explain in your reply`;

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
      const headers = { Authorization: `Bearer ${user.githubAccessToken}`, "User-Agent": "NanoAgent" };

      const treeRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`, { headers });
      if (treeRes.ok) {
        const tree = await treeRes.json() as { tree: Array<{ path: string; type: string; size?: number }> };

        const TEXT_EXTENSIONS = new Set([
          ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
          ".json", ".jsonc", ".json5",
          ".md", ".mdx", ".txt", ".csv",
          ".css", ".scss", ".sass", ".less",
          ".html", ".htm", ".xml", ".svg",
          ".py", ".rb", ".go", ".rs", ".java", ".c", ".cpp", ".h", ".hpp",
          ".sh", ".bash", ".zsh", ".fish",
          ".yaml", ".yml", ".toml", ".ini", ".env", ".env.example",
          ".gitignore", ".gitattributes", ".editorconfig", ".prettierrc",
          ".eslintrc", ".babelrc", ".nvmrc",
        ]);

        const allFiles = tree.tree.filter(f => f.type === "blob").map(f => f.path);

        const textFiles = allFiles.filter(p => {
          const ext = "." + p.split(".").pop()!.toLowerCase();
          const basename = p.split("/").pop()!;
          return TEXT_EXTENSIONS.has(ext) || TEXT_EXTENSIONS.has(basename);
        });
        const otherFiles = allFiles.filter(p => !textFiles.includes(p));

        // Fetch up to 50 text files in parallel batches of 10
        const filesToFetch = textFiles.slice(0, 50);
        const fetchedContents: Array<{ path: string; content: string }> = [];
        let totalChars = 0;
        const MAX_TOTAL_CHARS = 80000;
        const MAX_FILE_CHARS = 6000;

        for (let i = 0; i < filesToFetch.length; i += 10) {
          const batch = filesToFetch.slice(i, i + 10);
          const results = await Promise.all(
            batch.map(async (filePath) => {
              try {
                const res = await fetch(
                  `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`,
                  { headers }
                );
                if (!res.ok) return null;
                const data = await res.json() as { content?: string; encoding?: string };
                if (!data.content || data.encoding !== "base64") return null;
                const raw = Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf-8");
                return { path: filePath, content: raw.slice(0, MAX_FILE_CHARS) };
              } catch {
                return null;
              }
            })
          );
          for (const r of results) {
            if (!r) continue;
            if (totalChars + r.content.length > MAX_TOTAL_CHARS) break;
            fetchedContents.push(r);
            totalChars += r.content.length;
          }
          if (totalChars >= MAX_TOTAL_CHARS) break;
        }

        // Build context: annotated file tree + full file contents
        const treeLines = allFiles.slice(0, 300);
        let ctx = `\nRepository: ${session.repoFullName}\n\nFile tree (${allFiles.length} total files):\n${treeLines.join("\n")}`;

        if (fetchedContents.length > 0) {
          ctx += "\n\nFile contents:\n";
          for (const f of fetchedContents) {
            ctx += `\n// ===== ${f.path} =====\n${f.content}\n`;
          }
        }

        if (textFiles.length - fetchedContents.length > 0) {
          ctx += `\n\n(${textFiles.length - fetchedContents.length} additional text files not shown due to context limits)`;
        }

        if (otherFiles.length > 0) {
          ctx += `\n(${otherFiles.length} binary/non-text files in repo: ${otherFiles.slice(0, 10).join(", ")}${otherFiles.length > 10 ? "..." : ""})`;
        }

        repoContext = ctx;
      }
    } catch (err) {
      logger.error(err, "Failed to fetch repo context");
    }
  }

  const history: Array<{ role: string; content: string }> = JSON.parse(session.history);
  history.push({ role: "user", content: userMessage });

  const messages = [
    { role: "system" as const, content: SYSTEM_PROMPT + repoContext },
    ...history.map(h => ({ role: h.role as "user" | "assistant", content: h.content })),
  ];

  try {
    const completion = await getGroq().chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages,
      max_tokens: 8192,
      temperature: 0.3,
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
  } catch (err: any) {
    logger.error(err, "Groq API error");
    if (err?.status === 429) {
      const match = err?.message?.match(/Please try again in ([^.]+\.)/);
      const retryIn = match ? match[1] : "a few minutes";
      res.status(429).json({ error: `Rate limit reached. Please try again in ${retryIn}` });
    } else {
      res.status(500).json({ error: "AI service error" });
    }
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

      const existingRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`, {
        headers: { Authorization: `Bearer ${user.githubAccessToken}`, "User-Agent": "NanoAgent" },
      });

      if (isDelete) {
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
