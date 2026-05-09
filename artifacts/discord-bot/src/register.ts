import { REST, Routes, SlashCommandBuilder } from "discord.js";
import { connectAccount } from "./commands/connectAccount.js";
import { profileStatus } from "./commands/profileStatus.js";
import { start } from "./commands/start.js";
import { update } from "./commands/update.js";
import { end } from "./commands/end.js";
import { rollbacks } from "./commands/rollbacks.js";
import { help } from "./commands/help.js";

const token = process.env.DISCORD_BOT_TOKEN!;
const clientId = process.env.DISCORD_CLIENT_ID!;

const commands = [connectAccount, profileStatus, start, update, end, rollbacks, help].map(
  (cmd) => cmd.data.toJSON()
);

const rest = new REST().setToken(token);

(async () => {
  console.log("Registering slash commands...");
  await rest.put(Routes.applicationCommands(clientId), { body: commands });
  console.log("Commands registered successfully.");
})();
