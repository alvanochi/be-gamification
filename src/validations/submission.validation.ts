import { z } from 'zod';

export const submitMissionSchema = z.object({
  body: z.object({
    missionId: z.string(),
    mediaUrl: z.string().url().optional(),
    answerText: z.string().optional(),
    selectedOptionId: z.string().optional(),
    geoLat: z.string().optional(),
    geoLng: z.string().optional(),
    // Jawaban misi kuis — diperiksa server, bukan dikirim sudah dinilai.
    answers: z
      .array(
        z.object({
          questionId: z.string(),
          selectedOptionId: z.string().optional(),
          answerText: z.string().optional(),
        }),
      )
      .optional(),
  }).refine((data: any) => {
    return data.mediaUrl || data.answerText || data.selectedOptionId || data.answers?.length;
  }, {
    message: "Bukti wajib diisi (media, jawaban teks, atau jawaban pertanyaan)",
  }),
});

export const validateSubmissionSchema = z.object({
  body: z.object({
    status: z.enum(['APPROVED', 'REJECTED']),
    // Diabaikan saat REJECTED. Mana yang dipakai bergantung cara penilaian misi:
    // awardedPoint untuk rentang, units untuk per-satuan, timeSeconds untuk waktu.
    awardedPoint: z.number().int().min(0).optional(),
    units: z.number().int().min(0).optional(),
    timeSeconds: z.number().int().min(1).optional(),
    rejectReason: z.string().max(500).optional(),
  }),
});

export type SubmitMissionInput = z.infer<typeof submitMissionSchema>['body'];
export type ValidateSubmissionInput = z.infer<typeof validateSubmissionSchema>['body'];
