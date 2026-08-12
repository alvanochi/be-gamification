import { Request, Response } from 'express';
import * as missionService from './mission.service.ts';
import catchAsync from '../../utils/catchAsync.ts';
import response from '../../utils/response.ts';
import type { CreateMissionInput } from '../../validations/mission.validation.ts';
import ApiError from '../../utils/ApiError.ts';
import { db } from '../../db/index.ts';
import { users } from '../../db/schema/users.ts';
import { eq } from 'drizzle-orm';

export const createMission = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user?.id as string;
  const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user.length || (user[0].role !== 'ADMIN' && user[0].role !== 'SUPER_ADMIN')) {
    throw ApiError.forbidden('Only ADMIN or SUPER_ADMIN can create missions');
  }

  const data = req.body as CreateMissionInput;
  const result = await missionService.createMission(data);
  response(res, 201, 'Mission created successfully', result);
});

const ensureAdmin = async (userId: string) => {
  const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user.length || (user[0].role !== 'ADMIN' && user[0].role !== 'SUPER_ADMIN')) {
    throw ApiError.forbidden('Only ADMIN or SUPER_ADMIN can manage missions');
  }
};

export const updateMission = catchAsync(async (req: Request, res: Response) => {
  await ensureAdmin(req.user?.id as string);

  const result = await missionService.updateMission(req.params.missionId as string, req.body);
  response(res, 200, 'Mission updated successfully', result);
});

export const deleteMission = catchAsync(async (req: Request, res: Response) => {
  await ensureAdmin(req.user?.id as string);

  await missionService.deleteMission(req.params.missionId as string);
  response(res, 200, 'Mission deleted successfully', null);
});

export const getMissions = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user?.id as string;
  
  // Get user's group
  const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user.length) throw ApiError.notFound('User not found');
  
  // Admin/panitia/super_admin see every mission, unfiltered by group gatekeeper status.
  if (user[0].role !== 'PARTICIPANT') {
    const allMissions = await missionService.getAllMissions();
    return response(res, 200, 'Missions fetched', allMissions);
  }

  if (!user[0].groupId) {
    throw ApiError.badRequest('User must join a group first before viewing missions');
  }

  const result = await missionService.getAvailableMissions(user[0].groupId);
  response(res, 200, 'Missions fetched successfully', result);
});

export const createAssignment = catchAsync(async (req: Request, res: Response) => {
  const missionId = req.params.missionId as string;
  const { assigneeUserId } = req.body;
  const userId = req.user?.id as string;
  
  const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user.length || !user[0].groupId) throw ApiError.badRequest('User must be in a group');

  const result = await missionService.assignMission(missionId, user[0].groupId, assigneeUserId);
  response(res, 201, 'Assignment created', result);
});

export const getMyAssignments = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user?.id as string;
  const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user.length || !user[0].groupId) throw ApiError.badRequest('User must be in a group');

  const assignmentsData = await missionService.getAssignmentsByGroup(user[0].groupId);
  response(res, 200, 'Assignments fetched', assignmentsData);
});

/** Ambil groupId peserta, dipakai semua handler check-in/out. */
const requireGroup = async (userId: string) => {
  const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user.length) throw ApiError.notFound('User not found');
  if (!user[0].groupId) throw ApiError.badRequest('User must join a group first');
  return user[0].groupId;
};

export const checkInMission = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user?.id as string;
  const groupId = await requireGroup(userId);
  const { queueNumber } = req.body ?? {};

  const result = await missionService.checkInMission(
    req.params.missionId as string,
    groupId,
    userId,
    queueNumber,
  );
  response(res, 201, 'Check-in berhasil', result);
});

export const checkOutMission = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user?.id as string;
  const groupId = await requireGroup(userId);

  const result = await missionService.checkOutMission(req.params.missionId as string, groupId, userId);
  response(res, 200, 'Check-out berhasil', result);
});

export const getMyCheckIns = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user?.id as string;
  const groupId = await requireGroup(userId);

  const result = await missionService.getCheckInsByGroup(groupId);
  response(res, 200, 'Check-ins fetched', result);
});
