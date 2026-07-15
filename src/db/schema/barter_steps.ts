import { pgTable, varchar, timestamp, integer, boolean } from 'drizzle-orm/pg-core';
import { assignments } from './assignments.ts';

export const barterSteps = pgTable('barter_steps', {
  id: varchar('id', { length: 50 }).primaryKey(),
  assignmentId: varchar('assignment_id', { length: 50 }).notNull().references(() => assignments.id),
  stepNo: integer('step_no').notNull(),
  itemFrom: varchar('item_from', { length: 255 }).notNull(),
  itemTo: varchar('item_to', { length: 255 }).notNull(),
  partnerName: varchar('partner_name', { length: 255 }),
  videoUrl: varchar('video_url', { length: 1024 }).notNull(),
  isValid: boolean('is_valid').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
});
