import { SlashCommandBuilder, EmbedBuilder } from "discord.js";

export const help = {
  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription("Learn how to use Nano Agent — commands, guide, and tips"),

  async execute(interaction: any) {
    const embed = new EmbedBuilder()
      .setColor(0xffffff)
      .setTitle("Nano Agent — Help & Guide")
      .setDescription(
        "Nano is an AI code assistant that connects to your GitHub and lets you write, fix, and manage code directly from Discord.\n\u200b"
      )
      .addFields(
        {
          name: "Getting Started",
          value: [
            "**1.** Use `/connect-account` to link your GitHub",
            "**2.** Follow the guide in the embed and click **Connect**",
            "**3.** Authorize Nano on GitHub — you'll be redirected back",
            "**4.** Use `/start` to pick a repo and begin a session",
            "**5.** Chat naturally — Nano will write and update your code",
          ].join("\n"),
        },
        {
          name: "\u200b",
          value: "\u200b",
        },
        {
          name: "Commands",
          value: [
            "`/connect-account` — Link your GitHub account to Nano",
            "`/profile-status` — View your connection status and repo count",
            "`/start` — Pick a repository (or create a new one) to start a session",
            "`/update` — Push all staged code changes to GitHub",
            "`/rollbacks` — Browse saved checkpoints and restore a previous version",
            "`/end` — Close the current coding session",
            "`/help` — Show this guide",
          ].join("\n"),
        },
        {
          name: "\u200b",
          value: "\u200b",
        },
        {
          name: "How Coding Sessions Work",
          value: [
            "Once you run `/start` and pick a repo, Nano joins the channel as your AI assistant.",
            "Just **type normally** — ask it anything like:",
            "> *\"Create an Express server with a /hello route\"*",
            "> *\"Fix the bug in my auth middleware\"*",
            "> *\"Add dark mode support to my CSS\"*",
            "",
            "Nano will stage the changes and show you which files were updated.",
            "When you're happy, use `/update` to push everything to GitHub.",
          ].join("\n"),
        },
        {
          name: "\u200b",
          value: "\u200b",
        },
        {
          name: "Rollbacks & Checkpoints",
          value: [
            "Every time you run `/update`, Nano automatically saves a checkpoint of the current commit.",
            "If something goes wrong, use `/rollbacks` to browse all checkpoints and restore any of them.",
            "Restoring a checkpoint **force-pushes** that commit to your main branch.",
          ].join("\n"),
        },
        {
          name: "\u200b",
          value: "\u200b",
        },
        {
          name: "Tips",
          value: [
            "— One session per channel. Use different channels for different projects.",
            "— Nano only responds to the user who started the session.",
            "— You can have multiple pending file changes before running `/update`.",
            "— Use `/end` before switching to a different repo in the same channel.",
            "— Ask Nano to explain your code, write tests, or add documentation too.",
          ].join("\n"),
        }
      )
      .setFooter({ text: "Nano Agent • Powered by GROQ AI & GitHub" });

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
