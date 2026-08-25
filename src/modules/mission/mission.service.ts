import { eq, and, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../../db/index.ts';
import { missions } from '../../db/schema/missions.ts';
import { submissions } from '../../db/schema/submissions.ts';
import { assignments } from '../../db/schema/assignments.ts';
import { missionCheckins } from '../../db/schema/mission_checkins.ts';
import ApiError from '../../utils/ApiError.ts';
import { assertWithinEventWindow, assertWithinMissionSession } from '../../utils/eventTime.ts';
import { assertCheckedIn } from '../../utils/attendance.ts';
import { getSettings } from '../settings/settings.service.ts';
import type { CreateMissionInput } from '../../validations/mission.validation.ts';

/**
 * Yel-yel hanya boleh satu.
 *
 * Rangkaian checkpoint menampilkan tepat satu misi yel-yel, jadi menandai misi
 * baru sebagai yel-yel otomatis melepas penanda dari misi sebelumnya —
 * daripada membiarkan dua misi bersaing memperebutkan tempat yang sama.
 */
const clearOtherYelYel = async (keepId: string) => {
  await db.update(missions)
    .set({ isYelYel: false, updatedAt: new Date() })
    .where(sql`${missions.isYelYel} = TRUE AND ${missions.id} <> ${keepId}`);
};

export const createMission = async (data: CreateMissionInput) => {
  const missionId = nanoid(16);

  await db.insert(missions).values({
    id: missionId,
    title: data.title,
    description: data.description,
    type: data.type,
    isMandatory: data.isMandatory,
    pointWeight: data.pointWeight,
    sponsorId: data.sponsorId,
    openAt: data.openAt ? new Date(data.openAt) : undefined,
    prerequisiteId: data.prerequisiteId,
    participantCount: data.participantCount,
    geoLat: data.geoLat,
    geoLng: data.geoLng,
    geoRadius: data.geoRadius,
    pointRules: data.pointRules,
    category: data.category,
    clueType: data.clueType,
    clue: data.clue,
    locationName: data.locationName,
    sessionStart: data.sessionStart,
    sessionEnd: data.sessionEnd,
    durationMinutes: data.durationMinutes,
    proofType: data.proofType,
    pointMin: data.pointMin,
    pointMax: data.pointMax,
    requiresCheckIn: data.requiresCheckIn,
    isYelYel: data.isYelYel,
    equipment: data.equipment,
    scoringMode: data.scoringMode,
    pointPerUnit: data.pointPerUnit,
    maxUnits: data.maxUnits,
    timeTargetSeconds: data.timeTargetSeconds,
  });

  if (data.isYelYel) await clearOtherYelYel(missionId);

  return { id: missionId };
};

export const getAllMissions = async () => {
  return await db.select().from(missions);
};

export const updateMission = async (missionId: string, data: Partial<CreateMissionInput>) => {
  const existing = await db.select().from(missions).where(eq(missions.id, missionId)).limit(1);
  if (!existing.length) throw ApiError.notFound('Mission not found');

  if (data.prerequisiteId === missionId) {
    throw ApiError.badRequest('Misi tidak boleh menjadi prasyarat bagi dirinya sendiri');
  }

  const { openAt, ...rest } = data;
  await db.update(missions)
    .set({
      ...rest,
      ...(openAt !== undefined ? { openAt: openAt ? new Date(openAt) : null } : {}),
      updatedAt: new Date(),
    })
    .where(eq(missions.id, missionId));

  if (data.isYelYel) await clearOtherYelYel(missionId);

  return { id: missionId };
};

export const deleteMission = async (missionId: string) => {
  const existing = await db.select().from(missions).where(eq(missions.id, missionId)).limit(1);
  if (!existing.length) throw ApiError.notFound('Mission not found');

  // Menghapus misi yang sudah dikerjakan akan menghilangkan jejak penilaian dan
  // melanggar foreign key dari submissions/assignments — tolak dengan jelas.
  const [usedBySubmission] = await db.select({ id: submissions.id })
    .from(submissions).where(eq(submissions.missionId, missionId)).limit(1);
  if (usedBySubmission) {
    throw ApiError.conflict('Misi ini sudah punya submission dari peserta, tidak bisa dihapus');
  }

  const [usedByAssignment] = await db.select({ id: assignments.id })
    .from(assignments).where(eq(assignments.missionId, missionId)).limit(1);
  if (usedByAssignment) {
    throw ApiError.conflict('Misi ini sudah di-assign ke kelompok, tidak bisa dihapus');
  }

  const [usedAsPrerequisite] = await db.select({ title: missions.title })
    .from(missions).where(eq(missions.prerequisiteId, missionId)).limit(1);
  if (usedAsPrerequisite) {
    throw ApiError.conflict(`Misi ini masih menjadi prasyarat "${usedAsPrerequisite.title}"`);
  }

  await db.delete(missionCheckins).where(eq(missionCheckins.missionId, missionId));
  await db.delete(missions).where(eq(missions.id, missionId));
};

/**
 * BR-02 — misi lanjutan terkunci sampai misi wajib pertama disetujui.
 *
 * Dipakai bersama oleh daftar misi *dan* endpoint submit. Sebelumnya aturan ini
 * hanya diterapkan saat membaca daftar, sehingga peserta bisa melewati gerbang
 * dengan memanggil POST /submissions langsung.
 */
export const getGatekeeperStatus = async (groupId: string) => {
  // Urutan dipastikan berdasarkan waktu pembuatan. Tanpa ini, ketika ada lebih
  // dari satu misi wajib, misi mana yang menjadi gerbang bergantung pada urutan
  // baris yang dikembalikan database — bisa berubah-ubah.
  const mandatoryMissions = await db.select().from(missions)
    .where(eq(missions.isMandatory, true))
    .orderBy(missions.createdAt);

  if (mandatoryMissions.length === 0) {
    return { passed: true, mandatoryMissions, gatekeeperMission: null };
  }

  const gatekeeperMission = mandatoryMissions[0];
  const submission = await db.select()
    .from(submissions)
    .where(and(
      eq(submissions.missionId, gatekeeperMission.id),
      eq(submissions.groupId, groupId),
      eq(submissions.status, 'APPROVED')
    ))
    .limit(1);

  return { passed: submission.length > 0, mandatoryMissions, gatekeeperMission };
};

/** Misi yang prasyaratnya sudah disetujui untuk kelompok ini. */
const filterByPrerequisite = async (groupId: string, list: typeof missions.$inferSelect[]) => {
  const withPrereq = list.filter(m => m.prerequisiteId);
  if (!withPrereq.length) return list;

  const approved = await db
    .select({ missionId: submissions.missionId })
    .from(submissions)
    .where(and(eq(submissions.groupId, groupId), eq(submissions.status, 'APPROVED')));

  const approvedIds = new Set(approved.map(s => s.missionId));

  // Misi bertahap (mis. Great Tabib: jawab pertanyaan dulu, baru tantangan
  // kedua) dimodelkan lewat prerequisiteId. Tahap lanjutan disembunyikan
  // sampai tahap sebelumnya disetujui.
  return list.filter(m => !m.prerequisiteId || approvedIds.has(m.prerequisiteId));
};

export const getAvailableMissions = async (groupId: string) => {
  const settings = await getSettings();

  // Yel-yel berdiri di luar gerbang rilis dan gerbang misi wajib: kelompok
  // yang melewatinya di checkpoint harus tetap punya tempat untuk mengirim
  // buktinya sebelum tenggat habis.
  const [yelYel] = await db.select().from(missions).where(eq(missions.isYelYel, true)).limit(1);
  const withYelYel = (list: typeof missions.$inferSelect[]) =>
    yelYel && !list.some(m => m.id === yelYel.id) ? [yelYel, ...list] : list;

  // Peserta dikumpulkan dan dibriefing lebih dulu; daftar misi baru terbuka
  // setelah panitia menekan "Munculkan Misi".
  if (!settings.missionsReleased) return withYelYel([]);

  const { passed, mandatoryMissions } = await getGatekeeperStatus(groupId);

  if (!passed) {
    return withYelYel(mandatoryMissions);
  }

  const allMissions = await db.select().from(missions);
  return withYelYel(await filterByPrerequisite(groupId, allMissions));
};

export const assignMission = async (missionId: string, groupId: string, assigneeUserId?: string) => {
  const mission = await db.select().from(missions).where(eq(missions.id, missionId)).limit(1);
  if (!mission.length) throw ApiError.notFound('Mission not found');

  if (mission[0].openAt && new Date() < new Date(mission[0].openAt)) {
    throw ApiError.badRequest('This mission is not open yet');
  }

  if (mission[0].prerequisiteId) {
    const prereqSubmission = await db.select()
      .from(submissions)
      .where(and(
        eq(submissions.missionId, mission[0].prerequisiteId),
        eq(submissions.groupId, groupId),
        eq(submissions.status, 'APPROVED')
      )).limit(1);
    if (!prereqSubmission.length) {
      throw ApiError.badRequest('Prerequisite mission is not completed');
    }
  }

  const existingAssignment = await db.select().from(assignments).where(
    and(eq(assignments.missionId, missionId), eq(assignments.groupId, groupId))
  ).limit(1);
  if (existingAssignment.length) throw ApiError.badRequest('Mission is already assigned for this group');

  const assignmentId = nanoid(16);
  await db.insert(assignments).values({
    id: assignmentId,
    missionId,
    groupId,
    assigneeUserId,
    status: 'TODO',
  });

  return { assignmentId };
};

export const getAssignmentsByGroup = async (groupId: string) => {
  return await db.select().from(assignments).where(eq(assignments.groupId, groupId));
};

// --- Check-in / check-out per misi (MR6) ---

export const getCheckIn = async (missionId: string, groupId: string) => {
  const rows = await db.select().from(missionCheckins).where(
    and(eq(missionCheckins.missionId, missionId), eq(missionCheckins.groupId, groupId))
  ).limit(1);
  return rows[0] ?? null;
};

export const checkInMission = async (
  missionId: string,
  groupId: string,
  userId: string,
  scannedParticipantId?: string,
) => {
  await assertCheckedIn(userId);

  const mission = await db.select().from(missions).where(eq(missions.id, missionId)).limit(1);
  if (!mission.length) throw ApiError.notFound('Mission not found');

  // Pos berpetugas dicatat lewat pemindaian QR oleh petugas, bukan oleh
  // peserta dari ponselnya sendiri. `scannedParticipantId` hanya terisi pada
  // jalur pemindaian, jadi ketiadaannya menandai upaya melapor sendiri.
  if (mission[0].requiresCheckIn && !scannedParticipantId) {
    throw ApiError.forbidden(
      'Kedatangan di pos ini dicatat petugas. Tunjukkan QR-mu untuk dipindai.',
    );
  }

  assertWithinEventWindow();
  assertWithinMissionSession(mission[0].sessionStart, mission[0].sessionEnd);

  const { passed } = await getGatekeeperStatus(groupId);
  if (!passed && !mission[0].isMandatory) {
    throw ApiError.badRequest('Selesaikan misi wajib terlebih dahulu sebelum membuka misi lain');
  }

  const existing = await getCheckIn(missionId, groupId);
  if (existing) {
    if (existing.checkedOutAt) throw ApiError.badRequest('Kelompok sudah check-out dari misi ini');
    throw ApiError.badRequest('Kelompok sudah check-in di misi ini');
  }

  const id = nanoid(16);
  await db.insert(missionCheckins).values({
    id,
    missionId,
    groupId,
    checkedInBy: userId,
    scannedParticipantId,
  });

  return { id, checkedInAt: new Date() };
};

/** Jarak dua titik koordinat dalam meter (haversine). */
const distanceInMeters = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371e3;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

/**
 * Peserta membuktikan sudah berdiri di lokasi misi.
 *
 * Untuk misi berpertanyaan yang dipagari koordinat, soalnya baru terbuka
 * setelah langkah ini berhasil — supaya jawaban tidak bisa disiapkan dari
 * rumah. Keberhasilannya dicatat sebagai check-in kelompok, jadi ikut terlihat
 * di layar pemantauan panitia.
 */
export const verifyMissionLocation = async (
  missionId: string,
  groupId: string,
  userId: string,
  coords: { lat: number; lng: number },
) => {
  await assertCheckedIn(userId);

  const [mission] = await db.select().from(missions).where(eq(missions.id, missionId)).limit(1);
  if (!mission) throw ApiError.notFound('Mission not found');
  if (!mission.geoLat || !mission.geoLng || !mission.geoRadius) {
    throw ApiError.badRequest('Misi ini tidak memerlukan validasi lokasi');
  }

  const distance = distanceInMeters(
    coords.lat,
    coords.lng,
    Number(mission.geoLat),
    Number(mission.geoLng),
  );

  if (distance > mission.geoRadius) {
    throw ApiError.badRequest(
      `Kamu masih ${Math.round(distance)} meter dari lokasi misi. Mendekatlah sampai dalam ${mission.geoRadius} meter.`,
    );
  }

  const existing = await getCheckIn(missionId, groupId);
  if (existing) {
    return { verified: true, distance: Math.round(distance), alreadyVerified: true };
  }

  await db.insert(missionCheckins).values({
    id: nanoid(16),
    missionId,
    groupId,
    checkedInBy: userId,
    scannedParticipantId: userId,
  });

  return { verified: true, distance: Math.round(distance), alreadyVerified: false };
};

/**
 * Apakah soal misi ini sudah boleh dibuka kelompok tersebut.
 *
 * Hanya misi yang dipagari koordinat yang terkunci; sisanya terbuka begitu
 * misinya terlihat.
 */
export const isQuizUnlocked = async (missionId: string, groupId: string) => {
  const [mission] = await db.select().from(missions).where(eq(missions.id, missionId)).limit(1);
  if (!mission) throw ApiError.notFound('Mission not found');

  const fenced = Boolean(mission.geoLat && mission.geoLng && mission.geoRadius);
  if (!fenced) return { unlocked: true, fenced: false };

  const checkIn = await getCheckIn(missionId, groupId);
  return { unlocked: Boolean(checkIn), fenced: true };
};

export const checkOutMission = async (
  missionId: string,
  groupId: string,
  userId: string,
  byOfficer = false,
) => {
  const [mission] = await db.select({ requiresCheckIn: missions.requiresCheckIn })
    .from(missions).where(eq(missions.id, missionId)).limit(1);
  if (!mission) throw ApiError.notFound('Mission not found');

  // Sama seperti kedatangan: kepergian dari pos berpetugas dicatat petugas.
  if (mission.requiresCheckIn && !byOfficer) {
    throw ApiError.forbidden(
      'Kepergian dari pos ini dicatat petugas. Tunjukkan QR-mu untuk dipindai.',
    );
  }

  const existing = await getCheckIn(missionId, groupId);
  if (!existing) throw ApiError.badRequest('Kelompok belum check-in di misi ini');
  if (existing.checkedOutAt) throw ApiError.badRequest('Kelompok sudah check-out dari misi ini');

  // MR6 menempatkan check-out sebagai langkah penutup, setelah bukti dikirim.
  // Tanpa penjagaan ini peserta bisa menutup pos lebih dulu lalu mengirim bukti
  // belakangan — petugas menganggap meja sudah kosong padahal belum selesai.
  const [submitted] = await db.select({ id: submissions.id }).from(submissions).where(and(
    eq(submissions.missionId, missionId),
    eq(submissions.groupId, groupId),
  )).limit(1);

  if (!submitted) {
    throw ApiError.badRequest('Kirim bukti misi ini terlebih dahulu, baru check-out dari pos.');
  }

  const checkedOutAt = new Date();
  await db.update(missionCheckins)
    .set({ checkedOutBy: userId, checkedOutAt })
    .where(eq(missionCheckins.id, existing.id));

  return { id: existing.id, checkedOutAt };
};

export const getCheckInsByGroup = async (groupId: string) => {
  return await db.select().from(missionCheckins).where(eq(missionCheckins.groupId, groupId));
};
