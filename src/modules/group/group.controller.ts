import { Request, Response } from 'express';
import * as groupService from './group.service.ts';
import { ensureAdmin } from '../../utils/roles.ts';
import catchAsync from '../../utils/catchAsync.ts';
import response from '../../utils/response.ts';
import type { UpdateGroupNameInput, VoteLeaderInput } from '../../validations/group.validation.ts';

/**
 * Penempatan satu peserta ke kelompok.
 *
 * SRS 5.3 menempatkan pembentukan kelompok di tangan panitia, jadi jalur ini
 * bukan lagi untuk peserta — hanya dipakai panitia sebagai penanganan kasus
 * per orang (mis. peserta terlambat yang perlu segera ditempatkan).
 */
export const autoGroup = catchAsync(async (req: Request, res: Response) => {
  await ensureAdmin(req.user?.id as string);

  const userId = req.user?.id as string; // Assuming auth middleware attaches user
  const result = await groupService.autoGroupUser(userId);
  response(res, 200, 'User auto-grouped successfully', result);
});

export const getGroup = catchAsync(async (req: Request, res: Response) => {
  const groupId = req.params.groupId as string;
  const result = await groupService.getGroupDetails(groupId);
  response(res, 200, 'Group details fetched successfully', result);
});

export const updateName = catchAsync(async (req: Request, res: Response) => {
  const groupId = req.params.groupId as string;
  const { name } = req.body as UpdateGroupNameInput;
  await groupService.updateGroupName(groupId, name, req.user?.id as string);
  response(res, 200, 'Group name updated successfully', null);
});

export const checkNameAvailability = catchAsync(async (req: Request, res: Response) => {
  const result = await groupService.isGroupNameAvailable(
    String(req.query.name ?? ''),
    req.params.groupId as string,
  );
  response(res, 200, 'Name checked', result);
});

export const setPhotoCompleted = catchAsync(async (req: Request, res: Response) => {
  const groupId = req.params.groupId as string;
  const { photoUrl } = req.body ?? {};
  await groupService.setGroupPhotoCompleted(groupId, photoUrl);
  response(res, 200, 'Group photo step completed', null);
});

export const voteLeader = catchAsync(async (req: Request, res: Response) => {
  const groupId = req.params.groupId as string;
  const { nomineeId } = req.body as VoteLeaderInput;
  const result = await groupService.recordVote(groupId, req.user?.id as string, nomineeId);
  response(res, 200, 'Vote recorded successfully', result);
});

export const confirmMember = catchAsync(async (req: Request, res: Response) => {
  const groupId = req.params.groupId as string;
  const targetUserId = req.params.targetUserId as string;
  const userId = req.user?.id as string;
  await groupService.confirmMember(groupId, userId, targetUserId);
  response(res, 200, 'Member confirmed', null);
});

export const getConfirmations = catchAsync(async (req: Request, res: Response) => {
  const groupId = req.params.groupId as string;
  const confirmations = await groupService.getConfirmations(groupId);
  response(res, 200, 'Confirmations fetched', confirmations);
});
