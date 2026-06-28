import { pgTable, varchar, timestamp, pgEnum } from 'drizzle-orm/pg-core';
import { groups } from './groups.ts';

export const userRoleEnum = pgEnum('user_role', ['PARTICIPANT', 'ADMIN', 'SUPER_ADMIN']);


export const users = pgTable('users', {
  id: varchar('id', { length: 50 }).primaryKey(),
  role: userRoleEnum('role').default('PARTICIPANT').notNull(),
  qrToken: varchar('qr_token', { length: 255 }).unique(),
  groupId: varchar('group_id', { length: 50 }).references(() => groups.id),
  email: varchar('email', { length: 255 }).unique(), // Made nullable for participants
  password: varchar('password', { length: 255 }), // Made nullable for participants
  fullname: varchar('fullname', { length: 255 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
});
