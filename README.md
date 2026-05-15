# Nano Agent

Nano is an AI-powered Discord bot that lets you build and manage GitHub repositories through chat. Describe what you want to build, and Nano plans it, writes the code, and pushes it to GitHub — all from inside Discord.

---

## What it does

- Chat with Nano in a Discord channel to write, edit, and manage code in any connected GitHub repo
- Nano reads your repo's full file tree and contents before responding, so it understands what already exists
- Changes are staged first and only pushed to GitHub when you run `/update`
- Full rollback support — every push creates a checkpoint you can restore with `/rollbacks`
- GitHub OAuth flow handled through a lightweight web app

---

## Tech stack

| Layer | Technology |
|---|---|
| Discord bot | discord.js v14 |
| API server | Express 5, TypeScript |
| Frontend | React 19, Vite, Tailwind CSS 4 |
| Database | PostgreSQL, Drizzle ORM |
| AI | Groq SDK (Llama 3.3 70B) |
| Package manager | pnpm workspaces |

---

## Project structure

```
nano-agent/
├── artifacts/
│   ├── api-server/        # Express backend — GitHub OAuth, chat API, GitHub push logic
│   │   └── src/
│   │       ├── routes/
│   │       │   ├── auth.ts      # GitHub OAuth flow (/api/auth/*)
│   │       │   ├── chat.ts      # AI chat, file staging, /update push logic
│   │       │   ├── repos.ts     # List user repos from GitHub
│   │       │   └── rollbacks.ts # Checkpoint listing and restore
│   │       └── lib/
│   │           └── logger.ts    # Pino logger config
│   ├── discord-bot/       # Discord.js bot — commands, interactions, message handling
│   │   └── src/
│   │       ├── commands/
│   │       │   ├── start.ts     # /start — pick or create a repo to work on
│   │       │   ├── update.ts    # /update — push staged changes to GitHub
│   │       │   └── rollbacks.ts # /rollbacks — list and restore checkpoints
│   │       ├── handlers/
│   │       │   ├── messageHandler.ts    # Handles chat messages, thinking animation
│   │       │   └── interactionHandler.ts # Handles button clicks and modals
│   │       └── lib/
│   │           └── api.ts       # HTTP client for calling the API server
│   └── web/               # React frontend — GitHub OAuth connection UI
├── lib/
│   ├── db/                # Drizzle ORM setup, schema, DB connection
│   ├── api-spec/          # OpenAPI spec (openapi.yaml) + Orval codegen config
│   ├── api-zod/           # Zod schemas generated from the API spec
│   └── api-client-react/  # React Query hooks generated from the API spec
└── scripts/
    └── post-merge.sh      # Runs after merges: pnpm install + db push
```

---

## Prerequisites

- Node.js 20+
- pnpm 9+
- PostgreSQL database
- A Discord application with a bot token ([discord.com/developers](https://discord.com/developers))
- A GitHub OAuth app ([github.com/settings/developers](https://github.com/settings/developers))
- A Groq API key ([console.groq.com](https://console.groq.com))

---

## Environment variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `DISCORD_BOT_TOKEN` | Your Discord bot's token |
| `DISCORD_CLIENT_ID` | Your Discord application's client ID |
| `GITHUB_CLIENT_ID` | GitHub OAuth app client ID |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth app client secret |
| `GROQ_API_KEY` | Groq API key for LLM access |
| `PORT` | Port for the API server (default: `5000`) |
| `BASE_PATH` | Base path for the web frontend (default: `/`) |
| `SESSION_SECRET` | Secret for signing Express sessions |

For the GitHub OAuth callback URL, set it to:
```
https://<your-domain>/api/auth/callback
```

---

## Setup

```bash
# 1. Install dependencies
pnpm install

# 2. Push the database schema
pnpm --filter @workspace/db run push

# 3. Register Discord slash commands (run once, or after adding new commands)
pnpm --filter @workspace/discord-bot run register
```

---

## Running

**API server + web frontend (combined):**
```bash
PORT=5000 BASE_PATH=/ pnpm --filter @workspace/web run build
PORT=5000 pnpm --filter @workspace/api-server run dev
```

**Discord bot:**
```bash
pnpm --filter @workspace/discord-bot run build
node artifacts/discord-bot/dist/index.mjs
```

Both should run simultaneously. The API server serves the web frontend as static files from `artifacts/web/dist/public`.

---

## How it works

1. **Connect GitHub** — User visits the web frontend, clicks "Connect GitHub", and authorizes the OAuth app. Their access token is stored in the database against their Discord ID.

2. **Start a session** — User runs `/start` in Discord, picks a repo (or creates a new one), which opens a chat session in that channel.

3. **Chat to build** — User describes what they want. Nano reads the repo's full file tree and file contents, reasons through the problem, then writes code.

4. **Stage changes** — All file changes are staged in the database (not yet on GitHub). Nano shows a "Staged Changes" embed listing every file that will be created, modified, or deleted.

5. **Push** — User runs `/update`. Nano pushes all staged changes to GitHub via the Contents API and creates a rollback checkpoint.

6. **Rollback** — User runs `/rollbacks` to see all previous checkpoints and restore any of them with a force-push.

---

## Discord commands

| Command | Description |
|---|---|
| `/start` | Begin a session — pick or create a GitHub repo |
| `/update` | Push all staged changes to GitHub |
| `/rollbacks` | List checkpoints and restore a previous version |

---

## Known limitations

- The bot reads up to 50 text files and 80,000 characters of repo content per message. Very large repos may not have all files in context.
- Only one active chat session per Discord channel.
- GitHub API rate limits apply — if you hit them, wait a few minutes.
- The AI model (Llama 3.3 70B via Groq) has a context window limit. Extremely long conversations may lose early history.
