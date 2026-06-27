import { Router } from 'express';
import * as authController from './auth.controller.ts';
import validate from '../../middlewares/validate.middleware.ts';
import authenticate from '../../middlewares/auth.middleware.ts';
import { loginSchema, refreshTokenSchema } from '../../validations/auth.validation.ts';

const router = Router();

router.post('/', validate({ body: loginSchema }), authController.loginHandler);
router.put('/', validate({ body: refreshTokenSchema }), authController.refreshTokenHandler);
router.delete('/', authenticate, authController.logoutHandler);

export default router;
