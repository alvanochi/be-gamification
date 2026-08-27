import express from 'express';
import cors from 'cors';
import routes from './routes/index.ts';
import errorHandler from './middlewares/error.middleware.ts';
import { UPLOAD_DIR } from './modules/upload/upload.route.ts';

const app = express();

// 1. Fallback & Preflight Middleware: memastikan header CORS selalu terpasang
// untuk semua respon, termasuk preflight OPTIONS, rute 404, dan penanganan error.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, PUT, PATCH, POST, DELETE, OPTIONS');
  const requestedHeaders = req.headers['access-control-request-headers'];
  if (requestedHeaders) {
    res.setHeader('Access-Control-Allow-Headers', requestedHeaders);
  } else {
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept, Authorization, ngrok-skip-browser-warning, Baggage, Sentry-Trace, Cache-Control, Pragma',
    );
  }
  res.setHeader('Access-Control-Expose-Headers', 'Set-Cookie, Authorization');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

const corsOptions: cors.CorsOptions = {
  origin: (_origin, callback) => {
    // Izinkan semua origin (Vercel, localhost, dll) dan refleksikan secara dinamis
    // agar kompatibel penuh dengan credentials: true
    callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));

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
    setHeaders: (res, _path, _stat) => {
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
