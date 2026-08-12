import { z } from 'zod';

export const submitMissionSchema = z.object({
  body: z.object({
    missionId: z.string(),
    mediaUrl: z.string().url().optional(),
    answerText: z.string().optional(),
    selectedOptionId: z.string().optional(),
    geoLat: z.string().optional(),
    geoLng: z.string().optional(),
  }).refine((data: any) => {
    return data.mediaUrl || data.answerText || data.selectedOptionId;
  }, {
    message: "Must provide at least one form of proof (mediaUrl, answerText, or selectedOptionId)",
  }),
});

export const validateSubmissionSchema = z.object({
  body: z.object({
    status: z.enum(['APPROVED', 'REJECTED']),
    // Wajib diisi untuk misi berentang nilai (MR6), diabaikan saat REJECTED.
    awardedPoint: z.number().int().min(0).optional(),
    rejectReason: z.string().max(500).optional(),
  }),
});

export type SubmitMissionInput = z.infer<typeof submitMissionSchema>['body'];
export type ValidateSubmissionInput = z.infer<typeof validateSubmissionSchema>['body'];
