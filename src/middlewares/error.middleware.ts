import type { Request, Response, NextFunction } from 'express';
import ApiError from '../utils/ApiError.ts';
import env from '../config/env.ts';

const errorHandler = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
) => {
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      code: err.statusCode,
      status: 'failed',
      message: err.message,
      data: null,
    });
  }

  console.error('Unhandled error:', err);

  const statusCode = 500;
  const message =
    env.NODE_ENV === 'production'
      ? 'Internal Server Error'
      : err.message || 'Internal Server Error';

  return res.status(statusCode).json({
    code: statusCode,
    status: 'failed',
    message,
    data: null,
  });
};

export default errorHandler;
