import { Request, Response } from 'express';
import * as groupService from './group.service.ts';
import catchAsync from '../../utils/catchAsync.ts';
import response from '../../utils/response.ts';
import type { UpdateGroupNameInput, VoteLeaderInput } from '../../validations/group.validation.ts';

export const autoGroup = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user?.id as string; // Assuming auth middleware attaches user
  const result = await groupService.autoGroupUser(userId);
  response(res, 200, 'User auto-grouped successfully', result);
});

export const getGroup = catchAsync(async (req: Request, res: Response) => {
  const { groupId } = req.params;
  const result = await groupService.getGroupDetails(groupId);
  response(res, 200, 'Group details fetched successfully', result);
});

export const updateName = catchAsync(async (req: Request, res: Response) => {
  const { groupId } = req.params;
  const { name } = req.body as UpdateGroupNameInput;
  await groupService.updateGroupName(groupId, name, req.user?.id as string);
  response(res, 200, 'Group name updated successfully', null);
});

export const setPhotoCompleted = catchAsync(async (req: Request, res: Response) => {
  const { groupId } = req.params;
  await groupService.setGroupPhotoCompleted(groupId);
  response(res, 200, 'Group photo step completed', null);
});

export const voteLeader = catchAsync(async (req: Request, res: Response) => {
  const { groupId } = req.params;
  const { nomineeId } = req.body as VoteLeaderInput;
  const result = await groupService.recordVote(groupId, req.user?.id as string, nomineeId);
  response(res, 200, 'Vote recorded successfully', result);
});

export const confirmMember = catchAsync(async (req: Request, res: Response) => {
  const { groupId, targetUserId } = req.params;
  const userId = req.user?.id as string;
  await groupService.confirmMember(groupId, userId, targetUserId);
  response(res, 200, 'Member confirmed', null);
});

export const getConfirmations = catchAsync(async (req: Request, res: Response) => {
  const { groupId } = req.params;
  const confirmations = await groupService.getConfirmations(groupId);
  response(res, 200, 'Confirmations fetched', confirmations);
});
