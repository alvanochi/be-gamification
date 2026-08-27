import { Router } from 'express';
import * as userController from './user.controller.ts';
import validate from '../../middlewares/validate.middleware.ts';
import authenticate from '../../middlewares/auth.middleware.ts';
import { registerSchema, updateProfileSchema, socialProfileSchema } from '../../validations/user.validation.ts';
import { idParamSchema } from '../../validations/common.validation.ts';

const router = Router();

router.post('/', validate({ body: registerSchema }), userController.createUserHandler);

// Pencarian nama untuk layar masuk peserta — sengaja sebelum authenticate.
router.get('/search', userController.searchParticipantsHandler);

// FR-01: panitia memindai QR peserta untuk check-in di lapangan.
router.post('/check-in/qr', authenticate, userController.checkInByQrHandler);

router.get('/me/profile', authenticate, userController.getProfileHandler);
router.put('/me/profile', authenticate, validate({ body: updateProfileSchema }), userController.updateProfileHandler);
// Checkpoint 0: profil usaha & akun media sosial, boleh dilewati.
router.put(
  '/me/social-profile',
  authenticate,
  validate({ body: socialProfileSchema }),
  userController.saveSocialProfileHandler,
);

// Butuh sesi: endpoint ini mengembalikan email & keanggotaan kelompok, yang
// sebelumnya bisa dibaca siapa saja tanpa token.
router.get('/:id', authenticate, validate({ params: idParamSchema }), userController.getUserByIdHandler);

export default router;
