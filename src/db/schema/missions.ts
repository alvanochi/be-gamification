import { pgTable, varchar, text, boolean, integer, timestamp, pgEnum, jsonb, index } from 'drizzle-orm/pg-core';
import { sponsors } from './sponsors.ts';

// KUIS menutup jenis tugas "JAWAB PERTANYAAN" di sheet SIMULASI MR6 — misi yang
// isinya daftar pertanyaan, bukan unggahan bukti.
export const missionTypeEnum = pgEnum('mission_type', ['TANTANGAN', 'BIGGER_BETTER', 'SOAL_LOKASI', 'KUIS']);

/**
 * Cara skor dihitung.
 *
 * MR6 memakai empat gaya penilaian sekaligus:
 *   FLAT      — nilai tetap (mis. "BERHASIL/TIDAK BERHASIL")
 *   RANGE     — subjektif dalam rentang (mis. "50 - 100 POIN")
 *   PER_UNIT  — per satuan hasil (mis. "1 ANAK PANAH = 50 POIN")
 *   TIME_BASED— makin cepat makin tinggi (mis. "WAKTU YANG DITEMPUH")
 *   AUTO_QUIZ — dihitung sistem dari jawaban benar
 */
export const scoringModeEnum = pgEnum('scoring_mode', [
  'FLAT',
  'RANGE',
  'PER_UNIT',
  'TIME_BASED',
  'AUTO_QUIZ',
]);

export const questionTypeEnum = pgEnum('question_type', ['PILIHAN_GANDA', 'ISIAN_SINGKAT']);

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
  openAt: timestamp('open_at', { withTimezone: true }),
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
  // Foto pendamping petunjuk. Terpisah dari `clue` karena sebagian misi memberi
  // petunjuk teks DAN foto titik sekaligus, mis. "FOTO DI TITIK BERIKUT INI"
  // yang diikuti lima foto papan nama.
  clueImages: jsonb('clue_images').$type<string[]>().default([]).notNull(),
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

  // Misi yang bukan satu tugas melainkan kumpulan — mis. "cari sepuluh orang
  // bernama Agus" — boleh dikirim berkali-kali. Tiap kiriman tetap divalidasi
  // sendiri dan poinnya dijumlahkan; yang dilepas hanya larangan mengirim
  // lagi setelah ada yang disetujui.
  allowMultipleSubmissions: boolean('allow_multiple_submissions').default(false).notNull(),

  // Panitia yang menjaga pos ini. Satu misi satu penjaga; satu penjaga boleh
  // memegang beberapa misi — di lembar panitia hal itu ditulis dengan
  // me-merge sel PETUGAS ke beberapa baris sekaligus.
  guardUserId: varchar('guard_user_id', { length: 50 }),

  // Yel-yel: misi tantangan biasa, tetapi satu-satunya yang ikut muncul di
  // rangkaian checkpoint dan punya tenggatnya sendiri terhitung sejak nama
  // kelompok tersimpan. Penilaiannya diatur di event_settings, bukan di sini.
  isYelYel: boolean('is_yel_yel').default(false).notNull(),

  // Daftar alat yang disiapkan panitia di pos (kolom PERALATAN di MR6),
  // mis. "1. BUSUR 4 BUAH\n2. ANAK PANAH 20 BUAH".
  equipment: text('equipment'),

  // --- Konfigurasi penilaian ---
  scoringMode: scoringModeEnum('scoring_mode').default('FLAT').notNull(),

  // PER_UNIT: poin untuk setiap satuan hasil, mis. 50 poin per anak panah.
  pointPerUnit: integer('point_per_unit'),
  // Batas satuan yang diakui, mis. 3 anak panah per peserta. NULL = tanpa batas.
  maxUnits: integer('max_units'),

  // TIME_BASED: waktu acuan dalam detik. Peserta yang mencapai waktu ini atau
  // lebih cepat memperoleh poin penuh (pointWeight); yang lebih lambat
  // memperoleh poin berkurang secara proporsional.
  timeTargetSeconds: integer('time_target_seconds'),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [
  // Dicari setiap kali petugas pos membuka layarnya — "pos mana saja yang
  // saya jaga" adalah pencarian menurut kolom ini, bukan menurut kunci utama.
  index('missions_guard_user_id_idx').on(table.guardUserId),
]);

export const missionOptions = pgTable('mission_options', {
  id: varchar('id', { length: 50 }).primaryKey(),
  missionId: varchar('mission_id', { length: 50 }).notNull().references(() => missions.id),
  optionText: varchar('option_text', { length: 500 }).notNull(),
  isCorrect: boolean('is_correct').default(false).notNull(),
});
