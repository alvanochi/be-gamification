import { pgTable, varchar, text, boolean, integer, timestamp, pgEnum } from 'drizzle-orm/pg-core';
import { sponsors } from './sponsors.ts';

export const missionTypeEnum = pgEnum('mission_type', ['MEDIA', 'MULTIPLE_CHOICE', 'SHORT_ANSWER']);

export const missions = pgTable('missions', {
  id: varchar('id', { length: 50 }).primaryKey(),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description').notNull(),
  type: missionTypeEnum('type').notNull(),
  isMandatory: boolean('is_mandatory').default(false).notNull(),
  pointWeight: integer('point_weight').default(0).notNull(),
  sponsorId: varchar('sponsor_id', { length: 50 }).references(() => sponsors.id),
  createdAt: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
});

export const missionOptions = pgTable('mission_options', {
  id: varchar('id', { length: 50 }).primaryKey(),
  missionId: varchar('mission_id', { length: 50 }).notNull().references(() => missions.id),
  optionText: varchar('option_text', { length: 500 }).notNull(),
  isCorrect: boolean('is_correct').default(false).notNull(),
});
