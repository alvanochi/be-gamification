import env from './config/env.ts';
import app from './app.ts';
import { pool } from './db/client.ts';

const start = async () => {
  try {
    const client = await pool.connect();
    client.release();

    app.listen(env.PORT, env.HOST, () => {
      console.log(`Server running at http://${env.HOST}:${env.PORT} [${env.NODE_ENV}]`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

start();
