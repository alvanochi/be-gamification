import { eq, and, desc, sql } from 'drizzle-orm';
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
import { gradeAnswers, saveAnswers, getSubmissionAnswers } from '../mission/question.service.ts';
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

  // Satu bukti per kelompok. Yang membacanya peserta di tengah lapangan —
  // biasanya orang kedua yang menekan kirim tanpa tahu temannya sudah
  // mengirim duluan — jadi pesannya menyebut keadaannya, bukan istilah sistem.
  /*
   * Misi berulang melewati larangan ini sepenuhnya.
   *
   * "Cari sepuluh orang bernama Agus" ditemukan satu per satu sepanjang hari.
   * Menahan kiriman kedua sampai yang pertama selesai divalidasi berarti
   * kelompok menunggu panitia di tengah perburuan; menahannya setelah ada yang
   * disetujui berarti sembilan temuan berikutnya tidak pernah bisa masuk.
   *
   * Yang tidak berubah: tiap kiriman tetap divalidasi sendiri dan poinnya
   * tetap lahir dari score_entries-nya masing-masing.
   */
  if (!mission[0].allowMultipleSubmissions) {
    const pendingSubmission = existing.find((s: any) => s.status === 'PENDING');
    if (pendingSubmission) {
      throw ApiError.badRequest(
        'Bukti misi ini sudah dikirim anggota kelompokmu dan sedang menunggu validasi panitia.',
      );
    }
    const approvedSubmission = existing.find((s: any) => s.status === 'APPROVED');
    if (approvedSubmission) {
      throw ApiError.badRequest('Misi ini sudah selesai dan poinnya sudah masuk untuk kelompokmu.');
    }
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

    // Isian singkat dinilai panitia, bukan sistem: pencocokan huruf demi huruf
    // menolak jawaban yang sebenarnya benar. Begitu ada satu saja soal seperti
    // itu, seluruh kirimannya masuk antrean validasi — poin pilihan gandanya
    // ikut ditahan supaya kelompok menerima satu nilai utuh, bukan dua kali.
    const needsReview = result.manualCount > 0;

    const summary = needsReview
      ? `${result.correctCount} dari ${result.choiceCount} pilihan ganda benar · ` +
        `${result.manualCount} isian singkat menunggu penilaian panitia`
      : `${result.correctCount} dari ${result.totalQuestions} jawaban benar`;

    await db.transaction(async (tx: any) => {
      await tx.insert(submissions).values({
        id: submissionId,
        missionId: data.missionId,
        groupId,
        submittedBy: userId,
        answerText: summary,
        status: needsReview ? 'PENDING' : 'APPROVED',
        awardedPoint: needsReview ? null : result.point,
        validatedAt: needsReview ? null : new Date(),
      });

      await saveAnswers(tx, submissionId, result.graded);

      if (!needsReview && result.point > 0) {
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
      autoGraded: !needsReview,
      correctCount: result.correctCount,
      totalQuestions: result.totalQuestions,
      manualCount: result.manualCount,
      point: needsReview ? null : result.point,
    };
  }

  await db.insert(submissions).values({
    id: submissionId,
    missionId: data.missionId,
    groupId,
    submittedBy: userId,
    mediaUrls: data.mediaUrls ?? [],
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
      mediaUrls: submissions.mediaUrls,
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
      // Cara penilaian ikut dikirim. Tanpa ini antrean validasi tidak tahu
      // misinya dinilai per satuan atau per waktu, sehingga tidak menampilkan
      // isian yang diperlukan — lalu server menolak persetujuannya dengan
      // "Mohon isi jumlah hasil…" yang tidak bisa dipenuhi panitia dari layar.
      scoringMode: missions.scoringMode,
      pointPerUnit: missions.pointPerUnit,
      maxUnits: missions.maxUnits,
      timeTargetSeconds: missions.timeTargetSeconds,
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

/**
 * Berapa banyak yang menunggu panitia.
 *
 * Dipakai lencana angka di navigasi panel: tanpa itu panitia harus membuka
 * halaman validasi untuk tahu apakah ada yang perlu dikerjakan, dan bukti yang
 * masuk saat mereka sedang di layar lain tidak terlihat sama sekali.
 */
export const getPendingCounts = async () => {
  const [{ submissionCount, barterCount }] = (await db.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM submissions WHERE status = 'PENDING')::int  AS "submissionCount",
      (SELECT COUNT(*) FROM barter_steps WHERE status = 'PENDING')::int AS "barterCount"
  `)).rows as Array<{ submissionCount: number; barterCount: number }>;

  return {
    submissions: Number(submissionCount),
    barterSteps: Number(barterCount),
    total: Number(submissionCount) + Number(barterCount),
  };
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

    if (mission.type === 'KUIS') {
      // Poin pilihan gandanya sudah dihitung sistem dan ditampilkan sebagai
      // usulan di layar panitia; yang mengikat tetap angka yang mereka kirim.
      pointsToAward = scoring.awardedPoint ?? 0;
    } else if (mission.isYelYel) {
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

/**
 * Nilai otomatis dari pilihan ganda pada sebuah submission kuis.
 *
 * Dipakai sebagai usulan angka di layar validasi: panitia tinggal menambahkan
 * penilaian isian singkatnya, bukan menghitung ulang semuanya dari awal.
 */
export const getQuizReview = async (submissionId: string) => {
  const answers = await getSubmissionAnswers(submissionId);

  const autoPoint = answers
    .filter(a => a.type === 'PILIHAN_GANDA' && a.isCorrect)
    .reduce((sum, a) => sum + a.point, 0);

  const manualPoint = answers
    .filter(a => a.type === 'ISIAN_SINGKAT')
    .reduce((sum, a) => sum + a.point, 0);

  return { answers, autoPoint, manualPoint, maxPoint: autoPoint + manualPoint };
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

  // Rantai yang sudah ditutup panitia — diakhiri dengan nilai akhir, atau
  // dihentikan karena pertukarannya ditolak — tidak menerima langkah baru.
  if (assignment[0].status === 'ACCEPTED' || assignment[0].status === 'REJECTED') {
    throw ApiError.badRequest('Rantai barter kelompok ini sudah diakhiri panitia');
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
