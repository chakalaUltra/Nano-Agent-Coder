import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { apiPost } from "../lib/api.js";

interface UpdateResult {
  success: boolean;
  message?: string;
  applied?: string[];
  rollbackId?: number;
  rollbackLabel?: string;
  commitSha?: string;
}

export const update = {
  data: new SlashCommandBuilder()
    .setName("update")
    .setDescription("Apply all pending code changes to your GitHub repository"),

  async execute(interaction: any) {
    await interaction.deferReply();
    const channelId = interaction.channelId;

    try {
      const result = await apiPost<UpdateResult>("/chat/update", { channelId });

      if (!result.success) {
        const embed = new EmbedBuilder()
          .setColor(0xffffff)
          .setTitle("No Pending Changes")
          .setDescription(result.message ?? "There are no pending changes to apply.");
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(0xffffff)
        .setTitle("Changes Applied")
        .setDescription(`Successfully pushed **${result.applied?.length ?? 0}** file(s) to GitHub.`)
        .addFields(
          {
            name: "Files Updated",
            value: result.applied?.map((f) => `\`${f}\``).join("\n") ?? "—",
          },
          {
            name: "Checkpoint Saved",
            value: result.rollbackLabel ?? "—",
          },
          {
            name: "Commit",
            value: result.commitSha ? `\`${result.commitSha.slice(0, 7)}\`` : "—",
            inline: true,
          }
        )
        .setFooter({ text: "Use /rollbacks to browse and restore checkpoints" });

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`rollback_apply_${result.rollbackId}`)
          .setLabel("Rollback")
          .setStyle(ButtonStyle.Secondary)
      );

      await interaction.editReply({ embeds: [embed], components: [row] });
    } catch (err) {
      await interaction.editReply({
        content: "Failed to apply changes. Make sure you have an active session with `/start`.",
      });
    }
  },
};
