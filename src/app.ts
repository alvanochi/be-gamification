import express from 'express';
import cors from 'cors';
import routes from './routes/index.ts';
import errorHandler from './middlewares/error.middleware.ts';
import { UPLOAD_DIR } from './modules/upload/upload.route.ts';

const app = express();

app.use(
  cors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'ngrok-skip-browser-warning',
      'x-requested-with',
      'Accept',
      'Origin',
    ],
  }),
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/api', routes);

// Media peserta dilayani dari server yang sama dengan API-nya. Disimpan lama
// karena nama berkasnya acak dan tidak pernah dipakai ulang.
app.use(
  '/uploads',
  express.static(UPLOAD_DIR, {
    maxAge: '30d',
    immutable: true,
    // Berkas berasal dari unggahan peserta — jangan biarkan peramban menebak
    // tipenya lalu menjalankan isinya.
    setHeaders: res => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.setHeader('X-Content-Type-Options', 'nosniff');
    },
  }),
);

app.use((_req, res) => {
  res.status(404).json({
    code: 404,
    status: 'failed',
    message: 'Route not found',
    data: null,
  });
});

app.use(errorHandler);

export default app;
