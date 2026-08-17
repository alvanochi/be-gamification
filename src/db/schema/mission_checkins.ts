import { pgTable, varchar, timestamp, unique } from 'drizzle-orm/pg-core';
import { missions } from './missions.ts';
import { groups } from './groups.ts';
import { users } from './users.ts';

// Hampir semua "TATA CARA" di MR6 dibuka dengan "PESERTA MELAKUKAN CHECK-IN
// SECARA ONLINE" dan ditutup dengan "PESERTA CHECK-OUT SECARA ONLINE".
// Satu baris per (misi, kelompok) — check-in dilakukan sekali oleh salah satu
// anggota dan berlaku untuk seluruh kelompok, sama seperti submission.
export const missionCheckins = pgTable(
  'mission_checkins',
  {
    id: varchar('id', { length: 50 }).primaryKey(),
    missionId: varchar('mission_id', { length: 50 }).notNull().references(() => missions.id),
    groupId: varchar('group_id', { length: 50 }).notNull().references(() => groups.id),
    // Untuk misi TERSTRUKTUR ini adalah petugas pos yang memindai, bukan
    // peserta — peserta tidak bisa mencatat kehadirannya sendiri di pos.
    checkedInBy: varchar('checked_in_by', { length: 50 }).notNull().references(() => users.id),
    checkedOutBy: varchar('checked_out_by', { length: 50 }).references(() => users.id),
    // Peserta yang QR-nya dipindai petugas. Menyimpan jejak siapa dari
    // kelompok itu yang benar-benar berdiri di depan pos.
    scannedParticipantId: varchar('scanned_participant_id', { length: 50 }).references(() => users.id),
    // Nomor antrean pos, diisi petugas/peserta saat lapor (MR6: "MENGAMBIL
    // NOMOR ANTRIAN (JIKA ADA ANTRIAN)"). Bebas kosong.
    queueNumber: varchar('queue_number', { length: 20 }),
    checkedInAt: timestamp('checked_in_at', { withTimezone: false }).defaultNow().notNull(),
    checkedOutAt: timestamp('checked_out_at', { withTimezone: false }),
  },
  table => [unique('mission_checkins_mission_group_unique').on(table.missionId, table.groupId)],
);
