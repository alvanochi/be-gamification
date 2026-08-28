import { Router } from 'express';
import * as submissionController from './submission.controller.ts';
import authenticate from '../../middlewares/auth.middleware.ts';
import validate from '../../middlewares/validate.middleware.ts';
import { submitMissionSchema, validateSubmissionSchema } from '../../validations/submission.validation.ts';

const router = Router();

router.use(authenticate);

router.get('/my-group', submissionController.getMyGroupSubmissions);
router.get('/pending', submissionController.getPendingSubmissions);
router.get('/pending/count', submissionController.getPendingCounts);
router.post('/', validate(submitMissionSchema), submissionController.submitMission);
router.get('/:submissionId/quiz-review', submissionController.getQuizReview);
router.put('/:submissionId/validate', validate(validateSubmissionSchema), submissionController.validateSubmission);
router.get('/barter-steps/:assignmentId', submissionController.getBarterSteps);
router.post('/barter-steps', submissionController.submitBarterStep);

export default router;
