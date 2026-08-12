import { Router } from 'express';
import * as adminController from './admin.controller.ts';
import authenticate from '../../middlewares/auth.middleware.ts';

const router = Router();

router.use(authenticate);

router.get('/review-queue', adminController.getReviewQueue);
router.post('/scores/manual', adminController.addManualScore);
router.get('/banners', adminController.getBanners);
router.post('/banners', adminController.createBanner);
router.put('/banners/:id', adminController.updateBanner);
router.delete('/banners/:id', adminController.deleteBanner);
router.post('/barter/:assignmentId/verify', adminController.verifyBarter);
router.put('/groups/:groupId/leader', adminController.setGroupLeader);
router.get('/export/leaderboard', adminController.exportLeaderboard);

export default router;
