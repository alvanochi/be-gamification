import { drizzle } from 'drizzle-orm/node-postgres';
import { pool } from './client.ts';
import * as usersSchema from './schema/users.ts';
import * as authenticationsSchema from './schema/authentications.ts';

export const schema = {
  ...usersSchema,
  ...authenticationsSchema,
};

export const db = drizzle(pool, { schema });
