import { Collection, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { apiPost, apiGet } from "../lib/api.js";

interface RollbackResult {
  success: boolean;
  commitSha?: string;
  label?: string;
}

interface ChatSession {
  repoFullName: string;
  discordId: string;
  channelId: string;
}

interface CreateRepoResult {
  fullName: string;
  name: string;
  private: boolean;
  url: string;
}

export async function handleInteraction(interaction: any, commands: Collection<string, any>) {
  // Slash commands
  if (interaction.isChatInputCommand()) {
    const command = commands.get(interaction.commandName);
    if (!command) return;
    try {
      await command.execute(interaction);
    } catch (err) {
      console.error("Command error:", err);
      const reply = { content: "An error occurred running this command.", ephemeral: true };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(reply);
      } else {
        await interaction.reply(reply);
      }
    }
    return;
  }

  // Repo selection from /start
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
          `Nano is ready! Just send a message in this channel to start chatting.\n\nYou can ask Nano to **write new files**, **fix bugs**, **refactor code**, or anything else related to your project.`
        )
        .addFields(
          { name: "Repository", value: `\`${repoFullName}\``, inline: true },
          { name: "Commands", value: "`/update` — push changes\n`/rollbacks` — checkpoints\n`/end` — close session" }
        )
        .setFooter({ text: "Nano Agent • Every /update saves a rollback checkpoint" });

      await interaction.editReply({ embeds: [embed], components: [] });
    } catch (err) {
      await interaction.editReply({ content: "Failed to start session. Please try again.", components: [] });
    }
    return;
  }

  // Rollback select menu
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

  // Rollback button (from /update)
  if (interaction.isButton() && interaction.customId.startsWith("rollback_apply_")) {
    const rollbackId = interaction.customId.replace("rollback_apply_", "");
    const discordId = interaction.user.id;
    await interaction.deferReply({ ephemeral: true });

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

  // New repo button from /start
  if (interaction.isButton() && interaction.customId.startsWith("start_new_repo_")) {
    const modal = new ModalBuilder()
      .setCustomId("create_repo_modal")
      .setTitle("Create New Repository");

    const nameInput = new TextInputBuilder()
      .setCustomId("repo_name")
      .setLabel("Repository Name")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("my-awesome-project")
      .setRequired(true);

    const visibilityInput = new TextInputBuilder()
      .setCustomId("repo_visibility")
      .setLabel('Visibility (type "private" or "public")')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("public")
      .setRequired(true);

    const descInput = new TextInputBuilder()
      .setCustomId("repo_description")
      .setLabel("Description (optional)")
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(visibilityInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(descInput),
    );

    await interaction.showModal(modal);
    return;
  }

  // Modal submit — create repo
  if (interaction.isModalSubmit() && interaction.customId === "create_repo_modal") {
    await interaction.deferReply({ ephemeral: true });
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
        .setDescription(`Your new repository is ready and Nano has started a session!`)
        .addFields(
          { name: "Repository", value: `\`${repo.fullName}\``, inline: true },
          { name: "Visibility", value: isPrivate ? "Private" : "Public", inline: true },
          { name: "URL", value: repo.url }
        )
        .setFooter({ text: "Start chatting with Nano in this channel to add code to your repo" });

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      await interaction.editReply({ content: "Failed to create repository. Make sure the name is valid and doesn't already exist." });
    }
    return;
  }
}
