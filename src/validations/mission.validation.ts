import { z } from 'zod';

export const createMissionSchema = z.object({
  body: z.object({
    title: z.string().min(3).max(255),
    description: z.string(),
    type: z.enum(['MEDIA', 'MULTIPLE_CHOICE', 'SHORT_ANSWER']),
    isMandatory: z.boolean().default(false),
    pointWeight: z.number().int().min(0),
    sponsorId: z.string().optional(),
    options: z.array(z.object({
      optionText: z.string(),
      isCorrect: z.boolean(),
    })).optional(),
  }),
});

export type CreateMissionInput = z.infer<typeof createMissionSchema>['body'];
