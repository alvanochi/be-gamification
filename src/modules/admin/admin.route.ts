import { Router } from 'express';
import multer from 'multer';
import * as adminController from './admin.controller.ts';
import * as sheetController from './sheet.controller.ts';

import authenticate from '../../middlewares/auth.middleware.ts';

// Lembar kerja dibaca langsung dari memori — tidak ada gunanya menyimpan
// berkas mentahnya ke disk setelah barisnya dipindahkan ke basis data.
const sheetUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});
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
router.post('/accounts', adminController.createAccount);
// Rute berjalur tetap harus mendahului yang berparameter, kalau tidak
// "/accounts/roles" akan tertangkap sebagai userId bernama "roles".
router.put('/accounts/roles', adminController.setAccountRolesBulk);
router.post('/accounts/qr-tokens', adminController.getQrTokensForPrint);
router.put('/accounts/:userId/role', adminController.setAccountRole);
router.put('/accounts/:userId', adminController.updateAccount);
router.delete('/accounts/:userId', adminController.deleteAccount);
// Kartu QR peserta untuk dicetak sebelum acara.
router.get('/participants/qr', adminController.listParticipantQrCards);
// Petugas pos memindai QR peserta untuk mencatat kedatangan/kepergian.
router.post('/post/scan', adminController.postScan);
router.get('/post/:missionId/queue', adminController.getPostQueue);
router.get('/export/leaderboard', adminController.exportLeaderboard);

// --- Pertukaran data lewat lembar kerja ---
router.get('/sheets/accounts/template', sheetController.downloadAccountTemplate);
router.get('/sheets/accounts', sheetController.exportAccounts);
router.post('/sheets/accounts', sheetUpload.single('file'), sheetController.importAccounts);
router.get('/sheets/groups', sheetController.exportGroups);
router.post('/sheets/groups', sheetUpload.single('file'), sheetController.importGroups);

export default router;
