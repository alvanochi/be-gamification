import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { eq, and } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../../db/index.ts';
import { submissions } from '../../db/schema/submissions.ts';
import { barterSteps } from '../../db/schema/barter_steps.ts';
import { missions } from '../../db/schema/missions.ts';
import { groups } from '../../db/schema/groups.ts';
import { scoreEntries } from '../../db/schema/score_entries.ts';
import { users } from '../../db/schema/users.ts';
import { missionCheckins } from '../../db/schema/mission_checkins.ts';
import { assignments } from '../../db/schema/assignments.ts';
import ApiError from '../../utils/ApiError.ts';
import { assertWithinEventWindow, assertWithinMissionSession } from '../../utils/eventTime.ts';
import { getGatekeeperStatus } from '../mission/mission.service.ts';
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

export const getSubmissionsByGroup = async (groupId: string) => {
  return await db.select().from(submissions).where(eq(submissions.groupId, groupId));
};

export const submitMission = async (groupId: string, userId: string, data: SubmitMissionInput) => {
  const mission = await db.select().from(missions).where(eq(missions.id, data.missionId)).limit(1);
  if (!mission.length) throw ApiError.notFound('Mission not found');

  // BR-04 time box harian dan sesi per-misi dari MR6.
  assertWithinEventWindow();
  assertWithinMissionSession(mission[0].sessionStart, mission[0].sessionEnd);

  // BR-02 — gerbang wajib ditegakkan di sini, bukan hanya saat membaca daftar
  // misi. Tanpa ini, memanggil endpoint langsung sudah cukup untuk melewatinya.
  if (!mission[0].isMandatory) {
    const { passed } = await getGatekeeperStatus(groupId);
    if (!passed) {
      throw ApiError.badRequest('Selesaikan misi wajib terlebih dahulu sebelum mengerjakan misi lain');
    }
  }

  // MR6: misi TERSTRUKTUR mewajibkan lapor ke petugas pos lewat check-in online.
  if (mission[0].requiresCheckIn) {
    const checkIn = await db.select().from(missionCheckins).where(and(
      eq(missionCheckins.missionId, data.missionId),
      eq(missionCheckins.groupId, groupId),
    )).limit(1);
    if (!checkIn.length) {
      throw ApiError.badRequest('Lakukan check-in di lokasi misi terlebih dahulu');
    }
  }

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

export const getPendingSubmissions = async () => {
  return await db
    .select({
      id: submissions.id,
      status: submissions.status,
      mediaUrl: submissions.mediaUrl,
      answerText: submissions.answerText,
      createdAt: submissions.createdAt,
      missionId: missions.id,
      missionTitle: missions.title,
      missionType: missions.type,
      pointWeight: missions.pointWeight,
      // Dikirim agar antrean validasi tahu kapan harus menampilkan input nilai
      // (misi berentang) dan bukti seperti apa yang seharusnya dikirim peserta.
      pointMin: missions.pointMin,
      pointMax: missions.pointMax,
      proofType: missions.proofType,
      missionCategory: missions.category,
      locationName: missions.locationName,
      groupId: groups.id,
      groupName: groups.name,
      submittedById: users.id,
      submittedByName: users.fullname,
    })
    .from(submissions)
    .innerJoin(missions, eq(submissions.missionId, missions.id))
    .innerJoin(groups, eq(submissions.groupId, groups.id))
    .innerJoin(users, eq(submissions.submittedBy, users.id))
    .where(eq(submissions.status, 'PENDING'))
    .orderBy(submissions.createdAt);
};

export const validateSubmission = async (
  submissionId: string,
  status: 'APPROVED' | 'REJECTED',
  validatorId: string,
  awardedPoint?: number,
  rejectReason?: string,
) => {
  const submission = await db.select().from(submissions).where(eq(submissions.id, submissionId)).limit(1);
  if (!submission.length) throw ApiError.notFound('Submission not found');
  if (submission[0].status !== 'PENDING') throw ApiError.badRequest('Submission already validated');

  // Penilaian rentang MR6 (mis. "50 - 100 POIN"): jika misi punya rentang,
  // panitia wajib menentukan nilainya sendiri di dalam rentang tersebut.
  // Tanpa rentang, nilai tetap diambil dari pointWeight seperti sebelumnya.
  let pointsToAward = 0;
  if (status === 'APPROVED') {
    const missionRows = await db.select().from(missions)
      .where(eq(missions.id, submission[0].missionId)).limit(1);
    const mission = missionRows[0];
    const hasRange = mission?.pointMin != null && mission?.pointMax != null;

    if (hasRange) {
      if (awardedPoint === undefined) {
        throw ApiError.badRequest(
          `Misi ini dinilai dalam rentang ${mission.pointMin} - ${mission.pointMax} poin. Mohon isi nilainya.`,
        );
      }
      if (awardedPoint < mission.pointMin! || awardedPoint > mission.pointMax!) {
        throw ApiError.badRequest(
          `Nilai harus di antara ${mission.pointMin} dan ${mission.pointMax} poin.`,
        );
      }
      pointsToAward = awardedPoint;
    } else {
      pointsToAward = awardedPoint ?? mission?.pointWeight ?? 0;
    }
  }

  await db.transaction(async (tx: any) => {
    await tx.update(submissions)
      .set({
        status,
        awardedPoint: status === 'APPROVED' ? pointsToAward : null,
        rejectReason: status === 'REJECTED' ? (rejectReason ?? null) : null,
        validatedBy: validatorId,
        validatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(submissions.id, submissionId));

    if (status === 'APPROVED') {
      const points = pointsToAward;

      if (points > 0) {
        // The leaderboard and CSV export both sum score_entries, not groups.score —
        // writing only to groups.score (as this used to do) meant approved mission
        // points silently never appeared on the leaderboard.
        await tx.insert(scoreEntries).values({
          id: nanoid(16),
          groupId: submission[0].groupId,
          source: 'CHALLENGE',
          referenceId: submissionId,
          point: points,
          createdBy: validatorId,
        });

        const group = await tx.select().from(groups).where(eq(groups.id, submission[0].groupId)).limit(1);
        const currentScore = group[0]?.score || 0;

        await tx.update(groups)
          .set({ score: currentScore + points, updatedAt: new Date() })
          .where(eq(groups.id, submission[0].groupId));
      }
    }
  });
};

export const submitBarterStep = async (groupId: string, data: any) => {
  const { assignmentId, stepNo, itemFrom, itemTo, partnerName, videoUrl } = data;
  if (!assignmentId || !stepNo || !itemFrom || !itemTo || !videoUrl) {
    throw ApiError.badRequest('Missing required fields for barter step');
  }

  // Tanpa cek ini, peserta mana pun bisa menyisipkan langkah barter ke rantai
  // milik kelompok lain — cukup dengan menebak/melihat assignmentId-nya.
  const assignment = await db.select().from(assignments)
    .where(eq(assignments.id, assignmentId)).limit(1);
  if (!assignment.length) throw ApiError.notFound('Assignment not found');
  if (assignment[0].groupId !== groupId) {
    throw ApiError.forbidden('Assignment ini bukan milik kelompok Anda');
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
