import { eq, and, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../../db/index.ts';
import { missions, missionOptions } from '../../db/schema/missions.ts';
import { submissions } from '../../db/schema/submissions.ts';
import ApiError from '../../utils/ApiError.ts';
import type { CreateMissionInput } from '../../validations/mission.validation.ts';

export const createMission = async (data: CreateMissionInput) => {
  const missionId = nanoid(16);

  await db.transaction(async (tx) => {
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
      const optionsToInsert = data.options.map((opt) => ({
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
  // Check if mandatory mission is completed by this group
  const mandatoryMissions = await db.select().from(missions).where(eq(missions.isMandatory, true));

  let isGatekeeperPassed = true;

  if (mandatoryMissions.length > 0) {
    const mandatoryMissionId = mandatoryMissions[0].id; // Assuming only one mandatory mission as per BR-02
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

  // If gatekeeper not passed, return only the mandatory mission
  if (!isGatekeeperPassed) {
    return mandatoryMissions;
  }

  // If passed, return all missions (BR-03: Non-Linear Gameplay)
  const allMissions = await db.select().from(missions);
  return allMissions;
};
