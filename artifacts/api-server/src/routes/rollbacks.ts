import { Router } from "express";
import { db, usersTable, rollbacksTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "../lib/logger";

const router = Router();

router.get("/rollbacks/:discordId/:repoFullName", async (req, res) => {
  const { discordId } = req.params;
  const repoFullName = decodeURIComponent(req.params.repoFullName);

  const rollbacks = await db
    .select()
    .from(rollbacksTable)
    .where(and(eq(rollbacksTable.discordId, discordId), eq(rollbacksTable.repoFullName, repoFullName)))
    .orderBy(rollbacksTable.createdAt);

  res.json(rollbacks);
});

router.post("/rollbacks", async (req, res) => {
  const { discordId, repoFullName, label, commitSha, description } = req.body as {
    discordId: string;
    repoFullName: string;
    label: string;
    commitSha: string;
    description?: string;
  };

  const [rollback] = await db
    .insert(rollbacksTable)
    .values({ discordId, repoFullName, label, commitSha, description })
    .returning();

  res.json(rollback);
});

router.post("/rollbacks/:id/apply", async (req, res) => {
  const { id } = req.params;
  const { discordId } = req.body as { discordId: string };

  const [rollback] = await db.select().from(rollbacksTable).where(eq(rollbacksTable.id, parseInt(id))).limit(1);
  if (!rollback) {
    res.status(404).json({ error: "Rollback not found" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.discordId, discordId)).limit(1);
  if (!user?.githubAccessToken) {
    res.status(401).json({ error: "GitHub not connected" });
    return;
  }

  try {
    const [owner, repo] = rollback.repoFullName.split("/");
    const branchRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs/heads/main`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${user.githubAccessToken}`,
        "User-Agent": "NanoAgent",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sha: rollback.commitSha, force: true }),
    });

    if (!branchRes.ok) {
      const err = await branchRes.json();
      res.status(400).json({ error: "Failed to apply rollback", details: err });
      return;
    }

    res.json({ success: true, commitSha: rollback.commitSha, label: rollback.label });
  } catch (err) {
    logger.error(err, "Failed to apply rollback");
    res.status(500).json({ error: "Failed to apply rollback" });
  }
});

export default router;
