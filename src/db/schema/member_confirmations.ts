import { pgTable, varchar, timestamp } from 'drizzle-orm/pg-core';
import { groups } from './groups.ts';
import { users } from './users.ts';

export const memberConfirmations = pgTable('member_confirmations', {
  id: varchar('id', { length: 50 }).primaryKey(),
  groupId: varchar('group_id', { length: 50 }).notNull().references(() => groups.id),
  confirmerId: varchar('confirmer_id', { length: 50 }).notNull().references(() => users.id),
  confirmedId: varchar('confirmed_id', { length: 50 }).notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
