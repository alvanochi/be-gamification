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
router.get('/groups', adminController.listGroups);
router.post('/groups/generate', adminController.generateGroups);
router.get('/monitoring', adminController.getMonitoring);
router.get('/monitoring/missions', adminController.getMissionMonitoring);
router.get('/monitoring/:groupId', adminController.getGroupDetail);
router.post('/field-results', adminController.submitFieldResult);
router.get('/accounts', adminController.listAccounts);
router.put('/accounts/:userId/role', adminController.setAccountRole);
router.get('/export/leaderboard', adminController.exportLeaderboard);

export default router;
