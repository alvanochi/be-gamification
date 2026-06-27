import { pgTable, varchar, timestamp } from 'drizzle-orm/pg-core';

export const authentications = pgTable('authentications', {
  id: varchar('id', { length: 50 }).primaryKey(),
  userId: varchar('user_id', { length: 50 }).notNull(),
  refreshToken: varchar('refresh_token', { length: 512 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
});
