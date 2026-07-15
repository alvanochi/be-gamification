import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { eq, and } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../../db/index.ts';
import { submissions } from '../../db/schema/submissions.ts';
import { barterSteps } from '../../db/schema/barter_steps.ts';
import { missions } from '../../db/schema/missions.ts';
import { groups } from '../../db/schema/groups.ts';
import ApiError from '../../utils/ApiError.ts';
import type { SubmitMissionInput } from '../../validations/submission.validation.ts';
import env from '../../config/env.ts';

const s3Client = new S3Client({
  region: 'auto',
  endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: env.R2_SECRET_ACCESS_KEY || '',
  },
});

function getDistanceFromLatLonInM(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371e3; // Radius of the earth in m
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in m
}

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
    publicUrl: `https://${env.R2_PUBLIC_DOMAIN}/${fileKey}`,
  };
};

export const submitMission = async (groupId: string, userId: string, data: SubmitMissionInput) => {
  const mission = await db.select().from(missions).where(eq(missions.id, data.missionId)).limit(1);
  if (!mission.length) throw ApiError.notFound('Mission not found');

  const existing = await db.select()
    .from(submissions)
    .where(and(
      eq(submissions.missionId, data.missionId),
      eq(submissions.groupId, groupId)
    ));

  const hasValidSubmission = existing.some((s: any) => s.status === 'PENDING' || s.status === 'APPROVED');
  if (hasValidSubmission) {
    throw ApiError.badRequest('Mission already submitted or pending validation');
  }

  if (mission[0].type === 'SOAL_LOKASI' && mission[0].geoLat && mission[0].geoLng && mission[0].geoRadius) {
    if (!data.geoLat || !data.geoLng) {
      throw ApiError.badRequest('Misi ini memerlukan koordinat lokasi (GPS)');
    }
    const dist = getDistanceFromLatLonInM(
      parseFloat(data.geoLat), parseFloat(data.geoLng),
      parseFloat(mission[0].geoLat), parseFloat(mission[0].geoLng)
    );
    if (dist > mission[0].geoRadius) {
      throw ApiError.badRequest(`Lokasi Anda terlalu jauh dari target (${Math.round(dist)}m). Radius maksimal: ${mission[0].geoRadius}m`);
    }
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

  await db.transaction(async (tx: any) => {
    await tx.update(submissions)
      .set({
        status,
        validatedBy: validatorId,
        validatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(submissions.id, submissionId));

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

export const submitBarterStep = async (data: any) => {
  const { assignmentId, stepNo, itemFrom, itemTo, partnerName, videoUrl } = data;
  if (!assignmentId || !stepNo || !itemFrom || !itemTo || !videoUrl) {
    throw ApiError.badRequest('Missing required fields for barter step');
  }

  const existingStep = await db.select().from(barterSteps).where(
    and(eq(barterSteps.assignmentId, assignmentId), eq(barterSteps.stepNo, stepNo))
  ).limit(1);

  if (existingStep.length) throw ApiError.badRequest('Barter step already exists');

  const stepId = nanoid(16);
  await db.insert(barterSteps).values({
    id: stepId,
    assignmentId,
    stepNo,
    itemFrom,
    itemTo,
    partnerName,
    videoUrl,
    isValid: true,
  });

  return { id: stepId };
};
