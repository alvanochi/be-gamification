import { pgTable, varchar, timestamp, integer, pgEnum } from 'drizzle-orm/pg-core';
import { groups } from './groups.ts';
import { users } from './users.ts';

export const scoreSourceEnum = pgEnum('score_source', ['CHALLENGE', 'BARTER', 'SOCIAL', 'MANUAL']);

export const scoreEntries = pgTable('score_entries', {
  id: varchar('id', { length: 50 }).primaryKey(),
  groupId: varchar('group_id', { length: 50 }).notNull().references(() => groups.id),
  source: scoreSourceEnum('source').notNull(),
  referenceId: varchar('reference_id', { length: 50 }),
  point: integer('point').notNull(),
  createdBy: varchar('created_by', { length: 50 }).notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
