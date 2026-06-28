import { Request, Response } from 'express';
import * as groupService from './group.service.ts';
import catchAsync from '../../utils/catchAsync.ts';
import { sendResponse } from '../../utils/response.ts';
import type { UpdateGroupNameInput, VoteLeaderInput } from '../../validations/group.validation.ts';

export const autoGroup = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user?.id as string; // Assuming auth middleware attaches user
  const result = await groupService.autoGroupUser(userId);
  sendResponse(res, 200, 'User auto-grouped successfully', result);
});

export const getGroup = catchAsync(async (req: Request, res: Response) => {
  const { groupId } = req.params;
  const result = await groupService.getGroupDetails(groupId);
  sendResponse(res, 200, 'Group details fetched successfully', result);
});

export const updateName = catchAsync(async (req: Request, res: Response) => {
  const { groupId } = req.params;
  const { name } = req.body as UpdateGroupNameInput;
  await groupService.updateGroupName(groupId, name);
  sendResponse(res, 200, 'Group name updated successfully', null);
});

export const voteLeader = catchAsync(async (req: Request, res: Response) => {
  const { groupId } = req.params;
  const { nomineeId } = req.body as VoteLeaderInput;
  await groupService.setLeader(groupId, nomineeId);
  sendResponse(res, 200, 'Leader set successfully', null);
});
