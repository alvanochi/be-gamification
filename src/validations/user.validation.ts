import Joi from 'joi';

export const registerSchema = Joi.object({
  email: Joi.string().email().trim().required().messages({
    'string.empty': 'Email is required',
    'string.email': 'Email must be a valid email',
    'any.required': 'Email is required',
  }),
  password: Joi.string().min(6).required().messages({
    'string.empty': 'Password is required',
    'string.min': 'Password must be at least 6 characters',
    'any.required': 'Password is required',
  }),
  fullname: Joi.string().trim().required().messages({
    'string.empty': 'Fullname is required',
    'any.required': 'Fullname is required',
  }),
});

export const updateProfileSchema = Joi.object({
  fullname: Joi.string().trim().optional().messages({
    'string.empty': 'Fullname cannot be empty',
  }),
  email: Joi.string().email().trim().optional().messages({
    'string.email': 'Email must be a valid email',
  }),
});

export interface RegisterInput {
  email: string;
  password: string;
  fullname: string;
}

export interface UpdateProfileInput {
  fullname?: string;
  email?: string;
}
