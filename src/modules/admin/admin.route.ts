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
router.get('/barter/queue', adminController.getBarterQueue);
router.put('/barter/steps/:stepId/validate', adminController.validateBarterStep);
router.put('/groups/:groupId/leader', adminController.setGroupLeader);
router.get('/groups', adminController.listGroups);
router.post('/groups/generate', adminController.generateGroups);
router.get('/monitoring', adminController.getMonitoring);
router.get('/monitoring/missions', adminController.getMissionMonitoring);
router.get('/monitoring/:groupId', adminController.getGroupDetail);
router.post('/field-results', adminController.submitFieldResult);
router.get('/accounts', adminController.listAccounts);
// Kartu QR peserta untuk dicetak sebelum acara.
router.get('/participants/qr', adminController.listParticipantQrCards);
// Petugas pos memindai QR peserta untuk mencatat kedatangan/kepergian.
router.post('/post/scan', adminController.postScan);
router.get('/post/:missionId/queue', adminController.getPostQueue);
router.put('/accounts/roles', adminController.setAccountRolesBulk);
router.post('/accounts/qr-tokens', adminController.getQrTokensForPrint);
router.put('/accounts/:userId/role', adminController.setAccountRole);
router.get('/export/leaderboard', adminController.exportLeaderboard);

export default router;
