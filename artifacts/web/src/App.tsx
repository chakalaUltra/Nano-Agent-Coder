import { useEffect, useState } from "react";
import { useLocation } from "wouter";

const API_BASE = "/api";

function GithubIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

function DiscordIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057.1 18.08.11 18.1.12 18.12a19.9 19.9 0 0 0 5.993 3.03.077.077 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-5 h-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
    </svg>
  );
}

function ConnectedPage({ username }: { username: string }) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto text-green-600 dark:text-green-400">
          <CheckIcon />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">GitHub Connected</h1>
          <p className="mt-2 text-muted-foreground">
            Your GitHub account <span className="font-semibold text-foreground">@{username}</span> is now linked to Nano Agent.
          </p>
        </div>
        <div className="rounded-xl border bg-card p-5 text-left space-y-3">
          <p className="text-sm font-medium text-foreground">What's next?</p>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-start gap-2">
              <span className="mt-0.5 text-primary">•</span>
              Go back to Discord and use <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">/profile-status</code> to verify your connection
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 text-primary">•</span>
              Use <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">/start</code> to pick a repository and begin coding with Nano
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 text-primary">•</span>
              Ask Nano to write, fix, or update any code in your repositories
            </li>
          </ul>
        </div>
        <p className="text-xs text-muted-foreground">You can close this tab and return to Discord.</p>
      </div>
    </div>
  );
}

function LandingPage() {
  const domain = window.location.origin;

  const steps = [
    {
      num: "1",
      title: "Use /connect-account in Discord",
      desc: 'Run the command in any channel. Nano will send you an embed with a "Connect" button.',
    },
    {
      num: "2",
      title: "Click Connect & authorize Nano",
      desc: "You'll be redirected here. Nano needs permission to read and write to your repositories.",
    },
    {
      num: "3",
      title: "Authorize GitHub access",
      desc: "GitHub will ask you to approve access. Click Authorize and you'll be redirected back.",
    },
    {
      num: "4",
      title: "Start coding with /start",
      desc: "Pick a repository from the dropdown, then chat with Nano to update your code.",
    },
  ];

  const commands = [
    { cmd: "/connect-account", desc: "Link your GitHub account to Nano" },
    { cmd: "/profile-status", desc: "View your connection and repository count" },
    { cmd: "/start", desc: "Pick a repo and start an AI coding session" },
    { cmd: "/update", desc: "Apply all pending code changes to GitHub" },
    { cmd: "/rollbacks", desc: "Browse and restore saved checkpoints" },
    { cmd: "/end", desc: "End the current coding session" },
  ];

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-6 py-16 space-y-20">
        {/* Hero */}
        <div className="text-center space-y-5">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-semibold tracking-wide uppercase">
            <DiscordIcon />
            AI Code Assistant for Discord
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-foreground leading-tight tracking-tight">
            Meet <span className="text-primary">Nano Agent</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-xl mx-auto leading-relaxed">
            A Discord bot that connects to your GitHub and lets you create, edit, and manage code through natural conversation.
          </p>
        </div>

        {/* How to connect */}
        <div className="space-y-6">
          <h2 className="text-xl font-semibold text-foreground">How to connect your GitHub</h2>
          <div className="space-y-3">
            {steps.map((step) => (
              <div key={step.num} className="flex gap-4 p-4 rounded-xl border bg-card">
                <div className="w-8 h-8 rounded-full bg-primary/10 text-primary text-sm font-bold flex items-center justify-center flex-shrink-0">
                  {step.num}
                </div>
                <div>
                  <p className="font-medium text-foreground text-sm">{step.title}</p>
                  <p className="text-sm text-muted-foreground mt-0.5">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Commands */}
        <div className="space-y-6">
          <h2 className="text-xl font-semibold text-foreground">Available Commands</h2>
          <div className="rounded-xl border bg-card overflow-hidden">
            {commands.map((c, i) => (
              <div key={c.cmd} className={`flex items-center gap-4 px-5 py-4 ${i < commands.length - 1 ? "border-b" : ""}`}>
                <code className="text-sm font-mono text-primary bg-primary/8 px-2.5 py-1 rounded-md flex-shrink-0">{c.cmd}</code>
                <span className="text-sm text-muted-foreground">{c.desc}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Callback URL info */}
        <div className="rounded-xl border bg-muted/40 p-5 space-y-2">
          <p className="text-sm font-medium text-foreground flex items-center gap-2">
            <GithubIcon />
            GitHub OAuth Callback URL
          </p>
          <code className="text-xs text-muted-foreground break-all font-mono block">
            {domain}/api/auth/github/callback
          </code>
          <p className="text-xs text-muted-foreground">
            Use this URL when setting up your GitHub OAuth App.
          </p>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Nano Agent — Built with Discord.js, GROQ AI & GitHub API
        </p>
      </div>
    </div>
  );
}

export default function App() {
  const [location] = useLocation();
  const params = new URLSearchParams(window.location.search);
  const connected = params.get("connected") === "true";
  const username = params.get("username") ?? "";

  if (connected && username) {
    return <ConnectedPage username={username} />;
  }

  return <LandingPage />;
}
