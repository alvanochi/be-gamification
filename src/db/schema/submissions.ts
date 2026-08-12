import { pgTable, varchar, text, integer, timestamp, pgEnum } from 'drizzle-orm/pg-core';
import { missions, missionOptions } from './missions.ts';
import { groups } from './groups.ts';
import { users } from './users.ts';

export const submissionStatusEnum = pgEnum('submission_status', ['PENDING', 'APPROVED', 'REJECTED']);

export const submissions = pgTable('submissions', {
  id: varchar('id', { length: 50 }).primaryKey(),
  missionId: varchar('mission_id', { length: 50 }).notNull().references(() => missions.id),
  groupId: varchar('group_id', { length: 50 }).notNull().references(() => groups.id),
  submittedBy: varchar('submitted_by', { length: 50 }).notNull().references(() => users.id),
  status: submissionStatusEnum('status').default('PENDING').notNull(),
  mediaUrl: varchar('media_url', { length: 1024 }),
  answerText: text('answer_text'),
  selectedOptionId: varchar('selected_option_id', { length: 50 }).references(() => missionOptions.id),
  // Nilai yang benar-benar diberikan panitia. Untuk misi dengan rentang MR6
  // (mis. 50-100 poin) angkanya bisa berbeda dari missions.pointWeight.
  awardedPoint: integer('awarded_point'),
  rejectReason: text('reject_reason'),
  validatedBy: varchar('validated_by', { length: 50 }).references(() => users.id),
  validatedAt: timestamp('validated_at', { withTimezone: false }),
  createdAt: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
});
