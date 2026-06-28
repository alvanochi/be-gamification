import { z } from 'zod';

export const updateGroupNameSchema = z.object({
  body: z.object({
    name: z.string().min(3).max(255),
  }),
});

export const voteLeaderSchema = z.object({
  body: z.object({
    nomineeId: z.string(),
  }),
});

export type UpdateGroupNameInput = z.infer<typeof updateGroupNameSchema>['body'];
export type VoteLeaderInput = z.infer<typeof voteLeaderSchema>['body'];
