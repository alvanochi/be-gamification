import express from 'express';
import cors from 'cors';
import routes from './routes/index.ts';
import errorHandler from './middlewares/error.middleware.ts';

const app = express();

app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/api', routes);

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
