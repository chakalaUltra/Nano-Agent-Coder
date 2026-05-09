import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { apiDelete } from "../lib/api.js";

export const end = {
  data: new SlashCommandBuilder()
    .setName("end")
    .setDescription("End the current Nano coding session in this channel"),

  async execute(interaction: any) {
    await interaction.deferReply();
    const channelId = interaction.channelId;

    try {
      await apiDelete(`/chat/${channelId}`);

      const embed = new EmbedBuilder()
        .setColor(0xffffff)
        .setTitle("Session Ended")
        .setDescription(
          "Your coding session has been closed. All unsaved changes have been discarded.\n\nUse `/start` to begin a new session."
        )
        .setFooter({ text: "Your checkpoints from /update are still saved — use /rollbacks to access them." });

      await interaction.editReply({ embeds: [embed] });
    } catch {
      await interaction.editReply({
        content: "No active session found in this channel.",
      });
    }
  },
};
