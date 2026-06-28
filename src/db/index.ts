import { drizzle } from 'drizzle-orm/node-postgres';
import { pool } from './client.ts';
import * as usersSchema from './schema/users.ts';
import * as authenticationsSchema from './schema/authentications.ts';
import * as groupsSchema from './schema/groups.ts';
import * as sponsorsSchema from './schema/sponsors.ts';
import * as missionsSchema from './schema/missions.ts';
import * as submissionsSchema from './schema/submissions.ts';

export const schema = {
  ...usersSchema,
  ...authenticationsSchema,
  ...groupsSchema,
  ...sponsorsSchema,
  ...missionsSchema,
  ...submissionsSchema,
};

export const db = drizzle(pool, { schema });
