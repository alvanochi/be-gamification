import { Router } from 'express';
import * as groupController from './group.controller.ts';
import authenticate from '../../middlewares/auth.middleware.ts';
import validate from '../../middlewares/validate.middleware.ts';
import { updateGroupNameSchema, voteLeaderSchema } from '../../validations/group.validation.ts';

const router = Router();

router.use(authenticate);

router.post('/auto-group', groupController.autoGroup);
router.get('/:groupId', groupController.getGroup);
router.put('/:groupId/name', validate(updateGroupNameSchema), groupController.updateName);
router.post('/:groupId/vote-leader', validate(voteLeaderSchema), groupController.voteLeader);

export default router;
