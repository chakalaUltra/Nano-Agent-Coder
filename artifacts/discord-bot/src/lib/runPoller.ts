import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { apiGet } from "./api.js";

interface ConsoleData {
  logs: string[];
  status: string;
  url: string;
  port: number;
  autoFixAttempts: number;
  events: Array<{ type: string; message: string; at: string }>;
}

interface PollState {
  timer: ReturnType<typeof setInterval>;
  seenEventCount: number;
  iteration: number;
}

const pollers = new Map<string, PollState>();

const STATUS_LABEL: Record<string, string> = {
  running: "Running",
  cloning: "Cloning repository...",
  installing: "Installing dependencies...",
  error: "Error — Nano is fixing",
  fixing: "Nano is auto-fixing...",
  stopped: "Stopped",
};

// Build the console embed from a console data snapshot.
export function buildConsoleEmbed(data: ConsoleData): EmbedBuilder {
  const logsText = data.logs.slice(-25).join("\n") || "*No output yet...*";
  const safeLog = logsText.length > 3800 ? "..." + logsText.slice(-3800) : logsText;

  return new EmbedBuilder()
    .setColor(0xffffff)
    .setTitle("Project Console")
    .setDescription("```\n" + safeLog + "\n```")
    .addFields(
      { name: "Status", value: STATUS_LABEL[data.status] ?? data.status, inline: true },
      { name: "URL", value: data.url || "—", inline: true },
    )
    .setFooter({ text: "Live console  •  Auto-updating every 5s  •  Nano auto-fixes errors" });
}

function buildConsoleRow(channelId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`run_refresh_${channelId}`)
      .setLabel("Force Refresh")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`run_stop_${channelId}`)
      .setLabel("Stop Project")
      .setStyle(ButtonStyle.Danger),
  );
}

// Start auto-polling the console for a channel.
// - interaction: the Discord interaction to edit the reply on
// - channel: the Discord channel to post fix/error messages to
export function startPoller(channelId: string, interaction: any, channel: any): void {
  stopPoller(channelId); // cancel any existing poller

  let seenEventCount = 0;
  let iteration = 0;
  const MAX_ITERATIONS = 200; // ~16 minutes at 5s each

  const timer = setInterval(async () => {
    iteration++;

    // Stop polling if too many iterations have passed
    if (iteration > MAX_ITERATIONS) {
      stopPoller(channelId);
      return;
    }

    let data: ConsoleData;
    try {
      data = await apiGet<ConsoleData>(`/run/console/${channelId}`);
    } catch {
      // Session no longer exists — stop polling
      stopPoller(channelId);
      return;
    }

    // Post any new events to the channel (visible to everyone, not just the user)
    const newEvents = data.events.slice(seenEventCount);
    seenEventCount = data.events.length;

    for (const event of newEvents) {
      if (!channel) continue;
      try {
        let content = "";
        if (event.type === "error_detected") {
          content = `**Nano detected an error in ${channelId}:**\n${event.message}`;
        } else if (event.type === "fix_start") {
          content = `**Nano is auto-fixing:** ${event.message}`;
        } else if (event.type === "fix_done") {
          content = `**Nano applied a fix:** ${event.message}`;
        } else if (event.type === "fix_failed") {
          content = `**Auto-fix failed:** ${event.message}`;
        }
        if (content) await channel.send({ content });
      } catch {}
    }

    // Update the console embed
    try {
      const embed = buildConsoleEmbed(data);
      const row = buildConsoleRow(channelId);

      // If status is terminal and no fix in progress, remove the auto-update footer note
      if (data.status === "stopped") {
        embed.setFooter({ text: "Project stopped  •  Use /run-project to start again" });
      }

      await interaction.editReply({ embeds: [embed], components: [row] });
    } catch {
      // Interaction may have expired — stop polling
      stopPoller(channelId);
      return;
    }

    // Stop auto-polling on terminal states
    if (data.status === "stopped") {
      stopPoller(channelId);
    }

    // Stop if error AND all fix attempts exhausted
    if (data.status === "error" && data.autoFixAttempts >= 3) {
      try {
        const embed = buildConsoleEmbed(data);
        embed.setFooter({ text: "Auto-fix exhausted (3/3 attempts)  •  Manual fix needed  •  Use /update to push edits" });
        await interaction.editReply({ embeds: [embed], components: [buildConsoleRow(channelId)] });
      } catch {}
      stopPoller(channelId);
    }
  }, 5000);

  pollers.set(channelId, { timer, seenEventCount: 0, iteration: 0 });
}

export function stopPoller(channelId: string): void {
  const state = pollers.get(channelId);
  if (state) {
    clearInterval(state.timer);
    pollers.delete(channelId);
  }
}
