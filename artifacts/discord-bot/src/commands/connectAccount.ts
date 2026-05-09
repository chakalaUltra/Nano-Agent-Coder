import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { getAuthUrl, getWebsiteUrl } from "../lib/api.js";

export const connectAccount = {
  data: new SlashCommandBuilder()
    .setName("connect-account")
    .setDescription("Connect your GitHub account to Nano Agent"),

  async execute(interaction: any) {
    const discordId = interaction.user.id;
    const authUrl = getAuthUrl(discordId);
    const websiteUrl = getWebsiteUrl();

    const embed = new EmbedBuilder()
      .setColor(0xffffff)
      .setTitle("Connect GitHub to Nano Agent")
      .setDescription(
        "Link your GitHub account to unlock full AI coding capabilities. Follow the steps below to get started."
      )
      .addFields(
        {
          name: "Step 1 — Click Connect",
          value: "Press the grey **Connect** button below. You will be asked to authorize Nano Agent first.",
        },
        {
          name: "Step 2 — Authorize the app",
          value: `You'll be taken to the [Nano Agent website](${websiteUrl}) and then redirected to GitHub for authorization.`,
        },
        {
          name: "Step 3 — Approve GitHub access",
          value: "Click **Authorize** on GitHub. Nano needs repo access to read and write your code.",
        },
        {
          name: "Step 4 — Return to Discord",
          value: "Once connected, use `/profile-status` to verify and `/start` to begin coding.",
        }
      )
      .setFooter({ text: "Nano Agent • Powered by GROQ AI & GitHub" });

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel("Connect GitHub")
        .setStyle(ButtonStyle.Link)
        .setURL(authUrl)
        .setEmoji("🔗")
    );

    await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
  },
};
