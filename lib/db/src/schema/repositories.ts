import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const repositoriesTable = pgTable("repositories", {
  id: serial("id").primaryKey(),
  discordId: text("discord_id").notNull(),
  repoFullName: text("repo_full_name").notNull(),
  repoName: text("repo_name").notNull(),
  isPrivate: boolean("is_private").default(false).notNull(),
  activeSessionChannelId: text("active_session_channel_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertRepositorySchema = createInsertSchema(repositoriesTable).omit({ id: true, createdAt: true });
export type InsertRepository = z.infer<typeof insertRepositorySchema>;
export type Repository = typeof repositoriesTable.$inferSelect;
