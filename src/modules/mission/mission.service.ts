import { eq, and } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../../db/index.ts';
import { missions } from '../../db/schema/missions.ts';
import { submissions } from '../../db/schema/submissions.ts';
import { assignments } from '../../db/schema/assignments.ts';
import { missionCheckins } from '../../db/schema/mission_checkins.ts';
import ApiError from '../../utils/ApiError.ts';
import { assertWithinEventWindow, assertWithinMissionSession } from '../../utils/eventTime.ts';
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
  });

  return { id: missionId };
};

export const getAllMissions = async () => {
  return await db.select().from(missions);
};

/**
 * BR-02 — misi lanjutan terkunci sampai misi wajib pertama disetujui.
 *
 * Dipakai bersama oleh daftar misi *dan* endpoint submit. Sebelumnya aturan ini
 * hanya diterapkan saat membaca daftar, sehingga peserta bisa melewati gerbang
 * dengan memanggil POST /submissions langsung.
 */
export const getGatekeeperStatus = async (groupId: string) => {
  const mandatoryMissions = await db.select().from(missions).where(eq(missions.isMandatory, true));

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

export const getAvailableMissions = async (groupId: string) => {
  const { passed, mandatoryMissions } = await getGatekeeperStatus(groupId);

  if (!passed) {
    return mandatoryMissions;
  }

  const allMissions = await db.select().from(missions);
  return allMissions;
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

  const checkedOutAt = new Date();
  await db.update(missionCheckins)
    .set({ checkedOutBy: userId, checkedOutAt })
    .where(eq(missionCheckins.id, existing.id));

  return { id: existing.id, checkedOutAt };
};

export const getCheckInsByGroup = async (groupId: string) => {
  return await db.select().from(missionCheckins).where(eq(missionCheckins.groupId, groupId));
};
