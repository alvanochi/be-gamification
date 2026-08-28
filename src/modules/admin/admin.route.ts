import { Router } from 'express';
import multer from 'multer';
import * as adminController from './admin.controller.ts';
import * as sheetController from './sheet.controller.ts';
import * as missionSheetController from './mission-sheet.controller.ts';

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
// "Akhiri": menutup rantai barter satu kelompok dengan nilai akhir.
router.post('/barter/:assignmentId/finish', adminController.finishBarter);
router.get('/barter/queue', adminController.getBarterQueue);
router.put('/barter/steps/:stepId/validate', adminController.validateBarterStep);
router.put('/groups/:groupId/leader', adminController.setGroupLeader);
router.get('/groups', adminController.listGroups);
router.post('/groups', adminController.createGroup);
router.delete('/groups', adminController.deleteGroups);
router.put('/groups/:groupId/members', adminController.setGroupMembers);
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
router.delete('/accounts', adminController.deleteAccountsBulk);
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
// Satu lembar untuk peserta sekaligus kelompoknya: kolom Kelompok pada tiap
// baris menentukan ke mana peserta itu ditempatkan.
router.get('/sheets/accounts/template', sheetController.downloadAccountTemplate);
router.get('/sheets/accounts', sheetController.exportAccounts);
router.post('/sheets/accounts', sheetUpload.single('file'), sheetController.importAccounts);

// Rangkaian misi juga disusun panitia di spreadsheet sebelum acara.
router.get('/sheets/missions/template', missionSheetController.downloadMissionTemplate);
router.get('/sheets/missions', missionSheetController.exportMissions);
router.post('/sheets/missions', sheetUpload.single('file'), missionSheetController.importMissions);

export default router;
