import {
  Collection,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import { apiPost, apiGet } from "../lib/api.js";
import { showConsoleEmbed } from "../commands/runProject.js";
import { startPoller, buildConsoleEmbed, stopPoller } from "../lib/runPoller.js";

interface RollbackResult {
  success: boolean;
  commitSha?: string;
  label?: string;
}

interface CreateRepoResult {
  fullName: string;
  name: string;
  private: boolean;
  url: string;
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

export async function handleInteraction(interaction: any, commands: Collection<string, any>) {
  // ── Slash commands ──────────────────────────────────────────────────────────
  if (interaction.isChatInputCommand()) {
    const command = commands.get(interaction.commandName);
    if (!command) return;
    try {
      await command.execute(interaction);
    } catch (err) {
      console.error("Command error:", err);
      const reply = { content: "An error occurred running this command.", flags: 1 << 6 };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(reply);
      } else {
        await interaction.reply(reply);
      }
    }
    return;
  }

  // ── Repo selection from /start ──────────────────────────────────────────────
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith("start_repo_select_")) {
    const repoFullName = interaction.values[0];
    const discordId = interaction.user.id;
    const channelId = interaction.channelId;

    await interaction.deferUpdate();

    try {
      await apiPost("/chat/session", { discordId, channelId, repoFullName });

      const embed = new EmbedBuilder()
        .setColor(0xffffff)
        .setTitle(`Session Started — ${repoFullName}`)
        .setDescription(
          `Nano is ready. Send a message in this channel to start coding.\n\nAsk Nano to write files, fix bugs, refactor, or build features from scratch.`
        )
        .addFields(
          { name: "Repository", value: `\`${repoFullName}\``, inline: true },
          {
            name: "Commands",
            value: "`/update` — push changes\n`/run-project` — run it\n`/rollbacks` — checkpoints\n`/end` — close session",
          }
        )
        .setFooter({ text: "Nano Agent • Every /update saves a rollback checkpoint" });

      await interaction.editReply({ embeds: [embed], components: [] });
    } catch {
      await interaction.editReply({ content: "Failed to start session. Please try again.", components: [] });
    }
    return;
  }

  // ── Rollback select menu ────────────────────────────────────────────────────
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith("rollback_select_")) {
    const rollbackId = interaction.values[0];
    const discordId = interaction.user.id;
    await interaction.deferUpdate();

    try {
      const result = await apiPost<RollbackResult>(`/rollbacks/${rollbackId}/apply`, { discordId });

      const embed = new EmbedBuilder()
        .setColor(0xffffff)
        .setTitle("Rollback Applied")
        .setDescription(`Your repository has been restored to checkpoint:\n**${result.label}**`)
        .addFields({ name: "Commit", value: `\`${result.commitSha?.slice(0, 7) ?? "—"}\``, inline: true })
        .setFooter({ text: "The main branch has been force-pushed to this checkpoint." });

      await interaction.editReply({ embeds: [embed], components: [] });
    } catch {
      await interaction.editReply({ content: "Failed to apply rollback. Please try again.", components: [] });
    }
    return;
  }

  // ── Rollback button (from /update) ──────────────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith("rollback_apply_")) {
    const rollbackId = interaction.customId.replace("rollback_apply_", "");
    const discordId = interaction.user.id;
    await interaction.deferReply({ flags: 1 << 6 });

    try {
      const result = await apiPost<RollbackResult>(`/rollbacks/${rollbackId}/apply`, { discordId });
      const embed = new EmbedBuilder()
        .setColor(0xffffff)
        .setTitle("Rollback Applied")
        .setDescription(`Restored to: **${result.label}**`)
        .addFields({ name: "Commit", value: `\`${result.commitSha?.slice(0, 7) ?? "—"}\``, inline: true });
      await interaction.editReply({ embeds: [embed] });
    } catch {
      await interaction.editReply({ content: "Failed to apply rollback." });
    }
    return;
  }

  // ── New repo button from /start ─────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith("start_new_repo_")) {
    const modal = new ModalBuilder()
      .setCustomId("create_repo_modal")
      .setTitle("Create New Repository");

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("repo_name")
          .setLabel("Repository Name")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("my-awesome-project")
          .setRequired(true)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("repo_visibility")
          .setLabel('Visibility (type "private" or "public")')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("public")
          .setRequired(true)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("repo_description")
          .setLabel("Description (optional)")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
      ),
    );

    await interaction.showModal(modal);
    return;
  }

  // ── Modal submit — create repo ──────────────────────────────────────────────
  if (interaction.isModalSubmit() && interaction.customId === "create_repo_modal") {
    await interaction.deferReply({ flags: 1 << 6 });
    const discordId = interaction.user.id;
    const name = interaction.fields.getTextInputValue("repo_name").trim();
    const visibility = interaction.fields.getTextInputValue("repo_visibility").trim().toLowerCase();
    const description = interaction.fields.getTextInputValue("repo_description")?.trim();
    const isPrivate = visibility === "private";

    try {
      const repo = await apiPost<CreateRepoResult>(`/repos/${discordId}/create`, { name, isPrivate, description });
      const channelId = interaction.channelId;
      await apiPost("/chat/session", { discordId, channelId, repoFullName: repo.fullName });

      const embed = new EmbedBuilder()
        .setColor(0xffffff)
        .setTitle(`Repository Created — ${repo.name}`)
        .setDescription(`Your new repository is ready and Nano has started a session.`)
        .addFields(
          { name: "Repository", value: `\`${repo.fullName}\``, inline: true },
          { name: "Visibility", value: isPrivate ? "Private" : "Public", inline: true },
          { name: "URL", value: repo.url }
        )
        .setFooter({ text: "Start chatting with Nano in this channel to add code to your repo" });

      await interaction.editReply({ embeds: [embed] });
    } catch {
      await interaction.editReply({
        content: "Failed to create repository. Make sure the name is valid and doesn't already exist.",
      });
    }
    return;
  }

  // ── Run project: env vars modal submit ─────────────────────────────────────
  if (interaction.isModalSubmit() && interaction.customId.startsWith("run_env_modal_")) {
    const encoded = interaction.customId.replace("run_env_modal_", "");
    let channelId = interaction.channelId as string;
    let projectType = "Node.js";

    try {
      const decoded = JSON.parse(Buffer.from(encoded, "base64url").toString());
      channelId = decoded.channelId ?? channelId;
      projectType = decoded.projectType ?? projectType;
    } catch {}

    await interaction.deferReply({ flags: 1 << 6 });

    // Collect env vars from modal fields
    const envVars: Record<string, string> = {};
    for (const row of interaction.fields.components ?? []) {
      for (const component of (row as any).components ?? []) {
        const key = (component.customId as string)?.replace("env_", "");
        if (key && component.value) envVars[key] = component.value;
      }
    }

    const startingEmbed = new EmbedBuilder()
      .setColor(0xffffff)
      .setTitle("Starting Project")
      .setDescription(`Cloning the repository and installing dependencies...\n\nThis usually takes 15–60 seconds.`)
      .addFields({ name: "Project Type", value: projectType, inline: true })
      .setFooter({ text: "Live console will appear shortly" });

    await interaction.editReply({ embeds: [startingEmbed] });

    try {
      const result = await apiPost<StartResult>("/run/start", { channelId, envVars });
      await showConsoleEmbed(interaction, channelId, result.url);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "unknown error";
      const errEmbed = new EmbedBuilder()
        .setColor(0xff4444)
        .setTitle("Failed to Start")
        .setDescription(msg);
      await interaction.editReply({ embeds: [errEmbed] });
    }
    return;
  }

  // ── Run: force refresh button ───────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith("run_refresh_")) {
    const channelId = interaction.customId.replace("run_refresh_", "");
    await interaction.deferUpdate();

    try {
      const data = await apiGet<ConsoleResult>(`/run/console/${channelId}`);
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
    } catch {
      await interaction.followUp({ content: "Could not fetch console — the project may not be running.", flags: 1 << 6 });
    }
    return;
  }

  // ── Run: stop button ────────────────────────────────────────────────────────
  if (interaction.isButton() && interaction.customId.startsWith("run_stop_")) {
    const channelId = interaction.customId.replace("run_stop_", "");
    await interaction.deferUpdate();

    try {
      stopPoller(channelId);
      await apiPost("/run/stop", { channelId });

      const embed = new EmbedBuilder()
        .setColor(0xffffff)
        .setTitle("Project Stopped")
        .setDescription("The running process has been terminated and the working directory cleaned up.")
        .setFooter({ text: "Use /run-project to start it again" });

      await interaction.editReply({ embeds: [embed], components: [] });
    } catch {
      await interaction.followUp({ content: "Failed to stop the project.", flags: 1 << 6 });
    }
    return;
  }
}
