import { eq, and, desc } from 'drizzle-orm';
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
import { recalculateGroupScore } from '../../utils/groupScore.ts';
import { assertCheckedIn } from '../../utils/attendance.ts';
import { getGatekeeperStatus } from '../mission/mission.service.ts';
import { gradeAnswers, saveAnswers } from '../mission/question.service.ts';
import { calculateMissionPoint } from '../../utils/scoring.ts';
import { calculateYelYelPoint, isYelYelExpired } from '../../utils/yelYel.ts';
import { getSettings } from '../settings/settings.service.ts';
import { broadcastToGroup } from '../../realtime/hub.ts';
import type { SubmitMissionInput } from '../../validations/submission.validation.ts';

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

export const getSubmissionsByGroup = async (groupId: string) => {
  return await db.select().from(submissions).where(eq(submissions.groupId, groupId));
};

export const submitMission = async (groupId: string, userId: string, data: SubmitMissionInput) => {
  await assertCheckedIn(userId);

  const settings = await getSettings();

  const mission = await db.select().from(missions).where(eq(missions.id, data.missionId)).limit(1);
  if (!mission.length) throw ApiError.notFound('Mission not found');

  // Yel-yel berdiri di luar antrean misi biasa: ia bagian dari rangkaian
  // checkpoint, dikerjakan sebelum perlombaan dibuka, dan karena itu tidak
  // tunduk pada gerbang rilis maupun urutan misi wajib. Yang mengikatnya
  // hanyalah tenggatnya sendiri.
  const isYelYel = mission[0].isYelYel;

  if (isYelYel) {
    const [group] = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1);
    if (group && isYelYelExpired(group.nameSetAt, settings.yelYelDeadlineHours)) {
      throw ApiError.badRequest('Batas waktu pengumpulan yel-yel sudah lewat.');
    }
  }

  // Sama seperti daftar misi: sebelum panitia mengumumkan mulai, tidak ada
  // yang boleh dikirim — termasuk lewat pemanggilan endpoint langsung.
  if (!isYelYel && !settings.missionsReleased) {
    throw ApiError.badRequest('Misi belum dibuka panitia. Tunggu pengumuman dimulainya acara.');
  }

  // BR-04 time box harian dan sesi per-misi dari MR6.
  assertWithinEventWindow();
  assertWithinMissionSession(mission[0].sessionStart, mission[0].sessionEnd);

  // BR-02 — gerbang wajib ditegakkan di sini, bukan hanya saat membaca daftar
  // misi. Tanpa ini, memanggil endpoint langsung sudah cukup untuk melewatinya.
  if (!mission[0].isMandatory && !isYelYel) {
    const { passed } = await getGatekeeperStatus(groupId);
    if (!passed) {
      throw ApiError.badRequest('Selesaikan misi wajib terlebih dahulu sebelum mengerjakan misi lain');
    }
  }

  // Misi bertahap: tahap lanjutan hanya terbuka setelah tahap sebelumnya
  // disetujui. Ditegakkan di sini, bukan hanya saat daftar misi dibaca.
  if (mission[0].prerequisiteId) {
    const [prereq] = await db.select().from(submissions).where(and(
      eq(submissions.missionId, mission[0].prerequisiteId),
      eq(submissions.groupId, groupId),
      eq(submissions.status, 'APPROVED'),
    )).limit(1);
    if (!prereq) {
      throw ApiError.badRequest('Selesaikan tahap sebelumnya terlebih dahulu');
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

  // Misi kuis diperiksa dan diberi nilai saat itu juga — tidak perlu antre di
  // meja panitia, karena kunci jawabannya sudah pasti.
  if (mission[0].type === 'KUIS') {
    if (!data.answers?.length) {
      throw ApiError.badRequest('Jawaban pertanyaan wajib diisi');
    }

    const result = await gradeAnswers(data.missionId, data.answers);

    await db.transaction(async (tx: any) => {
      await tx.insert(submissions).values({
        id: submissionId,
        missionId: data.missionId,
        groupId,
        submittedBy: userId,
        answerText: `${result.correctCount} dari ${result.totalQuestions} jawaban benar`,
        status: 'APPROVED',
        awardedPoint: result.point,
        validatedAt: new Date(),
      });

      await saveAnswers(tx, submissionId, result.graded);

      if (result.point > 0) {
        await tx.insert(scoreEntries).values({
          id: nanoid(16),
          groupId,
          source: 'CHALLENGE',
          referenceId: submissionId,
          point: result.point,
          createdBy: userId,
        });
        await recalculateGroupScore(tx, groupId);
      }
    });

    return {
      id: submissionId,
      autoGraded: true,
      correctCount: result.correctCount,
      totalQuestions: result.totalQuestions,
      point: result.point,
    };
  }

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
  scoring: { awardedPoint?: number; units?: number; timeSeconds?: number } = {},
  rejectReason?: string,
) => {
  const submission = await db.select().from(submissions).where(eq(submissions.id, submissionId)).limit(1);
  if (!submission.length) throw ApiError.notFound('Submission not found');
  if (submission[0].status !== 'PENDING') throw ApiError.badRequest('Submission already validated');

  // Poin dihitung sesuai cara penilaian misi — tetap, rentang, per satuan,
  // atau berbasis waktu (lihat utils/scoring.ts).
  let pointsToAward = 0;
  if (status === 'APPROVED') {
    const missionRows = await db.select().from(missions)
      .where(eq(missions.id, submission[0].missionId)).limit(1);
    const mission = missionRows[0];
    if (!mission) throw ApiError.notFound('Mission not found');

    if (mission.isYelYel) {
      // Yel-yel tidak dinilai dari konfigurasi misi, melainkan dari kapan
      // kelompok mengerjakannya: langsung di checkpoint, ditunda, atau
      // terlambat sama sekali.
      const [group] = await db.select().from(groups).where(eq(groups.id, submission[0].groupId)).limit(1);
      const settings = await getSettings();
      pointsToAward = group ? calculateYelYelPoint(group, settings) : 0;
    } else {
      pointsToAward = calculateMissionPoint(mission, scoring);
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
        // score_entries adalah sumber kebenaran; groups.score diturunkan darinya.
        await tx.insert(scoreEntries).values({
          id: nanoid(16),
          groupId: submission[0].groupId,
          source: 'CHALLENGE',
          referenceId: submissionId,
          point: points,
          createdBy: validatorId,
        });

        await recalculateGroupScore(tx, submission[0].groupId);
      }
    }
  });

  // Kabari kelompoknya seketika. Sebelumnya satu-satunya siaran adalah
  // perubahan klasemen, dan itu pun hanya bila poinnya lebih dari nol —
  // sehingga penolakan tidak pernah sampai ke peserta, dan mereka menunggu
  // di depan layar yang tidak berubah.
  const [mission] = await db.select({ title: missions.title })
    .from(missions).where(eq(missions.id, submission[0].missionId)).limit(1);

  broadcastToGroup(submission[0].groupId, 'submission:validated', {
    submissionId,
    missionId: submission[0].missionId,
    missionTitle: mission?.title ?? 'Misi',
    status,
    point: status === 'APPROVED' ? pointsToAward : null,
    rejectReason: status === 'REJECTED' ? (rejectReason ?? null) : null,
  });
};

export const getBarterSteps = async (groupId: string, assignmentId: string) => {
  const assignment = await db.select().from(assignments)
    .where(eq(assignments.id, assignmentId)).limit(1);
  if (!assignment.length) throw ApiError.notFound('Assignment not found');
  if (assignment[0].groupId !== groupId) {
    throw ApiError.forbidden('Assignment ini bukan milik kelompok Anda');
  }

  return await db.select().from(barterSteps)
    .where(eq(barterSteps.assignmentId, assignmentId))
    .orderBy(barterSteps.stepNo);
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

  // Alur MR6: tukar → kirim bukti → tunggu validasi → disetujui → tukar lagi.
  // Selama masih ada langkah yang menunggu atau ditolak, kelompok belum boleh
  // menukar berikutnya.
  const previous = await db.select().from(barterSteps)
    .where(eq(barterSteps.assignmentId, assignmentId))
    .orderBy(desc(barterSteps.stepNo)).limit(1);

  if (previous.length) {
    if (previous[0].status === 'PENDING') {
      throw ApiError.badRequest('Pertukaran sebelumnya masih menunggu validasi panitia');
    }
    if (previous[0].status === 'REJECTED') {
      throw ApiError.badRequest('Pertukaran sebelumnya ditolak — perbaiki dan kirim ulang');
    }
  }

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
