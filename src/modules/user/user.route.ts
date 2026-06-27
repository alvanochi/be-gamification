import { Router } from 'express';
import * as userController from './user.controller.ts';
import validate from '../../middlewares/validate.middleware.ts';
import authenticate from '../../middlewares/auth.middleware.ts';
import { registerSchema, updateProfileSchema } from '../../validations/user.validation.ts';
import { idParamSchema } from '../../validations/common.validation.ts';

const router = Router();

router.post('/', validate({ body: registerSchema }), userController.createUserHandler);

router.get('/me/profile', authenticate, userController.getProfileHandler);
router.put('/me/profile', authenticate, validate({ body: updateProfileSchema }), userController.updateProfileHandler);

router.get('/:id', validate({ params: idParamSchema }), userController.getUserByIdHandler);

export default router;
