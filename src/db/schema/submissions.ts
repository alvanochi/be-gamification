import { pgTable, varchar, text, integer, timestamp, pgEnum, jsonb } from 'drizzle-orm/pg-core';
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
  // Bukti bisa lebih dari satu berkas: misi yang meminta foto di lima titik
  // tidak bisa diwakili satu URL. Selalu berupa array — kosong bila buktinya
  // memang bukan berkas (link sosmed, laporan petugas).
  mediaUrls: jsonb('media_urls').$type<string[]>().default([]).notNull(),
  answerText: text('answer_text'),
  selectedOptionId: varchar('selected_option_id', { length: 50 }).references(() => missionOptions.id),
  // Nilai yang benar-benar diberikan panitia. Untuk misi dengan rentang MR6
  // (mis. 50-100 poin) angkanya bisa berbeda dari missions.pointWeight.
  awardedPoint: integer('awarded_point'),
  rejectReason: text('reject_reason'),
  validatedBy: varchar('validated_by', { length: 50 }).references(() => users.id),
  validatedAt: timestamp('validated_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
