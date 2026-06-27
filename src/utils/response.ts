import type { Response } from 'express';

interface ApiResponse<T = any> {
  code: number;
  status: 'success' | 'failed';
  message: string;
  data: T | null;
}

const response = <T = any>(
  res: Response,
  statusCode: number,
  message: string,
  data: T | null = null,
): Response<ApiResponse<T>> => {
  return res.status(statusCode).json({
    code: statusCode,
    status: statusCode < 400 ? 'success' : 'failed',
    message,
    data,
  });
};

export default response;
