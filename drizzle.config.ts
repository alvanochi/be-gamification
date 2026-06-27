import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  out: './src/db/migrations',
  schema: './src/db/schema/*',
  dialect: 'postgresql',
  dbCredentials: {
    host: process.env.PGHOST!,
    port: Number(process.env.PGPORT) || 5432,
    database: process.env.PGDATABASE!,
    user: process.env.PGUSER!,
    password: process.env.PGPASSWORD || '',
    ssl: false,
  },
});
