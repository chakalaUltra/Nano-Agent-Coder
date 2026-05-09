import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { apiGet, apiPost } from "../lib/api.js";

interface AuthStatus {
  connected: boolean;
  githubUsername?: string;
}

interface Repo {
  fullName: string;
  name: string;
  private: boolean;
  description?: string;
}

export const start = {
  data: new SlashCommandBuilder()
    .setName("start")
    .setDescription("Start a Nano coding session — pick a repository or create a new one"),

  async execute(interaction: any) {
    await interaction.deferReply({ ephemeral: true });
    const discordId = interaction.user.id;

    const status = await apiGet<AuthStatus>(`/auth/status/${discordId}`);
    if (!status.connected) {
      await interaction.editReply({
        content: "Your GitHub account is not connected. Use `/connect-account` first.",
      });
      return;
    }

    let repos: Repo[] = [];
    try {
      repos = await apiGet<Repo[]>(`/repos/${discordId}`);
    } catch {
      await interaction.editReply({ content: "Could not load your repositories. Please try again." });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0xffffff)
      .setTitle("Start a Coding Session with Nano")
      .setDescription(
        `Connected as **@${status.githubUsername}**. Choose an existing repository from the dropdown, or click **New** to create one.`
      )
      .addFields({
        name: "How it works",
        value:
          "Once you pick a repo, Nano will join this channel and act as your AI code assistant. Just chat naturally — ask it to write, fix, or update code.",
      })
      .setFooter({ text: "Use /update to push changes • /end to close the session" });

    const options = repos.slice(0, 25).map((r) =>
      new StringSelectMenuOptionBuilder()
        .setLabel(r.name)
        .setDescription(
          `${r.private ? "Private" : "Public"} • ${r.fullName}`
        )
        .setValue(r.fullName)
    );

    const rows: any[] = [];

    if (options.length > 0) {
      const select = new StringSelectMenuBuilder()
        .setCustomId(`start_repo_select_${discordId}`)
        .setPlaceholder("Select a repository...")
        .addOptions(options);
      rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select));
    }

    const newButton = new ButtonBuilder()
      .setCustomId(`start_new_repo_${discordId}`)
      .setLabel("New Repository")
      .setStyle(ButtonStyle.Secondary);

    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(newButton));

    await interaction.editReply({ embeds: [embed], components: rows });
  },
};
