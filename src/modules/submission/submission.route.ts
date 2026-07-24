import { Router } from 'express';
import * as submissionController from './submission.controller.ts';
import authenticate from '../../middlewares/auth.middleware.ts';
import validate from '../../middlewares/validate.middleware.ts';
import { submitMissionSchema, validateSubmissionSchema } from '../../validations/submission.validation.ts';

const router = Router();

router.use(authenticate);

router.get('/upload-url', submissionController.getUploadUrl);
router.get('/my-group', submissionController.getMyGroupSubmissions);
router.get('/pending', submissionController.getPendingSubmissions);
router.post('/', validate(submitMissionSchema), submissionController.submitMission);
router.put('/:submissionId/validate', validate(validateSubmissionSchema), submissionController.validateSubmission);
router.post('/barter-steps', submissionController.submitBarterStep);

export default router;
