import { pgTable, varchar, timestamp, integer } from 'drizzle-orm/pg-core';
import { users } from './users.ts';

export const groups = pgTable('groups', {
  id: varchar('id', { length: 50 }).primaryKey(),
  name: varchar('name', { length: 255 }).notNull().unique(),
  leaderId: varchar('leader_id', { length: 50 }), // Circular reference to users, handled in relations or explicitly
  score: integer('score').default(0).notNull(),
  photoCompletedAt: timestamp('photo_completed_at', { withTimezone: false }),
  // URL foto kelompok di R2. Sebelumnya langkah ini hanya membalik timestamp di
  // atas, sehingga fotonya tidak pernah benar-benar tersimpan di mana pun.
  photoUrl: varchar('photo_url', { length: 1024 }),
  nameSetAt: timestamp('name_set_at', { withTimezone: false }), // null until the leader deliberately names the group; the placeholder auto-name at creation doesn't count
  createdAt: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
});
