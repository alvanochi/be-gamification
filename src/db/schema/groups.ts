import { pgTable, varchar, timestamp, integer } from 'drizzle-orm/pg-core';
import { users } from './users.ts';

export const groups = pgTable('groups', {
  id: varchar('id', { length: 50 }).primaryKey(),
  name: varchar('name', { length: 255 }).notNull().unique(),
  leaderId: varchar('leader_id', { length: 50 }), // Circular reference to users, handled in relations or explicitly
  score: integer('score').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
});
