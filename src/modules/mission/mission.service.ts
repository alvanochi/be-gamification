import { eq, and } from 'drizzle-orm';
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
    equipment: data.equipment,
    scoringMode: data.scoringMode,
    pointPerUnit: data.pointPerUnit,
    maxUnits: data.maxUnits,
    timeTargetSeconds: data.timeTargetSeconds,
  });

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
  // Peserta dikumpulkan dan dibriefing lebih dulu; daftar misi baru terbuka
  // setelah panitia menekan "Munculkan Misi".
  const settings = await getSettings();
  if (!settings.missionsReleased) return [];

  const { passed, mandatoryMissions } = await getGatekeeperStatus(groupId);

  if (!passed) {
    return mandatoryMissions;
  }

  const allMissions = await db.select().from(missions);
  return filterByPrerequisite(groupId, allMissions);
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
  queueNumber?: string,
) => {
  await assertCheckedIn(userId);

  const mission = await db.select().from(missions).where(eq(missions.id, missionId)).limit(1);
  if (!mission.length) throw ApiError.notFound('Mission not found');

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
    queueNumber,
  });

  return { id, checkedInAt: new Date() };
};

export const checkOutMission = async (missionId: string, groupId: string, userId: string) => {
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
