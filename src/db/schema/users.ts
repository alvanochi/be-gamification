import { pgTable, varchar, timestamp, boolean, pgEnum } from 'drizzle-orm/pg-core';
import { groups } from './groups.ts';

/**
 * POST_GUARD adalah panitia yang ditugaskan menjaga satu pos saja: memindai
 * kedatangan, memberi nilai, memindai kepergian. Ia tidak punya akses ke
 * bagian panel yang lain.
 */
export const userRoleEnum = pgEnum('user_role', ['PARTICIPANT', 'ADMIN', 'SUPER_ADMIN', 'POST_GUARD']);


export const users = pgTable('users', {
  id: varchar('id', { length: 50 }).primaryKey(),
  role: userRoleEnum('role').default('PARTICIPANT').notNull(),
  qrToken: varchar('qr_token', { length: 255 }).unique(),
  groupId: varchar('group_id', { length: 50 }).references(() => groups.id),
  email: varchar('email', { length: 255 }).unique(), // Made nullable for participants
  phoneNumber: varchar('phone_number', { length: 50 }).unique(),
  password: varchar('password', { length: 255 }), // Made nullable for participants
  fullname: varchar('fullname', { length: 255 }).notNull(),
  // 'L' atau 'P'. Panitia memakainya untuk menyusun kelompok dan sebagian
  // misi; dijaga oleh CHECK constraint di migrasi 0007.
  gender: varchar('gender', { length: 1 }).$type<'L' | 'P'>(),
  businessName: varchar('business_name', { length: 255 }),
  youtubeAccount: varchar('youtube_account', { length: 255 }),
  instagramAccount: varchar('instagram_account', { length: 255 }),
  tiktokAccount: varchar('tiktok_account', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
  checkInAt: timestamp('checkin_at', { withTimezone: false }),

  // Checkpoint 0 — profil usaha & akun media sosial. Terisi begitu peserta
  // melewatinya, entah dengan mengisi atau memilih melewati; `skipped`
  // membedakan keduanya karena penilaian media sosial bergantung padanya.
  socialProfileAt: timestamp('social_profile_at', { withTimezone: false }),
  socialProfileSkipped: boolean('social_profile_skipped').default(false).notNull(),

  // Pos yang dijaga — hanya berlaku untuk POST_GUARD. Kunci asingnya dipasang
  // migrasi 0009 di basis data.
  assignedMissionId: varchar('assigned_mission_id', { length: 50 }),
});
