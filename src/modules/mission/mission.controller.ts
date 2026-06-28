import { Request, Response } from 'express';
import * as missionService from './mission.service.ts';
import catchAsync from '../../utils/catchAsync.ts';
import { sendResponse } from '../../utils/response.ts';
import type { CreateMissionInput } from '../../validations/mission.validation.ts';
import ApiError from '../../utils/ApiError.ts';
import { db } from '../../db/index.ts';
import { users } from '../../db/schema/users.ts';
import { eq } from 'drizzle-orm';

export const createMission = catchAsync(async (req: Request, res: Response) => {
  // Ensure user is super_admin
  const userId = req.user?.id as string;
  const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user.length || user[0].role !== 'SUPER_ADMIN') {
    throw ApiError.forbidden('Only SUPER_ADMIN can create missions');
  }

  const data = req.body as CreateMissionInput;
  const result = await missionService.createMission(data);
  sendResponse(res, 201, 'Mission created successfully', result);
});

export const getMissions = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user?.id as string;
  
  // Get user's group
  const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user.length) throw ApiError.notFound('User not found');
  
  // If admin/super_admin, maybe they can see all. But for participant, enforce gatekeeper.
  if (user[0].role !== 'PARTICIPANT') {
    // Admin can see all
    const allMissions = await missionService.getAvailableMissions('admin_override'); // Or a direct call to get all
    return sendResponse(res, 200, 'Missions fetched', allMissions);
  }

  if (!user[0].groupId) {
    throw ApiError.badRequest('User must join a group first before viewing missions');
  }

  const result = await missionService.getAvailableMissions(user[0].groupId);
  sendResponse(res, 200, 'Missions fetched successfully', result);
});
