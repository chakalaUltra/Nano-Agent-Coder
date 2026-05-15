import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { apiGet, apiPost } from "../lib/api.js";

interface ChatSession {
  repoFullName: string;
  discordId: string;
}

interface PrepareResult {
  envVarsNeeded: string[];
  projectType: string;
  runCommand: string;
  alreadyRunning: boolean;
}

interface StartResult {
  ok: boolean;
  url: string;
  port: number;
  message?: string;
}

export const runProject = {
  data: new SlashCommandBuilder()
    .setName("run-project")
    .setDescription("Run the current project and watch the console for errors — Nano will auto-fix issues"),

  async execute(interaction: any) {
    const channelId = interaction.channelId;
    const discordId = interaction.user.id;

    // Check for active session
    let session: ChatSession | null = null;
    try {
      session = await apiGet<ChatSession | null>(`/chat/${channelId}`);
    } catch {}

    if (!session) {
      await interaction.reply({
        content: "No active session in this channel. Use `/start` to pick a repository first.",
        ephemeral: true,
      });
      return;
    }

    if (session.discordId !== discordId) {
      await interaction.reply({ content: "Only the session owner can run the project.", ephemeral: true });
      return;
    }

    // Call prepare — fast call to get env vars and project type
    let prepare: PrepareResult;
    try {
      prepare = await apiPost<PrepareResult>("/run/prepare", { channelId });
    } catch (err: any) {
      await interaction.reply({ content: `Could not analyse the project: ${err?.message ?? "unknown error"}`, ephemeral: true });
      return;
    }

    if (prepare.alreadyRunning) {
      await interaction.reply({
        content: "The project is already running. Use `/console` to see the output or stop it first.",
        ephemeral: true,
      });
      return;
    }

    // If env vars are needed and the interaction hasn't been deferred, show modal (up to 5 fields)
    if (prepare.envVarsNeeded.length > 0) {
      const modal = new ModalBuilder()
        .setCustomId(`run_env_modal_${channelId}`)
        .setTitle("Environment Variables Required");

      // Discord allows max 5 inputs per modal
      const fieldsToShow = prepare.envVarsNeeded.slice(0, 5);
      for (const key of fieldsToShow) {
        modal.addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId(`env_${key}`)
              .setLabel(key)
              .setStyle(TextInputStyle.Short)
              .setPlaceholder(`Value for ${key}`)
              .setRequired(true)
          )
        );
      }

      if (prepare.envVarsNeeded.length > 5) {
        // Store a note in the last field description — not ideal but works for now
        const lastField = modal.components[4];
        if (lastField) {
          // Just note that extras exist — we handle via defaults
        }
      }

      // Store project info for when the modal is submitted
      // We embed it in the customId so the interaction handler can retrieve it
      const encodedInfo = Buffer.from(JSON.stringify({
        channelId,
        projectType: prepare.projectType,
        runCommand: prepare.runCommand,
        allVars: prepare.envVarsNeeded,
      })).toString("base64url");

      modal.setCustomId(`run_env_modal_${encodedInfo}`);

      await interaction.showModal(modal);
      return;
    }

    // No env vars needed — defer and start immediately
    await interaction.deferReply({ ephemeral: true });

    const startEmbed = new EmbedBuilder()
      .setColor(0x1a1a1a)
      .setTitle("Starting Project")
      .setDescription(`*Cloning ${session.repoFullName} and installing dependencies...*\n\nThis usually takes 15–60 seconds.`)
      .addFields({ name: "Project Type", value: prepare.projectType, inline: true });

    await interaction.editReply({ embeds: [startEmbed] });

    try {
      const result = await apiPost<StartResult>("/run/start", { channelId, envVars: {} });
      await showConsoleEmbed(interaction, channelId, result.url, result.port);
    } catch (err: any) {
      const errEmbed = new EmbedBuilder()
        .setColor(0xff4444)
        .setTitle("Failed to Start")
        .setDescription(err?.message ?? "Something went wrong starting the project.");
      await interaction.editReply({ embeds: [errEmbed] });
    }
  },
};

export async function showConsoleEmbed(interaction: any, channelId: string, url: string, port: number): Promise<void> {
  interface ConsoleResult {
    logs: string[];
    status: string;
    url: string;
  }

  const { apiGet } = await import("../lib/api.js");
  let consoleData: ConsoleResult;
  try {
    consoleData = await apiGet<ConsoleResult>(`/run/console/${channelId}`);
  } catch {
    consoleData = { logs: [], status: "starting", url };
  }

  const logsText = consoleData.logs.slice(-20).join("\n") || "*Waiting for output...*";
  const safeLog = logsText.length > 3800 ? logsText.slice(-3800) : logsText;

  const statusEmoji: Record<string, string> = {
    running: "Running",
    cloning: "Cloning repo...",
    installing: "Installing dependencies...",
    error: "Error detected — Nano is fixing...",
    fixing: "Nano is auto-fixing...",
    stopped: "Stopped",
  };

  const embed = new EmbedBuilder()
    .setColor(0xffffff)
    .setTitle("Project Console")
    .setDescription("```\n" + safeLog + "\n```")
    .addFields(
      { name: "Status", value: statusEmoji[consoleData.status] ?? consoleData.status, inline: true },
      { name: "URL", value: consoleData.url || url || "—", inline: true },
    )
    .setFooter({ text: "Click Refresh to update the console  •  Nano auto-fixes errors" });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`run_refresh_${channelId}`)
      .setLabel("Refresh Console")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`run_stop_${channelId}`)
      .setLabel("Stop Project")
      .setStyle(ButtonStyle.Danger),
  );

  await interaction.editReply({ embeds: [embed], components: [row] });
}
