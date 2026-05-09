import { pgTable, text, serial, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const chatSessionsTable = pgTable("chat_sessions", {
  id: serial("id").primaryKey(),
  discordId: text("discord_id").notNull(),
  channelId: text("channel_id").notNull().unique(),
  repoFullName: text("repo_full_name").notNull(),
  history: text("history").notNull().default("[]"),
  pendingFiles: text("pending_files").notNull().default("{}"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertChatSessionSchema = createInsertSchema(chatSessionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertChatSession = z.infer<typeof insertChatSessionSchema>;
export type ChatSession = typeof chatSessionsTable.$inferSelect;
