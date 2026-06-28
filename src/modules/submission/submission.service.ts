import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { eq, and } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../../db/index.ts';
import { submissions } from '../../db/schema/submissions.ts';
import { missions } from '../../db/schema/missions.ts';
import { groups } from '../../db/schema/groups.ts';
import ApiError from '../../utils/ApiError.ts';
import type { SubmitMissionInput } from '../../validations/submission.validation.ts';
import env from '../../config/env.ts';

// Configured for Cloudflare R2
const s3Client = new S3Client({
  region: 'auto',
  endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: env.R2_SECRET_ACCESS_KEY || '',
  },
});

export const generatePresignedUrl = async (fileName: string, mimeType: string) => {
  const fileKey = `uploads/${nanoid(8)}-${fileName}`;
  const command = new PutObjectCommand({
    Bucket: env.R2_BUCKET_NAME || 'gamification-bucket',
    Key: fileKey,
    ContentType: mimeType,
  });

  const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
  return {
    uploadUrl: presignedUrl,
    fileKey,
    publicUrl: `https://${env.R2_PUBLIC_DOMAIN}/${fileKey}`, // Adjust based on R2 config
  };
};

export const submitMission = async (groupId: string, userId: string, data: SubmitMissionInput) => {
  const mission = await db.select().from(missions).where(eq(missions.id, data.missionId)).limit(1);
  if (!mission.length) throw ApiError.notFound('Mission not found');

  // Check if already submitted and pending or approved
  const existing = await db.select()
    .from(submissions)
    .where(and(
      eq(submissions.missionId, data.missionId),
      eq(submissions.groupId, groupId)
    ));
    
  const hasValidSubmission = existing.some(s => s.status === 'PENDING' || s.status === 'APPROVED');
  if (hasValidSubmission) {
    throw ApiError.badRequest('Mission already submitted or pending validation');
  }

  const submissionId = nanoid(16);
  await db.insert(submissions).values({
    id: submissionId,
    missionId: data.missionId,
    groupId,
    submittedBy: userId,
    mediaUrl: data.mediaUrl,
    answerText: data.answerText,
    selectedOptionId: data.selectedOptionId,
    status: 'PENDING',
  });

  return { id: submissionId };
};

export const validateSubmission = async (submissionId: string, status: 'APPROVED' | 'REJECTED', validatorId: string) => {
  const submission = await db.select().from(submissions).where(eq(submissions.id, submissionId)).limit(1);
  if (!submission.length) throw ApiError.notFound('Submission not found');
  if (submission[0].status !== 'PENDING') throw ApiError.badRequest('Submission already validated');

  await db.transaction(async (tx) => {
    // Update submission
    await tx.update(submissions)
      .set({
        status,
        validatedBy: validatorId,
        validatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(submissions.id, submissionId));

    // Add points if approved
    if (status === 'APPROVED') {
      const mission = await tx.select().from(missions).where(eq(missions.id, submission[0].missionId)).limit(1);
      const points = mission[0]?.pointWeight || 0;

      if (points > 0) {
        const group = await tx.select().from(groups).where(eq(groups.id, submission[0].groupId)).limit(1);
        const currentScore = group[0]?.score || 0;

        await tx.update(groups)
          .set({ score: currentScore + points, updatedAt: new Date() })
          .where(eq(groups.id, submission[0].groupId));
      }
    }
  });
};
