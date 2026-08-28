import { pgTable, varchar, timestamp, integer, boolean, text, pgEnum } from 'drizzle-orm/pg-core';

import { assignments } from './assignments.ts';

export const barterStatusEnum = pgEnum('barter_status', ['PENDING', 'APPROVED', 'REJECTED']);

export const barterSteps = pgTable('barter_steps', {
  id: varchar('id', { length: 50 }).primaryKey(),
  assignmentId: varchar('assignment_id', { length: 50 }).notNull().references(() => assignments.id),
  stepNo: integer('step_no').notNull(),
  itemFrom: varchar('item_from', { length: 255 }).notNull(),
  itemTo: varchar('item_to', { length: 255 }).notNull(),
  partnerName: varchar('partner_name', { length: 255 }),
  videoUrl: varchar('video_url', { length: 1024 }).notNull(),
  isValid: boolean('is_valid').default(true).notNull(),

  // Tiap pertukaran divalidasi panitia satu per satu. Kelompok baru boleh
  // menukar lagi setelah langkah terakhirnya disetujui — sesuai alur MR6:
  // tukar → kirim foto → tunggu validasi → disetujui → tukar lagi.
  status: barterStatusEnum('status').default('PENDING').notNull(),
  awardedPoint: integer('awarded_point'),
  rejectReason: text('reject_reason'),
  validatedBy: varchar('validated_by', { length: 50 }),
  validatedAt: timestamp('validated_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
