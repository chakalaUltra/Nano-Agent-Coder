import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from "discord.js";
import { apiGet } from "../lib/api.js";

interface ChatSession {
  repoFullName: string;
  discordId: string;
}

interface Rollback {
  id: number;
  label: string;
  commitSha: string;
  description?: string;
  createdAt: string;
}

export const rollbacks = {
  data: new SlashCommandBuilder()
    .setName("rollbacks")
    .setDescription("Browse saved checkpoints and restore a previous version"),

  async execute(interaction: any) {
    await interaction.deferReply({ ephemeral: true });
    const channelId = interaction.channelId;
    const discordId = interaction.user.id;

    let session: ChatSession | null = null;
    try {
      session = await apiGet<ChatSession | null>(`/chat/${channelId}`);
    } catch {}

    if (!session) {
      await interaction.editReply({
        content: "No active session found. Use `/start` to begin a session first.",
      });
      return;
    }

    try {
      const repoEncoded = encodeURIComponent(session.repoFullName);
      const list = await apiGet<Rollback[]>(`/rollbacks/${discordId}/${repoEncoded}`);

      if (list.length === 0) {
        const embed = new EmbedBuilder()
          .setColor(0xffffff)
          .setTitle("No Checkpoints Yet")
          .setDescription(
            `No rollback checkpoints saved for **${session.repoFullName}**.\n\nUse \`/update\` to apply changes — a checkpoint is saved automatically every time.`
          );
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(0xffffff)
        .setTitle(`Rollback Checkpoints — ${session.repoFullName}`)
        .setDescription(
          "Select a checkpoint below to restore your repository to that state. This will force-push the selected commit to main."
        )
        .addFields({
          name: "Total Checkpoints",
          value: `${list.length}`,
          inline: true,
        })
        .setFooter({ text: "Rollbacks are permanent — they force-push to your main branch." });

      const options = list
        .slice(-25)
        .reverse()
        .map((r) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(r.label.slice(0, 100))
            .setDescription(`Commit: ${r.commitSha.slice(0, 7)} • ${new Date(r.createdAt).toLocaleDateString()}`)
            .setValue(`${r.id}`)
        );

      const select = new StringSelectMenuBuilder()
        .setCustomId(`rollback_select_${channelId}`)
        .setPlaceholder("Choose a checkpoint to restore...")
        .addOptions(options);

      const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

      await interaction.editReply({ embeds: [embed], components: [row] });
    } catch (err) {
      await interaction.editReply({ content: "Failed to load checkpoints. Please try again." });
    }
  },
};
