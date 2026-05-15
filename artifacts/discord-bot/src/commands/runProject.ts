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
import { startPoller, buildConsoleEmbed } from "../lib/runPoller.js";

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
}

interface ConsoleResult {
  logs: string[];
  status: string;
  url: string;
  port: number;
  autoFixAttempts: number;
  events: Array<{ type: string; message: string; at: string }>;
}

export const runProject = {
  data: new SlashCommandBuilder()
    .setName("run-project")
    .setDescription("Run the current project — Nano will auto-fix errors and show a live console"),

  async execute(interaction: any) {
    const channelId = interaction.channelId as string;
    const discordId = interaction.user.id as string;

    // Check for active session
    let session: ChatSession | null = null;
    try {
      session = await apiGet<ChatSession | null>(`/chat/${channelId}`);
    } catch {}

    if (!session) {
      await interaction.reply({
        content: "No active session in this channel. Use `/start` to pick a repository first.",
        flags: 1 << 6,
      });
      return;
    }

    if (session.discordId !== discordId) {
      await interaction.reply({ content: "Only the session owner can run the project.", flags: 1 << 6 });
      return;
    }

    // Call prepare — fast API call to detect project type and needed env vars
    let prepare: PrepareResult;
    try {
      prepare = await apiPost<PrepareResult>("/run/prepare", { channelId });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "unknown error";
      await interaction.reply({ content: `Could not analyse the project: ${msg}`, flags: 1 << 6 });
      return;
    }

    if (prepare.alreadyRunning) {
      await interaction.reply({
        content: "The project is already running. Use `/console` to see output or the Stop button to stop it.",
        flags: 1 << 6,
      });
      return;
    }

    // If env vars are needed, show a modal — must happen BEFORE any defer
    if (prepare.envVarsNeeded.length > 0) {
      const modal = new ModalBuilder().setTitle("Environment Variables Required");

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

      // Encode project info into the modal customId so the submit handler has it
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
    await interaction.deferReply({ flags: 1 << 6 });

    const startingEmbed = new EmbedBuilder()
      .setColor(0xffffff)
      .setTitle("Starting Project")
      .setDescription(`Cloning **${session.repoFullName}** and installing dependencies...\n\nThis usually takes 15–60 seconds.`)
      .addFields({ name: "Project Type", value: prepare.projectType, inline: true })
      .setFooter({ text: "Live console will appear shortly" });

    await interaction.editReply({ embeds: [startingEmbed] });

    try {
      const result = await apiPost<StartResult>("/run/start", { channelId, envVars: {} });
      await showConsoleEmbed(interaction, channelId, result.url);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "unknown error";
      const errEmbed = new EmbedBuilder()
        .setColor(0xff4444)
        .setTitle("Failed to Start")
        .setDescription(msg);
      await interaction.editReply({ embeds: [errEmbed] });
    }
  },
};

// Show the initial console embed and kick off the live auto-polling loop.
export async function showConsoleEmbed(interaction: any, channelId: string, url: string): Promise<void> {
  let data: ConsoleResult;
  try {
    data = await apiGet<ConsoleResult>(`/run/console/${channelId}`);
  } catch {
    data = { logs: [], status: "cloning", url, port: 0, autoFixAttempts: 0, events: [] };
  }

  const embed = buildConsoleEmbed(data);
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`run_refresh_${channelId}`)
      .setLabel("Force Refresh")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`run_stop_${channelId}`)
      .setLabel("Stop Project")
      .setStyle(ButtonStyle.Danger),
  );

  await interaction.editReply({ embeds: [embed], components: [row] });

  // Kick off auto-polling so the console updates without user action
  const channel = interaction.channel;
  startPoller(channelId, interaction, channel);
}
