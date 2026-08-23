import { pgTable, varchar, text, integer, boolean, timestamp } from 'drizzle-orm/pg-core';
import { missions, questionTypeEnum } from './missions.ts';
import { submissions } from './submissions.ts';

/**
 * Pertanyaan di dalam sebuah misi — menutup jenis tugas "JAWAB PERTANYAAN" dan
 * "BUTUH GEOTAG UNTUK MENJAWAB PERTANYAAN" di MR6, sekaligus kebutuhan BRD
 * FR-05 (pilihan ganda & isian singkat).
 *
 * Contoh nyata: Great Tabib meminta peserta menyebutkan nama tanaman herbal
 * dari foto yang ditampilkan — karena itu ada `imageUrl` per pertanyaan.
 */
export const missionQuestions = pgTable('mission_questions', {
  id: varchar('id', { length: 50 }).primaryKey(),
  missionId: varchar('mission_id', { length: 50 }).notNull().references(() => missions.id),
  orderNo: integer('order_no').default(1).notNull(),
  questionText: text('question_text').notNull(),
  // Foto pendukung soal (mis. foto tanaman yang harus dikenali).
  imageUrl: varchar('image_url', { length: 1024 }),
  type: questionTypeEnum('type').default('PILIHAN_GANDA').notNull(),
  // Kunci jawaban untuk ISIAN_SINGKAT. Dibandingkan tanpa membedakan
  // besar-kecil huruf dan spasi berlebih.
  answerKey: varchar('answer_key', { length: 255 }),
  point: integer('point').default(10).notNull(),
  createdAt: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  /** Terisi berarti pertanyaan ini disembunyikan; jawaban lamanya tetap ada. */
  deletedAt: timestamp('deleted_at', { withTimezone: false }),
});

// Ditandai terhapus, bukan dibuang, ketika sudah pernah dijawab peserta —
// jawaban lama tetap dibutuhkan sebagai riwayat penilaian.
export const missionQuestionOptions = pgTable('mission_question_options', {
  id: varchar('id', { length: 50 }).primaryKey(),
  questionId: varchar('question_id', { length: 50 })
    .notNull()
    .references(() => missionQuestions.id, { onDelete: 'cascade' }),
  optionText: varchar('option_text', { length: 500 }).notNull(),
  isCorrect: boolean('is_correct').default(false).notNull(),
});

/** Jawaban yang dikirim kelompok, beserta hasil pemeriksaannya. */
export const submissionAnswers = pgTable('submission_answers', {
  id: varchar('id', { length: 50 }).primaryKey(),
  submissionId: varchar('submission_id', { length: 50 })
    .notNull()
    .references(() => submissions.id, { onDelete: 'cascade' }),
  questionId: varchar('question_id', { length: 50 }).notNull().references(() => missionQuestions.id),
  selectedOptionId: varchar('selected_option_id', { length: 50 }),
  answerText: text('answer_text'),
  isCorrect: boolean('is_correct').default(false).notNull(),
});
