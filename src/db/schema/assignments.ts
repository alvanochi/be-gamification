import { pgTable, varchar, timestamp, text, pgEnum } from 'drizzle-orm/pg-core';
import { missions } from './missions.ts';
import { groups } from './groups.ts';
import { users } from './users.ts';

export const assignmentStatusEnum = pgEnum('assignment_status', ['TODO', 'DOING', 'REVIEW', 'ACCEPTED', 'REJECTED']);

export const assignments = pgTable('assignments', {
  id: varchar('id', { length: 50 }).primaryKey(),
  missionId: varchar('mission_id', { length: 50 }).notNull().references(() => missions.id),
  groupId: varchar('group_id', { length: 50 }).notNull().references(() => groups.id),
  assigneeUserId: varchar('assignee_user_id', { length: 50 }).references(() => users.id),
  status: assignmentStatusEnum('status').default('TODO').notNull(),
  rejectReason: text('reject_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
