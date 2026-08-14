import { Router } from 'express';
import * as missionController from './mission.controller.ts';
import authenticate from '../../middlewares/auth.middleware.ts';
import validate from '../../middlewares/validate.middleware.ts';
import {
  createMissionSchema,
  updateMissionSchema,
  missionCheckInSchema,
  setQuestionsSchema,
} from '../../validations/mission.validation.ts';

const router = Router();

router.use(authenticate);

router.post('/', validate(createMissionSchema), missionController.createMission);
router.get('/', missionController.getMissions);

// Rute statis didaftarkan sebelum rute ber-parameter agar "my-assignments" dan
// "my-checkins" tidak pernah tertangkap sebagai :missionId.
router.get('/my-assignments', missionController.getMyAssignments);
router.get('/my-checkins', missionController.getMyCheckIns);

router.put('/:missionId', validate(updateMissionSchema), missionController.updateMission);
router.delete('/:missionId', missionController.deleteMission);

router.get('/:missionId/questions', missionController.getMissionQuestions);
router.put('/:missionId/questions', validate(setQuestionsSchema), missionController.setMissionQuestions);

router.post('/:missionId/assignments', missionController.createAssignment);
router.post('/:missionId/check-in', validate(missionCheckInSchema), missionController.checkInMission);
router.post('/:missionId/check-out', missionController.checkOutMission);

export default router;
