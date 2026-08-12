import { Request, Response } from 'express';
import * as submissionService from './submission.service.ts';
import catchAsync from '../../utils/catchAsync.ts';
import response from '../../utils/response.ts';
import type { SubmitMissionInput, ValidateSubmissionInput } from '../../validations/submission.validation.ts';
import ApiError from '../../utils/ApiError.ts';
import { db } from '../../db/index.ts';
import { users } from '../../db/schema/users.ts';
import { eq } from 'drizzle-orm';

export const getUploadUrl = catchAsync(async (req: Request, res: Response) => {
  const { fileName, mimeType } = req.query;
  if (!fileName || !mimeType) {
    throw ApiError.badRequest('fileName and mimeType are required query parameters');
  }

  const result = await submissionService.generatePresignedUrl(fileName as string, mimeType as string);
  response(res, 200, 'Presigned URL generated', result);
});

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

export const validateSubmission = catchAsync(async (req: Request, res: Response) => {
  const submissionId = req.params.submissionId as string;
  const validatorId = req.user?.id as string;
  
  const user = await db.select().from(users).where(eq(users.id, validatorId)).limit(1);
  if (!user.length || (user[0].role !== 'ADMIN' && user[0].role !== 'SUPER_ADMIN')) {
    throw ApiError.forbidden('Only ADMIN or SUPER_ADMIN can validate submissions');
  }

  const { status } = req.body as ValidateSubmissionInput;
  await submissionService.validateSubmission(submissionId, status, validatorId);
  response(res, 200, `Submission ${status.toLowerCase()} successfully`, null);
});

export const submitBarterStep = catchAsync(async (req: Request, res: Response) => {
  const result = await submissionService.submitBarterStep(req.body);
  response(res, 201, 'Barter step submitted', result);
});
