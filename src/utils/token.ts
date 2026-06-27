import jwt from 'jsonwebtoken';
import env from '../config/env.ts';
import type { AuthPayload } from '../middlewares/auth.middleware.ts';
import ApiError from './ApiError.ts';

export const generateAccessTokenHelper = (payload: AuthPayload): string => {
    return jwt.sign(payload, env.ACCESS_TOKEN_KEY, {
        expiresIn: env.ACCESS_TOKEN_AGE * 60,
    });
};

export const generateRefreshTokenHelper = (payload: AuthPayload): string => {
    return jwt.sign(payload, env.REFRESH_TOKEN_KEY, {
        expiresIn: env.REFRESH_TOKEN_AGE * 60,
    });
};

export const verifyRefreshTokenHelper = (token: string): AuthPayload => {
    try {
        return jwt.verify(token, env.REFRESH_TOKEN_KEY) as AuthPayload;
    } catch (error) {
        throw ApiError.unauthorized('Refresh token is invalid or expired');
    }
};

export const verifyAccessTokenHelper = (accessToken: string): AuthPayload => {
    try {
        return jwt.verify(accessToken, env.ACCESS_TOKEN_KEY) as AuthPayload;
    } catch {
        throw ApiError.unauthorized('Access token is invalid');
    }
}
