import { Request, Response } from 'express';
import * as leaderboardService from './leaderboard.service.ts';
import catchAsync from '../../utils/catchAsync.ts';
import response from '../../utils/response.ts';

export const getLeaderboard = catchAsync(async (req: Request, res: Response) => {
  const result = await leaderboardService.getLeaderboard();
  response(res, 200, 'Leaderboard fetched successfully', result);
});
