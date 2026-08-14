import { drizzle } from 'drizzle-orm/node-postgres';
import { pool } from './client.ts';
import * as usersSchema from './schema/users.ts';
import * as authenticationsSchema from './schema/authentications.ts';
import * as groupsSchema from './schema/groups.ts';
import * as sponsorsSchema from './schema/sponsors.ts';
import * as missionsSchema from './schema/missions.ts';
import * as submissionsSchema from './schema/submissions.ts';
import * as assignmentsSchema from './schema/assignments.ts';
import * as barterStepsSchema from './schema/barter_steps.ts';
import * as scoreEntriesSchema from './schema/score_entries.ts';
import * as confirmationsSchema from './schema/member_confirmations.ts';
import * as leaderVotesSchema from './schema/leader_votes.ts';
import * as missionCheckinsSchema from './schema/mission_checkins.ts';
import * as missionQuestionsSchema from './schema/mission_questions.ts';
export const schema = {
  ...usersSchema,
  ...authenticationsSchema,
  ...groupsSchema,
  ...sponsorsSchema,
  ...missionsSchema,
  ...submissionsSchema,
  ...assignmentsSchema,
  ...barterStepsSchema,
  ...scoreEntriesSchema,
  ...confirmationsSchema,
  ...leaderVotesSchema,
  ...missionCheckinsSchema,
  ...missionQuestionsSchema,
};

export const db = drizzle(pool, { schema });
