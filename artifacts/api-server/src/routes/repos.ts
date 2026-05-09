import { Router } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";

const router = Router();

router.get("/repos/:discordId", async (req, res) => {
  const { discordId } = req.params;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.discordId, discordId)).limit(1);
  if (!user?.githubAccessToken) {
    res.status(401).json({ error: "GitHub not connected" });
    return;
  }

  try {
    const reposRes = await fetch("https://api.github.com/user/repos?per_page=100&sort=updated", {
      headers: { Authorization: `Bearer ${user.githubAccessToken}`, "User-Agent": "NanoAgent" },
    });
    const repos = await reposRes.json() as Array<{ full_name: string; name: string; private: boolean; description: string | null }>;
    res.json(repos.map(r => ({ fullName: r.full_name, name: r.name, private: r.private, description: r.description })));
  } catch (err) {
    logger.error(err, "Failed to fetch repos");
    res.status(500).json({ error: "Failed to fetch repositories" });
  }
});

router.post("/repos/:discordId/create", async (req, res) => {
  const { discordId } = req.params;
  const { name, isPrivate, description } = req.body as { name: string; isPrivate: boolean; description?: string };
  const [user] = await db.select().from(usersTable).where(eq(usersTable.discordId, discordId)).limit(1);
  if (!user?.githubAccessToken) {
    res.status(401).json({ error: "GitHub not connected" });
    return;
  }

  try {
    const createRes = await fetch("https://api.github.com/user/repos", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${user.githubAccessToken}`,
        "User-Agent": "NanoAgent",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name, private: isPrivate, description: description ?? "", auto_init: true }),
    });
    const repo = await createRes.json() as { full_name: string; name: string; private: boolean; html_url: string };
    if (!repo.full_name) {
      res.status(400).json({ error: "Failed to create repository" });
      return;
    }
    res.json({ fullName: repo.full_name, name: repo.name, private: repo.private, url: repo.html_url });
  } catch (err) {
    logger.error(err, "Failed to create repo");
    res.status(500).json({ error: "Failed to create repository" });
  }
});

export default router;
