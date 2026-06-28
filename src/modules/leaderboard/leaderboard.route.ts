import { Router } from 'express';
import * as leaderboardController from './leaderboard.controller.ts';

const router = Router();

router.get('/', leaderboardController.getLeaderboard);

export default router;
