import type { Request, Response, NextFunction } from 'express';
import type { JwtPayload } from 'jsonwebtoken';
import ApiError from '../utils/ApiError.ts';
import { verifyAccessTokenHelper } from '../utils/token.ts';

export interface AuthPayload extends JwtPayload {
  id: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

const authenticate = (req: Request, _res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return next(ApiError.unauthorized('Missing or invalid authorization header'));
  }

  const token = authHeader.slice(7);

  try {
    req.user = verifyAccessTokenHelper(token);
    return next();
  } catch (error) {
    return next(error);
  }
};

export default authenticate;
