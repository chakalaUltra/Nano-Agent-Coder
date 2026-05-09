# Nano Agent

A Discord bot + web app that connects Discord users to their GitHub repositories via AI (GROQ). Users can chat with Nano to write, fix, and update code in their repos directly from Discord.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/web run dev` — run the web frontend (port 22333)
- `pnpm --filter @workspace/discord-bot run build && node artifacts/discord-bot/dist/index.mjs` — run the Discord bot
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL`, `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GROQ_API_KEY`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- AI: GROQ SDK (llama-3.3-70b-versatile)
- Discord: discord.js v14
- GitHub: GitHub REST API (OAuth)
- Frontend: React + Vite + Tailwind
- Validation: Zod (`zod/v4`), `drizzle-zod`
- Build: esbuild (CJS bundle)

## Where things live

- `lib/db/src/schema/` — DB tables: users, chat_sessions, rollbacks, repositories
- `artifacts/api-server/src/routes/` — auth.ts, repos.ts, chat.ts, rollbacks.ts
- `artifacts/discord-bot/src/commands/` — all slash commands
- `artifacts/discord-bot/src/handlers/` — interaction + message handling
- `artifacts/web/src/App.tsx` — GitHub authorization landing page
- `lib/api-spec/openapi.yaml` — API contract source of truth

## Architecture decisions

- Discord bot communicates with the API server (not DB directly) so all state is centralized
- GitHub OAuth uses state param with base64-encoded discordId to link accounts
- Chat sessions are keyed by channelId — one session per channel
- All pending file changes are buffered in `chat_sessions.pending_files` (JSON) until `/update` is called
- Every `/update` auto-saves a rollback checkpoint with the current commit SHA
- GROQ responds with structured JSON blocks when making code changes; the bot parses and stages them

## Product

- `/connect-account` — Embeds a guide + Connect button → GitHub OAuth flow via the web app
- `/profile-status` — Shows GitHub connection status and repo count
- `/start` — Dropdown of all user repos + "New" button to create a repo; starts AI session in channel
- Chat in the channel — Nano reads your messages, generates code changes, shows staged files
- `/update` — Pushes staged files to GitHub, saves rollback checkpoint
- `/rollbacks` — Dropdown of all saved checkpoints; click to force-push to that commit
- `/end` — Closes the session

## Gotchas

- Discord bot workflow must be restarted after changes to rebuild the dist
- Slash commands are registered at startup via `register.ts` — re-run if commands change
- GitHub callback URL must match exactly: `https://<domain>/api/auth/github/callback`
- The API server handles serving the web page at `/` via the reverse proxy

## User preferences

- Bot name: Nano Agent (Nano)
- No color on embed messages (white/no color)
- Rollback buttons should be permanent (no expiry)
