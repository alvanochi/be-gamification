import type { Request, Response, NextFunction } from 'express';
import catchAsync from '../../utils/catchAsync.ts';
import response from '../../utils/response.ts';
import ApiError from '../../utils/ApiError.ts';
import { createUser, getUserById, getProfile, updateProfile, checkEmailExists } from './user.service.ts';

export const createUserHandler = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const { email, password, fullname } = req.body;

  const isEmailExist = await checkEmailExists(email);
  if (isEmailExist) {
    return next(ApiError.badRequest('Email sudah terdaftar'));
  }

  const result = await createUser({ email, password, fullname });

  if (!result) {
    return next(ApiError.badRequest('Gagal menambahkan user'));
  }

  return response(res, 201, 'User berhasil ditambahkan', result);
});

export const getUserByIdHandler = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const id = req.params.id as string;
  const user = await getUserById(id);

  if (!user) {
    return next(ApiError.notFound('User not found'));
  }

  return response(res, 200, 'User fetched successfully', user);
});

export const getProfileHandler = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const userId = req.user?.id as string;
  const profile = await getProfile(userId);

  if (!profile) {
    return next(ApiError.notFound('Profile not found'));
  }

  return response(res, 200, 'Profile fetched successfully', profile);
});

export const updateProfileHandler = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const userId = req.user?.id as string;
  const result = await updateProfile(userId, req.body);

  if (!result) {
    return next(ApiError.notFound('User not found'));
  }

  if ('error' in result) {
    return next(ApiError.badRequest(result.error));
  }

  return response(res, 200, 'Profile updated successfully', result);
});
