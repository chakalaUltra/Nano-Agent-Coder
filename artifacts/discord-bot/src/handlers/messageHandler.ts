import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { apiGet, apiPost } from "../lib/api.js";

interface ChatSession {
  id: number;
  channelId: string;
  discordId: string;
  repoFullName: string;
}

interface ChatResponse {
  reply: string;
  fileChanges: Array<{ path: string; content: string; message: string }>;
  summary: string;
  pendingCount: number;
}

export async function handleMessageCreate(message: any) {
  const channelId = message.channelId;

  // Check if there's an active session in this channel
  let session: ChatSession | null = null;
  try {
    session = await apiGet<ChatSession | null>(`/chat/${channelId}`);
  } catch {
    return;
  }

  if (!session) return;

  // Only respond to the user who started the session
  if (session.discordId !== message.author.id) return;

  // Show typing indicator
  await message.channel.sendTyping();

  try {
    const result = await apiPost<ChatResponse>("/chat/message", {
      channelId,
      userMessage: message.content,
    });

    // Strip json code blocks for display
    let displayReply = result.reply;
    const jsonMatch = displayReply.match(/```json[\s\S]*?```/);
    if (jsonMatch) {
      displayReply = displayReply.replace(jsonMatch[0], "").trim();
      if (!displayReply) {
        displayReply = result.summary || "I've prepared code changes for you.";
      }
    }

    // Truncate if needed for Discord's 4096 char embed limit
    if (displayReply.length > 3900) {
      displayReply = displayReply.slice(0, 3900) + "\n\n*[Response truncated — use /update to apply changes]*";
    }

    if (result.fileChanges && result.fileChanges.length > 0) {
      // Code changes — send rich embed
      const embed = new EmbedBuilder()
        .setColor(0xffffff)
        .setDescription(displayReply || result.summary)
        .addFields(
          {
            name: `${result.fileChanges.length} file(s) staged`,
            value: result.fileChanges.map((f) => `\`${f.path}\``).join("\n"),
          },
          {
            name: "Pending changes",
            value: `${result.pendingCount} file(s) total — use \`/update\` to push to GitHub`,
          }
        )
        .setFooter({ text: "Nano Agent • /update to apply • /rollbacks to restore" });

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`nano_update_hint`)
          .setLabel(`Apply ${result.pendingCount} Change(s) with /update`)
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true)
      );

      await message.reply({ embeds: [embed], components: [row] });
    } else {
      // Plain conversation — simple embed
      const embed = new EmbedBuilder()
        .setColor(0xffffff)
        .setDescription(displayReply);

      await message.reply({ embeds: [embed] });
    }
  } catch (err) {
    console.error("Message handler error:", err);
    await message.reply({
      content: "Something went wrong. Please try again or use `/end` to restart the session.",
    });
  }
}
