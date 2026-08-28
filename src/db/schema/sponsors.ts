import { pgTable, varchar, timestamp, integer, boolean } from 'drizzle-orm/pg-core';

export const sponsors = pgTable('sponsors', {
  id: varchar('id', { length: 50 }).primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  logoUrl: varchar('logo_url', { length: 1024 }).notNull(),
  linkUrl: varchar('link_url', { length: 1024 }),
  orderNum: integer('order_num').default(0).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  impressions: integer('impressions').default(0).notNull(),
  clicks: integer('clicks').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
