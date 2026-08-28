import { pgTable, varchar, timestamp, integer } from 'drizzle-orm/pg-core';
import { groups } from './groups.ts';
import { users } from './users.ts';

export const leaderVotes = pgTable('leader_votes', {
  id: varchar('id', { length: 50 }).primaryKey(),
  groupId: varchar('group_id', { length: 50 }).notNull().references(() => groups.id),
  round: integer('round').default(1).notNull(),
  voterId: varchar('voter_id', { length: 50 }).notNull().references(() => users.id),
  candidateId: varchar('candidate_id', { length: 50 }).notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
