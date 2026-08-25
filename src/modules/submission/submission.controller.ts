import { Request, Response } from 'express';
import * as submissionService from './submission.service.ts';
import catchAsync from '../../utils/catchAsync.ts';
import response from '../../utils/response.ts';
import type { SubmitMissionInput, ValidateSubmissionInput } from '../../validations/submission.validation.ts';
import ApiError from '../../utils/ApiError.ts';
import { db } from '../../db/index.ts';
import { users } from '../../db/schema/users.ts';
import { eq } from 'drizzle-orm';
import { assertCheckedIn } from '../../utils/attendance.ts';

export const getMyGroupSubmissions = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user?.id as string;
  const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user.length) throw ApiError.notFound('User not found');
  if (!user[0].groupId) throw ApiError.badRequest('User must join a group first');

  const result = await submissionService.getSubmissionsByGroup(user[0].groupId);
  response(res, 200, 'Submissions fetched', result);
});

export const submitMission = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user?.id as string;
  // Kehadiran diperiksa lebih dulu supaya peserta yang belum dipindai
  // menerima pesan yang benar, bukan "harus bergabung ke kelompok dulu" —
  // padahal justru kehadiranlah yang menghalanginya masuk kelompok.
  await assertCheckedIn(userId);

  const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user.length) throw ApiError.notFound('User not found');
  if (!user[0].groupId) throw ApiError.badRequest('User must join a group first');

  const data = req.body as SubmitMissionInput;
  const result = await submissionService.submitMission(user[0].groupId, userId, data);
  response(res, 201, 'Mission submitted successfully', result);
});

export const getPendingSubmissions = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user?.id as string;
  const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user.length || (user[0].role !== 'ADMIN' && user[0].role !== 'SUPER_ADMIN')) {
    throw ApiError.forbidden('Only ADMIN or SUPER_ADMIN can view the validation queue');
  }

  const result = await submissionService.getPendingSubmissions();
  response(res, 200, 'Pending submissions fetched', result);
});

/** Lencana angka di navigasi panel — dibaca setiap halaman panitia. */
export const getPendingCounts = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user?.id as string;
  const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user.length || (user[0].role !== 'ADMIN' && user[0].role !== 'SUPER_ADMIN')) {
    throw ApiError.forbidden('Only ADMIN or SUPER_ADMIN can view the validation queue');
  }

  const result = await submissionService.getPendingCounts();
  response(res, 200, 'Pending counts fetched', result);
});

export const validateSubmission = catchAsync(async (req: Request, res: Response) => {
  const submissionId = req.params.submissionId as string;
  const validatorId = req.user?.id as string;
  
  const user = await db.select().from(users).where(eq(users.id, validatorId)).limit(1);
  if (!user.length || (user[0].role !== 'ADMIN' && user[0].role !== 'SUPER_ADMIN')) {
    throw ApiError.forbidden('Only ADMIN or SUPER_ADMIN can validate submissions');
  }

  const { status, awardedPoint, units, timeSeconds, rejectReason } = req.body as ValidateSubmissionInput;
  await submissionService.validateSubmission(
    submissionId,
    status,
    validatorId,
    { awardedPoint, units, timeSeconds },
    rejectReason,
  );
  response(res, 200, `Submission ${status.toLowerCase()} successfully`, null);
});

export const getBarterSteps = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user?.id as string;
  const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user.length) throw ApiError.notFound('User not found');
  if (!user[0].groupId) throw ApiError.badRequest('User must join a group first');

  const result = await submissionService.getBarterSteps(
    user[0].groupId,
    req.params.assignmentId as string,
  );
  response(res, 200, 'Barter steps fetched', result);
});

export const submitBarterStep = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user?.id as string;
  const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user.length) throw ApiError.notFound('User not found');
  if (!user[0].groupId) throw ApiError.badRequest('User must join a group first');

  const result = await submissionService.submitBarterStep(user[0].groupId, req.body);
  response(res, 201, 'Barter step submitted', result);
});
