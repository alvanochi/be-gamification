import http from 'http';
import env from './config/env.ts';
import app from './app.ts';
import { pool } from './db/client.ts';
import { initRealtime } from './realtime/hub.ts';

const start = async () => {
  try {
    const client = await pool.connect();
    client.release();

    // Express dibungkus server HTTP eksplisit supaya socket.io bisa menumpang
    // port yang sama — tidak perlu port kedua yang harus dibuka di firewall.
    const server = http.createServer(app);
    initRealtime(server, '*');

    server.listen(env.PORT, env.HOST, () => {
      console.log(`Server running at http://${env.HOST}:${env.PORT} [${env.NODE_ENV}]`);
      console.log('Realtime (socket.io) aktif di path /socket.io');
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

start();
