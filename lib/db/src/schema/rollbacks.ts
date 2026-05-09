import { pgTable, text, serial, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const rollbacksTable = pgTable("rollbacks", {
  id: serial("id").primaryKey(),
  discordId: text("discord_id").notNull(),
  repoFullName: text("repo_full_name").notNull(),
  label: text("label").notNull(),
  commitSha: text("commit_sha").notNull(),
  description: text("description"),
  files: text("files"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertRollbackSchema = createInsertSchema(rollbacksTable).omit({ id: true, createdAt: true });
export type InsertRollback = z.infer<typeof insertRollbackSchema>;
export type Rollback = typeof rollbacksTable.$inferSelect;
