import Joi from 'joi';

export const registerSchema = Joi.object({
  email: Joi.string().email().trim().required().messages({
    'string.empty': 'Email is required',
    'string.email': 'Email must be a valid email',
    'any.required': 'Email is required',
  }),
  phoneNumber: Joi.string().pattern(/^(?:\+62|08)[0-9]{8,13}$/).required().messages({
    'string.empty': 'Phone number is required',
    'string.pattern.base': 'Phone number must be a valid Indonesian format starting with +62 or 08',
    'any.required': 'Phone number is required',
  }),
  fullname: Joi.string().trim().required().messages({
    'string.empty': 'Fullname is required',
    'any.required': 'Fullname is required',
  }),
  businessName: Joi.string().trim().required().messages({
    'string.empty': 'Business name (UMKM) is required',
    'any.required': 'Business name (UMKM) is required',
  }),
  youtubeAccount: Joi.string().trim().required().messages({
    'string.empty': 'YouTube account is required',
    'any.required': 'YouTube account is required',
  }),
  instagramAccount: Joi.string().trim().required().messages({
    'string.empty': 'Instagram account is required',
    'any.required': 'Instagram account is required',
  }),
  tiktokAccount: Joi.string().trim().required().messages({
    'string.empty': 'TikTok account is required',
    'any.required': 'TikTok account is required',
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
  phoneNumber: string;
  fullname: string;
  businessName: string;
  youtubeAccount: string;
  instagramAccount: string;
  tiktokAccount: string;
}

export interface UpdateProfileInput {
  fullname?: string;
  email?: string;
}
