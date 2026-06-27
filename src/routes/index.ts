import { Router } from 'express';

import userRoutes from '../modules/user/user.route.ts';
import authRoutes from '../modules/auth/auth.route.ts';

const router = Router();

router.use('/users', userRoutes);
router.use('/authentications', authRoutes);

export default router;