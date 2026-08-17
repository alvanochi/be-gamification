import { pgTable, varchar, timestamp, integer, jsonb } from 'drizzle-orm/pg-core';
import { users } from './users.ts';

export const groups = pgTable('groups', {
  id: varchar('id', { length: 50 }).primaryKey(),
  name: varchar('name', { length: 255 }).notNull().unique(),
  leaderId: varchar('leader_id', { length: 50 }), // Circular reference to users, handled in relations or explicitly
  score: integer('score').default(0).notNull(),
  photoCompletedAt: timestamp('photo_completed_at', { withTimezone: false }),
  // URL foto kelompok. Sebelumnya langkah ini hanya membalik timestamp di
  // atas, sehingga fotonya tidak pernah benar-benar tersimpan di mana pun.
  photoUrl: varchar('photo_url', { length: 1024 }),
  // Siapa yang pertama mengunggah foto kelompok. Anggota lain diberi tahu
  // namanya, dan tidak bisa mengunggah lagi setelah ini terisi.
  photoBy: varchar('photo_by', { length: 50 }),

  // Kategori kelompok (putra/putri/campuran/dll) beserta warnanya.
  categoryId: varchar('category_id', { length: 50 }),

  // Penanda mulai untuk hitung mundur pembentukan kelompok. Diisi saat
  // kelompok terbentuk; poin pembentukan dihitung dari selisih waktu ini
  // sampai nama kelompok tersimpan.
  startedAt: timestamp('started_at', { withTimezone: false }),
  formationPoint: integer('formation_point'),
  nameSetAt: timestamp('name_set_at', { withTimezone: false }), // null until the leader deliberately names the group; the placeholder auto-name at creation doesn't count

  // Kelompok yang memilih mengerjakan yel-yel belakangan. Bukti yang masuk
  // setelah ini dinilai dengan tarif yang lebih rendah.
  yelYelSkippedAt: timestamp('yel_yel_skipped_at', { withTimezone: false }),

  // Calon yang tersisa untuk putaran kedua pemilihan ketua. Kosong berarti
  // seluruh anggota masih boleh dipilih.
  runoffCandidateIds: jsonb('runoff_candidate_ids').$type<string[] | null>(),

  createdAt: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
});
