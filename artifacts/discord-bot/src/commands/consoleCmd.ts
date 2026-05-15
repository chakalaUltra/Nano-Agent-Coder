import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { apiGet } from "../lib/api.js";

interface ConsoleResult {
  logs: string[];
  status: string;
  url: string;
  port: number;
}

export const consoleCmd = {
  data: new SlashCommandBuilder()
    .setName("console")
    .setDescription("View the live console output of the running project"),

  async execute(interaction: any) {
    await interaction.deferReply({ ephemeral: true });
    const channelId = interaction.channelId;

    let data: ConsoleResult;
    try {
      data = await apiGet<ConsoleResult>(`/run/console/${channelId}`);
    } catch {
      await interaction.editReply({
        content: "No project is currently running in this channel. Use `/run-project` to start one.",
      });
      return;
    }

    if (!data.status || data.status === "stopped") {
      await interaction.editReply({
        content: "No project is currently running in this channel. Use `/run-project` to start one.",
      });
      return;
    }

    const logsText = data.logs.slice(-25).join("\n") || "*No output yet...*";
    const safeLog = logsText.length > 3800 ? "..." + logsText.slice(-3800) : logsText;

    const statusLabel: Record<string, string> = {
      running: "Running",
      cloning: "Cloning repository...",
      installing: "Installing dependencies...",
      error: "Error — Nano is auto-fixing",
      fixing: "Auto-fixing in progress...",
      stopped: "Stopped",
    };

    const embed = new EmbedBuilder()
      .setColor(0xffffff)
      .setTitle("Live Console")
      .setDescription("```\n" + safeLog + "\n```")
      .addFields(
        { name: "Status", value: statusLabel[data.status] ?? data.status, inline: true },
        { name: "URL", value: data.url || "—", inline: true },
      )
      .setFooter({ text: "Refresh to see latest output  •  Nano auto-fixes errors automatically" });

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`run_refresh_${channelId}`)
        .setLabel("Refresh")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`run_stop_${channelId}`)
        .setLabel("Stop Project")
        .setStyle(ButtonStyle.Danger),
    );

    await interaction.editReply({ embeds: [embed], components: [row] });
  },
};
