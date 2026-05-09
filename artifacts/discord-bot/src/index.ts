import { Client, GatewayIntentBits, Collection, Events } from "discord.js";
import { connectAccount } from "./commands/connectAccount.js";
import { profileStatus } from "./commands/profileStatus.js";
import { start } from "./commands/start.js";
import { update } from "./commands/update.js";
import { end } from "./commands/end.js";
import { rollbacks } from "./commands/rollbacks.js";
import { help } from "./commands/help.js";
import { handleMessageCreate } from "./handlers/messageHandler.js";
import { handleInteraction } from "./handlers/interactionHandler.js";

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) throw new Error("DISCORD_BOT_TOKEN is required");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const commands = new Collection<string, any>();
const commandList = [connectAccount, profileStatus, start, update, end, rollbacks, help];
for (const cmd of commandList) {
  commands.set(cmd.data.name, cmd);
}

client.once(Events.ClientReady, (c) => {
  console.log(`Nano Agent is online as ${c.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  await handleInteraction(interaction, commands);
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  await handleMessageCreate(message);
});

client.login(token);
