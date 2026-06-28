import { Request, Response } from 'express';
import * as leaderboardService from './leaderboard.service.ts';
import catchAsync from '../../utils/catchAsync.ts';
import { sendResponse } from '../../utils/response.ts';

export const getLeaderboard = catchAsync(async (req: Request, res: Response) => {
  const result = await leaderboardService.getLeaderboard();
  sendResponse(res, 200, 'Leaderboard fetched successfully', result);
});
