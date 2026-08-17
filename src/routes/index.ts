import { Router } from 'express';

import userRoutes from '../modules/user/user.route.ts';
import authRoutes from '../modules/auth/auth.route.ts';
import groupRoutes from '../modules/group/group.route.ts';
import missionRoutes from '../modules/mission/mission.route.ts';
import submissionRoutes from '../modules/submission/submission.route.ts';
import leaderboardRoutes from '../modules/leaderboard/leaderboard.route.ts';
import sponsorRoutes from '../modules/sponsor/sponsor.route.ts';
import settingsRoutes from '../modules/settings/settings.route.ts';
import categoryRoutes from '../modules/category/category.route.ts';

import adminRoutes from '../modules/admin/admin.route.ts';

const router = Router();

router.use('/users', userRoutes);
router.use('/authentications', authRoutes);
router.use('/groups', groupRoutes);
router.use('/missions', missionRoutes);
router.use('/submissions', submissionRoutes);
router.use('/leaderboard', leaderboardRoutes);
router.use('/sponsors', sponsorRoutes);
router.use('/settings', settingsRoutes);
router.use('/group-categories', categoryRoutes);
router.use('/admin', adminRoutes);

export default router;