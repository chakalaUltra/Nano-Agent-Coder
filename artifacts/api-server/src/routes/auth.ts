import { Router } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";

const router = Router();

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID!;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET!;
const BASE_DOMAIN = process.env.REPLIT_DEV_DOMAIN
  ? `https://${process.env.REPLIT_DEV_DOMAIN}`
  : "http://localhost:5000";

router.get("/auth/github", (req, res) => {
  const discordId = req.query.discord_id as string;
  if (!discordId) {
    res.status(400).json({ error: "discord_id required" });
    return;
  }
  const state = Buffer.from(JSON.stringify({ discordId })).toString("base64url");
  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: `${BASE_DOMAIN}/api/auth/github/callback`,
    scope: "repo user",
    state,
  });
  res.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

router.get("/auth/github/callback", async (req, res) => {
  const { code, state } = req.query as { code: string; state: string };
  if (!code || !state) {
    res.status(400).send("Missing code or state");
    return;
  }

  let discordId: string;
  try {
    const parsed = JSON.parse(Buffer.from(state, "base64url").toString());
    discordId = parsed.discordId;
  } catch {
    res.status(400).send("Invalid state");
    return;
  }

  try {
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: `${BASE_DOMAIN}/api/auth/github/callback`,
      }),
    });
    const tokenData = await tokenRes.json() as { access_token?: string; error?: string };
    if (!tokenData.access_token) {
      res.status(400).send("Failed to get access token: " + tokenData.error);
      return;
    }

    const userRes = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${tokenData.access_token}`, "User-Agent": "NanoAgent" },
    });
    const githubUser = await userRes.json() as { id: number; login: string };

    await db
      .insert(usersTable)
      .values({
        discordId,
        discordUsername: discordId,
        githubId: String(githubUser.id),
        githubUsername: githubUser.login,
        githubAccessToken: tokenData.access_token,
      })
      .onConflictDoUpdate({
        target: usersTable.discordId,
        set: {
          githubId: String(githubUser.id),
          githubUsername: githubUser.login,
          githubAccessToken: tokenData.access_token,
          updatedAt: new Date(),
        },
      });

    res.redirect(`/?connected=true&username=${githubUser.login}`);
  } catch (err) {
    logger.error(err, "GitHub OAuth error");
    res.status(500).send("OAuth error");
  }
});

router.get("/auth/status/:discordId", async (req, res) => {
  const { discordId } = req.params;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.discordId, discordId)).limit(1);
  if (!user) {
    res.json({ connected: false });
    return;
  }
  res.json({
    connected: !!user.githubAccessToken,
    githubUsername: user.githubUsername,
    discordUsername: user.discordUsername,
  });
});

export default router;
