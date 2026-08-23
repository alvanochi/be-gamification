import { eq, asc, inArray, and, isNull } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../../db/index.ts';
import { missions } from '../../db/schema/missions.ts';
import {
  missionQuestions,
  missionQuestionOptions,
  submissionAnswers,
} from '../../db/schema/mission_questions.ts';
import ApiError from '../../utils/ApiError.ts';

export interface QuestionInput {
  questionText: string;
  imageUrl?: string;
  type: 'PILIHAN_GANDA' | 'ISIAN_SINGKAT';
  answerKey?: string;
  point: number;
  options?: Array<{ optionText: string; isCorrect: boolean }>;
}

/** Perbandingan jawaban isian: abaikan besar-kecil huruf dan spasi berlebih. */
const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');

export const replaceQuestions = async (missionId: string, questions: QuestionInput[]) => {
  const mission = await db.select().from(missions).where(eq(missions.id, missionId)).limit(1);
  if (!mission.length) throw ApiError.notFound('Mission not found');

  for (const [index, q] of questions.entries()) {
    if (q.type === 'PILIHAN_GANDA') {
      if (!q.options?.length) {
        throw ApiError.badRequest(`Pertanyaan ke-${index + 1} belum punya pilihan jawaban`);
      }
      if (!q.options.some(o => o.isCorrect)) {
        throw ApiError.badRequest(`Pertanyaan ke-${index + 1} belum punya jawaban benar`);
      }
    } else if (!q.answerKey?.trim()) {
      throw ApiError.badRequest(`Pertanyaan ke-${index + 1} belum punya kunci jawaban`);
    }
  }

  await db.transaction(async (tx: any) => {
    // Ditulis ulang seluruhnya agar panitia bisa menyunting daftar soal tanpa
    // harus melacak mana yang berubah. Jawaban lama tetap tersimpan di
    // submission_answers sebagai riwayat.
    const existing = await tx
      .select({ id: missionQuestions.id })
      .from(missionQuestions)
      // Soal yang ditandai terhapus tidak lagi ditampilkan maupun dinilai; ia
    // hanya bertahan agar jawaban lama tetap punya rujukan.
    .where(and(eq(missionQuestions.missionId, missionId), isNull(missionQuestions.deletedAt)));

    if (existing.length) {
      const ids = existing.map((q: { id: string }) => q.id);

      // Pertanyaan yang sudah pernah dijawab tidak boleh benar-benar dibuang:
      // submission_answers menunjuk padanya, dan riwayat penilaian ikut hilang
      // bila dipaksa. Dulu ini membuat seluruh daftar soal terkunci begitu satu
      // kelompok menjawab — menyunting maupun menghapus sama-sama gagal.
      const answered = await tx
        .selectDistinct({ questionId: submissionAnswers.questionId })
        .from(submissionAnswers)
        .where(inArray(submissionAnswers.questionId, ids));

      const keepIds = answered.map((a: { questionId: string }) => a.questionId);
      const dropIds = ids.filter((id: string) => !keepIds.includes(id));

      if (keepIds.length) {
        await tx
          .update(missionQuestions)
          .set({ deletedAt: new Date() })
          .where(inArray(missionQuestions.id, keepIds));
      }

      if (dropIds.length) {
        await tx.delete(missionQuestionOptions).where(inArray(missionQuestionOptions.questionId, dropIds));
        await tx.delete(missionQuestions).where(inArray(missionQuestions.id, dropIds));
      }
    }

    for (const [index, q] of questions.entries()) {
      const questionId = nanoid(16);
      await tx.insert(missionQuestions).values({
        id: questionId,
        missionId,
        orderNo: index + 1,
        questionText: q.questionText,
        imageUrl: q.imageUrl,
        type: q.type,
        answerKey: q.type === 'ISIAN_SINGKAT' ? q.answerKey : null,
        point: q.point,
      });

      if (q.type === 'PILIHAN_GANDA' && q.options) {
        for (const opt of q.options) {
          await tx.insert(missionQuestionOptions).values({
            id: nanoid(16),
            questionId,
            optionText: opt.optionText,
            isCorrect: opt.isCorrect,
          });
        }
      }
    }
  });

  return { missionId, total: questions.length };
};

/**
 * Daftar pertanyaan.
 * `includeAnswers` hanya boleh true untuk panitia — peserta tidak boleh
 * menerima kunci jawaban maupun penanda pilihan yang benar.
 */
export const getQuestions = async (missionId: string, includeAnswers = false) => {
  const questions = await db
    .select()
    .from(missionQuestions)
    // Soal yang ditandai terhapus tidak lagi ditampilkan maupun dinilai; ia
    // hanya bertahan agar jawaban lama tetap punya rujukan.
    .where(and(eq(missionQuestions.missionId, missionId), isNull(missionQuestions.deletedAt)))
    .orderBy(asc(missionQuestions.orderNo));

  if (!questions.length) return [];

  const options = await db
    .select()
    .from(missionQuestionOptions)
    .where(inArray(missionQuestionOptions.questionId, questions.map(q => q.id)));

  return questions.map(q => ({
    id: q.id,
    orderNo: q.orderNo,
    questionText: q.questionText,
    imageUrl: q.imageUrl,
    type: q.type,
    point: q.point,
    ...(includeAnswers ? { answerKey: q.answerKey } : {}),
    options: options
      .filter(o => o.questionId === q.id)
      .map(o => ({
        id: o.id,
        optionText: o.optionText,
        ...(includeAnswers ? { isCorrect: o.isCorrect } : {}),
      })),
  }));
};

export interface AnswerInput {
  questionId: string;
  selectedOptionId?: string;
  answerText?: string;
}

/**
 * Periksa jawaban kelompok dan hitung poinnya.
 * Dijalankan di server agar kunci jawaban tidak pernah sampai ke peserta.
 */
export const gradeAnswers = async (missionId: string, answers: AnswerInput[]) => {
  const questions = await db
    .select()
    .from(missionQuestions)
    // Soal yang ditandai terhapus tidak lagi ditampilkan maupun dinilai; ia
    // hanya bertahan agar jawaban lama tetap punya rujukan.
    .where(and(eq(missionQuestions.missionId, missionId), isNull(missionQuestions.deletedAt)))
    .orderBy(asc(missionQuestions.orderNo));

  if (!questions.length) throw ApiError.badRequest('Misi ini belum punya pertanyaan');

  const correctOptions = await db
    .select()
    .from(missionQuestionOptions)
    .where(inArray(missionQuestionOptions.questionId, questions.map(q => q.id)));

  let point = 0;
  let correctCount = 0;
  const graded: Array<AnswerInput & { isCorrect: boolean }> = [];

  for (const question of questions) {
    const answer = answers.find(a => a.questionId === question.id);
    let isCorrect = false;

    if (answer) {
      if (question.type === 'PILIHAN_GANDA') {
        isCorrect = correctOptions.some(
          o => o.id === answer.selectedOptionId && o.questionId === question.id && o.isCorrect,
        );
      } else if (answer.answerText && question.answerKey) {
        isCorrect = normalize(answer.answerText) === normalize(question.answerKey);
      }
    }

    if (isCorrect) {
      point += question.point;
      correctCount += 1;
    }

    graded.push({ ...(answer ?? { questionId: question.id }), isCorrect });
  }

  return { point, correctCount, totalQuestions: questions.length, graded };
};

export const saveAnswers = async (
  tx: any,
  submissionId: string,
  graded: Array<AnswerInput & { isCorrect: boolean }>,
) => {
  for (const answer of graded) {
    await tx.insert(submissionAnswers).values({
      id: nanoid(16),
      submissionId,
      questionId: answer.questionId,
      selectedOptionId: answer.selectedOptionId,
      answerText: answer.answerText,
      isCorrect: answer.isCorrect,
    });
  }
};
