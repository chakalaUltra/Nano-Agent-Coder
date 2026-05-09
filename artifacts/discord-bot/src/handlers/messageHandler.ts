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
const THINKING_LABELS = [
  "Reading your message...",
  "Thinking...",
  "Checking the repo...",
  "Working on it...",
  "Almost there...",
];

function chunkText(text: string, maxLen = 3900): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    let splitAt = remaining.lastIndexOf("\n", maxLen);
    if (splitAt < maxLen * 0.5) splitAt = maxLen;
    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }
  return chunks;
}

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

  const thinkingEmbed = new EmbedBuilder()
    .setColor(0xffffff)
    .setDescription(`${THINKING_FRAMES[0]}  ${THINKING_LABELS[0]}`);

  const thinkingMsg = await message.channel.send({ embeds: [thinkingEmbed] });

  let frameIndex = 1;
  let labelIndex = 0;
  let labelTick = 0;
  const animInterval = setInterval(async () => {
    try {
      const frame = THINKING_FRAMES[frameIndex % THINKING_FRAMES.length];
      frameIndex++;
      labelTick++;
      if (labelTick % 5 === 0) {
        labelIndex = (labelIndex + 1) % THINKING_LABELS.length;
      }
      const animEmbed = new EmbedBuilder()
        .setColor(0xffffff)
        .setDescription(`${frame}  ${THINKING_LABELS[labelIndex]}`);
      await thinkingMsg.edit({ embeds: [animEmbed] });
    } catch {}
  }, 600);

  try {
    const result = await apiPost<ChatResponse>("/chat/message", {
      channelId,
      userMessage: message.content,
    });

    clearInterval(animInterval);

    // Strip json code blocks from display text
    let displayReply = result.reply;
    const jsonBlocks = [...displayReply.matchAll(/```json[\s\S]*?```/g)];
    for (const block of jsonBlocks) {
      displayReply = displayReply.replace(block[0], "").trim();
    }
    if (!displayReply) {
      displayReply = result.summary || "Changes have been staged.";
    }

    const hasChanges = (result.fileChanges?.length ?? 0) > 0;
    const hasDeletions = (result.fileDeletions?.length ?? 0) > 0;
    const hasFileActivity = hasChanges || hasDeletions;

    // --- Message 1: the conversational reply (edit the thinking message) ---
    const chunks = chunkText(displayReply);

    const firstEmbed = new EmbedBuilder()
      .setColor(0xffffff)
      .setDescription(chunks[0]);

    await thinkingMsg.edit({ embeds: [firstEmbed] });

    // Send any overflow chunks as follow-up messages
    for (let i = 1; i < chunks.length; i++) {
      const overflowEmbed = new EmbedBuilder()
        .setColor(0xffffff)
        .setDescription(chunks[i]);
      await message.channel.send({ embeds: [overflowEmbed] });
    }

    // --- Message 2: staged file changes (separate message if applicable) ---
    if (hasFileActivity) {
      const fields = [];

      if (hasChanges) {
        fields.push({
          name: `${result.fileChanges.length} file(s) staged for update`,
          value: result.fileChanges.map(f => `\`${f.path}\``).join("\n"),
        });
      }

      if (hasDeletions) {
        fields.push({
          name: `${result.fileDeletions.length} file(s) staged for deletion`,
          value: result.fileDeletions.map(f => `~~\`${f.path}\`~~`).join("\n"),
        });
      }

      fields.push({
        name: "Total pending",
        value: `${result.pendingCount} change(s) ready — use \`/update\` to push to GitHub`,
      });

      const changesEmbed = new EmbedBuilder()
        .setColor(0xffffff)
        .setTitle("Staged Changes")
        .addFields(fields)
        .setFooter({ text: "Nano Agent • /update to apply • /rollbacks to restore" });

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`nano_update_hint`)
          .setLabel(`Push ${result.pendingCount} Change(s) — use /update`)
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true)
      );

      await message.channel.send({ embeds: [changesEmbed], components: [row] });
    }
  } catch (err: any) {
    clearInterval(animInterval);
    console.error("Message handler error:", err);
    let description = "Something went wrong. Please try again or use `/end` to restart the session.";
    try {
      const body = await err?.response?.json?.();
      if (body?.error) description = body.error;
    } catch {}
    if (err?.message?.includes("429")) {
      description = "Nano has hit the AI rate limit. Please wait a few minutes and try again.";
    }
    const errEmbed = new EmbedBuilder()
      .setColor(0xffffff)
      .setDescription(description);
    await thinkingMsg.edit({ embeds: [errEmbed] });
  }
}
