import { eq, and, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../../db/index.ts';
import { missions, missionOptions } from '../../db/schema/missions.ts';
import { submissions } from '../../db/schema/submissions.ts';
import { assignments } from '../../db/schema/assignments.ts';
import ApiError from '../../utils/ApiError.ts';
import type { CreateMissionInput } from '../../validations/mission.validation.ts';

export const createMission = async (data: CreateMissionInput) => {
  const missionId = nanoid(16);

  await db.transaction(async (tx: any) => {
    await tx.insert(missions).values({
      id: missionId,
      title: data.title,
      description: data.description,
      type: data.type,
      isMandatory: data.isMandatory,
      pointWeight: data.pointWeight,
      sponsorId: data.sponsorId,
    });

    if (data.type === 'MULTIPLE_CHOICE' && data.options && data.options.length > 0) {
      const optionsToInsert = data.options.map((opt: any) => ({
        id: nanoid(16),
        missionId,
        optionText: opt.optionText,
        isCorrect: opt.isCorrect,
      }));
      await tx.insert(missionOptions).values(optionsToInsert);
    }
  });

  return { id: missionId };
};

export const getAvailableMissions = async (groupId: string) => {
  const mandatoryMissions = await db.select().from(missions).where(eq(missions.isMandatory, true));

  let isGatekeeperPassed = true;

  if (mandatoryMissions.length > 0) {
    const mandatoryMissionId = mandatoryMissions[0].id;
    const submission = await db.select()
      .from(submissions)
      .where(and(
        eq(submissions.missionId, mandatoryMissionId),
        eq(submissions.groupId, groupId),
        eq(submissions.status, 'APPROVED')
      ))
      .limit(1);

    if (submission.length === 0) {
      isGatekeeperPassed = false;
    }
  }

  if (!isGatekeeperPassed) {
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
