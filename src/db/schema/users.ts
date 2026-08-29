import { pgTable, varchar, timestamp, boolean, integer, pgEnum } from 'drizzle-orm/pg-core';
import { groups } from './groups.ts';

/**
 * POST_GUARD adalah panitia yang ditugaskan menjaga pos: memindai kedatangan,
 * memberi nilai, memindai kepergian. Ia tidak punya akses ke bagian panel yang
 * lain. Pos yang dijaganya tercatat di missions.guardUserId — satu petugas
 * boleh memegang beberapa pos sekaligus.
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
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  checkInAt: timestamp('checkin_at', { withTimezone: true }),

  // Checkpoint 0 — profil usaha & akun media sosial. Terisi begitu peserta
  // melewatinya, entah dengan mengisi atau memilih melewati; `skipped`
  // membedakan keduanya karena penilaian media sosial bergantung padanya.
  socialProfileAt: timestamp('social_profile_at', { withTimezone: true }),
  socialProfileSkipped: boolean('social_profile_skipped').default(false).notNull(),

  // Jumlah postingan peserta ini, dikirim pihak eksternal yang memantau media
  // sosial dan dicocokkan lewat username di atas. Dipisah per platform karena
  // pemantauannya berjalan sendiri-sendiri dan dikirim di waktu berbeda —
  // satu kolom bersama berarti kiriman TikTok menimpa angka Instagram.
  // Totalnya dijumlahkan saat dibaca; lihat src/utils/finalScore.ts.
  socialPostInstagram: integer('social_post_instagram').default(0).notNull(),
  socialPostTiktok: integer('social_post_tiktok').default(0).notNull(),
  socialPostYoutube: integer('social_post_youtube').default(0).notNull(),
  socialPostCountAt: timestamp('social_post_count_at', { withTimezone: true }),
});
