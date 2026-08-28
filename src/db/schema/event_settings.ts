import { pgTable, varchar, integer, boolean, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Pengaturan acara — satu baris tunggal, diubah Super Admin dari panel.
 *
 * Semua angka waktu dan poin yang dulu tertanam di kode kini duduk di sini,
 * supaya panitia bisa menyesuaikannya menjelang hari-H tanpa deploy ulang.
 */
export const eventSettings = pgTable('event_settings', {
  // Selalu 'default' — tabel ini sengaja hanya berisi satu baris.
  id: varchar('id', { length: 20 }).primaryKey().default('default'),

  // --- Gerbang rilis misi ---
  // Peserta dikumpulkan dan dibriefing dulu; daftar misi baru muncul setelah
  // panitia menekan "Munculkan Misi".
  missionsReleased: boolean('missions_released').default(false).notNull(),
  missionsReleasedAt: timestamp('missions_released_at', { withTimezone: true }),

  // --- Pengumuman ke peserta ---
  announcement: text('announcement'),
  announcedAt: timestamp('announced_at', { withTimezone: true }),

  // --- Timer & poin pembentukan kelompok ---
  formationLimitMinutes: integer('formation_limit_minutes').default(30).notNull(),
  formationGraceMinutes: integer('formation_grace_minutes').default(15).notNull(),
  formationFullPoint: integer('formation_full_point').default(100).notNull(),
  formationLatePoint: integer('formation_late_point').default(50).notNull(),

  // --- Yel-yel ---
  yelYelDeadlineHours: integer('yelyel_deadline_hours').default(24).notNull(),
  yelYelOnTimePoint: integer('yelyel_ontime_point').default(100).notNull(),
  yelYelLatePoint: integer('yelyel_late_point').default(50).notNull(),

  // --- Bigger Better ---
  // Poin untuk setiap pertukaran yang disetujui panitia.
  barterPointPerStep: integer('barter_point_per_step').default(20).notNull(),

  // --- Leaderboard ---
  leaderboardTopN: integer('leaderboard_top_n').default(10).notNull(),

  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
