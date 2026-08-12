import { pgTable, varchar, text, boolean, integer, timestamp, pgEnum, jsonb } from 'drizzle-orm/pg-core';
import { sponsors } from './sponsors.ts';

export const missionTypeEnum = pgEnum('mission_type', ['TANTANGAN', 'BIGGER_BETTER', 'SOAL_LOKASI']);

// MR6 membagi seluruh simulasi ke dua kategori besar: TERSTRUKTUR (ada pos &
// petugas, jadwalnya per sesi) dan MANDIRI (dikerjakan kelompok sendiri, waktu bebas).
export const missionCategoryEnum = pgEnum('mission_category', ['TERSTRUKTUR', 'MANDIRI']);

// Bentuk petunjuk menuju lokasi misi, sesuai kolom "PETUNJUK" di MR6.
export const clueTypeEnum = pgEnum('clue_type', ['NONE', 'TEKS', 'MORSE', 'SANDI_ANGKA', 'GPS', 'FOTO', 'MAP']);

// Bentuk bukti yang diminta, sesuai kolom "PEMBUKTIAN" di MR6.
export const proofTypeEnum = pgEnum('proof_type', [
  'FOTO',
  'VIDEO',
  'FOTO_VIDEO',
  'LINK_SOSMED',
  'LAPORAN_PETUGAS',
  'INPUT_HASIL',
]);

export const missions = pgTable('missions', {
  id: varchar('id', { length: 50 }).primaryKey(),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description').notNull(),
  type: missionTypeEnum('type').notNull(),
  isMandatory: boolean('is_mandatory').default(false).notNull(),
  pointWeight: integer('point_weight').default(0).notNull(),
  sponsorId: varchar('sponsor_id', { length: 50 }).references(() => sponsors.id),
  openAt: timestamp('open_at', { withTimezone: false }),
  prerequisiteId: varchar('prerequisite_id', { length: 50 }),
  participantCount: integer('participant_count').default(1).notNull(),
  geoLat: varchar('geo_lat', { length: 255 }),
  geoLng: varchar('geo_lng', { length: 255 }),
  geoRadius: integer('geo_radius'),
  pointRules: jsonb('point_rules'),

  // --- Kebutuhan MR6 (MR6_TataCaraSimulasi GAME.xlsx) ---
  category: missionCategoryEnum('category').default('MANDIRI').notNull(),

  // Petunjuk menuju lokasi. `clue` menyimpan isinya apa adanya (teks morse,
  // koordinat, URL foto/map) dan `clueType` memberi tahu UI cara menampilkannya.
  clueType: clueTypeEnum('clue_type').default('NONE').notNull(),
  clue: text('clue'),
  locationName: varchar('location_name', { length: 255 }),

  // Sesi harian, disimpan sebagai "HH:MM" waktu lokal acara — bukan timestamp,
  // karena MR6 mendefinisikannya sebagai jendela jam yang berulang, bukan tanggal.
  sessionStart: varchar('session_start', { length: 5 }),
  sessionEnd: varchar('session_end', { length: 5 }),

  // Durasi pengerjaan di pos, dalam menit. NULL berarti "BEBAS" di MR6.
  durationMinutes: integer('duration_minutes'),

  proofType: proofTypeEnum('proof_type').default('FOTO').notNull(),

  // Penilaian rentang: banyak misi MR6 dinilai subjektif (mis. "50 - 100 POIN").
  // Jika keduanya terisi, panitia wajib mengisi nilai dalam rentang ini saat
  // Approve; jika NULL, sistem memakai pointWeight sebagai nilai tetap.
  pointMin: integer('point_min'),
  pointMax: integer('point_max'),

  // Misi TERSTRUKTUR mewajibkan lapor ke petugas pos lewat check-in online.
  requiresCheckIn: boolean('requires_check_in').default(false).notNull(),

  createdAt: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: false }).defaultNow().notNull(),
});

export const missionOptions = pgTable('mission_options', {
  id: varchar('id', { length: 50 }).primaryKey(),
  missionId: varchar('mission_id', { length: 50 }).notNull().references(() => missions.id),
  optionText: varchar('option_text', { length: 500 }).notNull(),
  isCorrect: boolean('is_correct').default(false).notNull(),
});
