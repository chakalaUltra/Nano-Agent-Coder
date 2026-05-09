import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { apiGet } from "../lib/api.js";

interface AuthStatus {
  connected: boolean;
  githubUsername?: string;
  discordUsername?: string;
}

interface Repo {
  fullName: string;
  name: string;
  private: boolean;
}

export const profileStatus = {
  data: new SlashCommandBuilder()
    .setName("profile-status")
    .setDescription("View your Nano Agent account and GitHub connection status"),

  async execute(interaction: any) {
    await interaction.deferReply({ ephemeral: true });
    const discordId = interaction.user.id;

    try {
      const status = await apiGet<AuthStatus>(`/auth/status/${discordId}`);

      const embed = new EmbedBuilder()
        .setColor(0xffffff)
        .setTitle("Your Nano Agent Profile")
        .addFields(
          {
            name: "Discord",
            value: `${interaction.user.username} (<@${discordId}>)`,
            inline: true,
          },
          {
            name: "GitHub",
            value: status.connected
              ? `Connected as **@${status.githubUsername}**`
              : "Not connected — use `/connect-account`",
            inline: true,
          }
        );

      if (status.connected) {
        try {
          const repos = await apiGet<Repo[]>(`/repos/${discordId}`);
          embed.addFields({
            name: "Repositories",
            value: `${repos.length} repositories found (${repos.filter((r) => r.private).length} private)`,
          });
          embed.setFooter({ text: "Use /start to pick a repository and begin coding" });
        } catch {
          embed.addFields({ name: "Repositories", value: "Could not load repositories" });
        }
      } else {
        embed.setFooter({ text: "Connect your GitHub account to get started" });
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      await interaction.editReply({
        content: "Failed to fetch your profile. Please try again.",
      });
    }
  },
};
