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
  fileDeletions: Array<{ path: string; message: string }>;
  summary: string;
  pendingCount: number;
}

const THINKING_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export async function handleMessageCreate(message: any) {
  const channelId = message.channelId;

  let session: ChatSession | null = null;
  try {
    session = await apiGet<ChatSession | null>(`/chat/${channelId}`);
  } catch {
    return;
  }

  if (!session) return;
  if (session.discordId !== message.author.id) return;

  // Send initial "thinking" message — no ping, just channel send
  const thinkingEmbed = new EmbedBuilder()
    .setColor(0xffffff)
    .setDescription(`${THINKING_FRAMES[0]}  Nano is thinking...`);

  const thinkingMsg = await message.channel.send({ embeds: [thinkingEmbed] });

  // Animate while the API call runs
  let frameIndex = 1;
  const animInterval = setInterval(async () => {
    try {
      const frame = THINKING_FRAMES[frameIndex % THINKING_FRAMES.length];
      frameIndex++;
      const animEmbed = new EmbedBuilder()
        .setColor(0xffffff)
        .setDescription(`${frame}  Nano is thinking...`);
      await thinkingMsg.edit({ embeds: [animEmbed] });
    } catch {}
  }, 600);

  try {
    const result = await apiPost<ChatResponse>("/chat/message", {
      channelId,
      userMessage: message.content,
    });

    clearInterval(animInterval);

    // Strip json code blocks for display
    let displayReply = result.reply;
    const jsonBlocks = [...displayReply.matchAll(/```json[\s\S]*?```/g)];
    for (const block of jsonBlocks) {
      displayReply = displayReply.replace(block[0], "").trim();
    }
    if (!displayReply) {
      displayReply = result.summary || "Changes have been staged.";
    }

    if (displayReply.length > 3900) {
      displayReply = displayReply.slice(0, 3900) + "\n\n*[Response truncated — use /update to apply changes]*";
    }

    const hasChanges = (result.fileChanges?.length ?? 0) > 0;
    const hasDeletions = (result.fileDeletions?.length ?? 0) > 0;

    if (hasChanges || hasDeletions) {
      const fields = [];

      if (hasChanges) {
        fields.push({
          name: `${result.fileChanges.length} file(s) to update`,
          value: result.fileChanges.map(f => `\`${f.path}\``).join("\n"),
        });
      }

      if (hasDeletions) {
        fields.push({
          name: `${result.fileDeletions.length} file(s) to delete`,
          value: result.fileDeletions.map(f => `~~\`${f.path}\`~~`).join("\n"),
        });
      }

      fields.push({
        name: "Pending changes",
        value: `${result.pendingCount} total — use \`/update\` to push to GitHub`,
      });

      const finalEmbed = new EmbedBuilder()
        .setColor(0xffffff)
        .setDescription(displayReply)
        .addFields(fields)
        .setFooter({ text: "Nano Agent • /update to apply • /rollbacks to restore" });

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`nano_update_hint`)
          .setLabel(`Apply ${result.pendingCount} Change(s) with /update`)
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true)
      );

      await thinkingMsg.edit({ embeds: [finalEmbed], components: [row] });
    } else {
      const finalEmbed = new EmbedBuilder()
        .setColor(0xffffff)
        .setDescription(displayReply);

      await thinkingMsg.edit({ embeds: [finalEmbed] });
    }
  } catch (err) {
    clearInterval(animInterval);
    console.error("Message handler error:", err);
    const errEmbed = new EmbedBuilder()
      .setColor(0xffffff)
      .setDescription("Something went wrong. Please try again or use `/end` to restart the session.");
    await thinkingMsg.edit({ embeds: [errEmbed] });
  }
}
