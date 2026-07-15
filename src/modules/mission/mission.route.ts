import { Router } from 'express';
import * as missionController from './mission.controller.ts';
import authenticate from '../../middlewares/auth.middleware.ts';
import validate from '../../middlewares/validate.middleware.ts';
import { createMissionSchema } from '../../validations/mission.validation.ts';

const router = Router();

router.use(authenticate);

router.post('/', validate(createMissionSchema), missionController.createMission);
router.get('/', missionController.getMissions);

router.post('/:missionId/assignments', missionController.createAssignment);
router.get('/my-assignments', missionController.getMyAssignments);

export default router;
