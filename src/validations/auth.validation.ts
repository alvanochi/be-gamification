import Joi from 'joi';

export const loginSchema = Joi.object({
  email: Joi.string().email().required().messages({
    'string.empty': 'Email is required',
    'string.email': 'Email must be a valid email',
    'any.required': 'Email is required',
  }),
  password: Joi.string().required().messages({
    'string.empty': 'Password is required',
    'any.required': 'Password is required',
  }),
});

export const refreshTokenSchema = Joi.object({
  refreshToken: Joi.string().required().messages({
    'string.empty': 'Refresh Token is required',
    'any.required': 'Refresh Token is required',
  }),
  userId: Joi.string().optional(),
});

export interface LoginInput {
  email: string;
  password: string;
}

export interface RefreshTokenInput {
  userId: string;
  refreshToken: string;
}
