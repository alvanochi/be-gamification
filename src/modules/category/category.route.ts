import { Router } from 'express';
import type { Request, Response } from 'express';
import authenticate from '../../middlewares/auth.middleware.ts';
import catchAsync from '../../utils/catchAsync.ts';
import responseHandler from '../../utils/response.ts';
import { ensureAdmin, ensureSuperAdmin } from '../../utils/roles.ts';
import * as categoryService from './category.service.ts';

const router = Router();
router.use(authenticate);

/**
 * Kategori kelompok — mis. rombongan Merah/Biru/Kuning.
 *
 * Membaca daftarnya cukup dengan hak panitia karena dipakai di layar
 * pemantauan; mengubahnya adalah pengaturan permainan, jadi khusus Super Admin.
 */
router.get('/', catchAsync(async (req: Request, res: Response) => {
  await ensureAdmin(req.user?.id as string);
  responseHandler(res, 200, 'Categories fetched', await categoryService.listCategories());
}));

router.post('/', catchAsync(async (req: Request, res: Response) => {
  await ensureSuperAdmin(req.user?.id as string);
  const { name, color, sortOrder } = req.body ?? {};
  const result = await categoryService.createCategory(name, color, sortOrder ?? 0);
  responseHandler(res, 201, 'Kategori dibuat', result);
}));

router.put('/:id', catchAsync(async (req: Request, res: Response) => {
  await ensureSuperAdmin(req.user?.id as string);
  const { name, color, sortOrder } = req.body ?? {};
  const patch: Record<string, unknown> = {};
  if (name !== undefined) patch.name = name;
  if (color !== undefined) patch.color = color;
  if (sortOrder !== undefined) patch.sortOrder = sortOrder;
  const result = await categoryService.updateCategory(req.params.id as string, patch);
  responseHandler(res, 200, 'Kategori diperbarui', result);
}));

router.delete('/:id', catchAsync(async (req: Request, res: Response) => {
  await ensureSuperAdmin(req.user?.id as string);
  await categoryService.deleteCategory(req.params.id as string);
  responseHandler(res, 200, 'Kategori dihapus', null);
}));

/** Penempatan manual: panitia memilih sendiri kelompok mana masuk mana. */
router.post('/assign', catchAsync(async (req: Request, res: Response) => {
  await ensureSuperAdmin(req.user?.id as string);
  const { categoryId, groupIds } = req.body ?? {};
  const result = await categoryService.assignGroups(categoryId ?? null, groupIds ?? []);
  responseHandler(res, 200, 'Kelompok dipindahkan', result);
}));

/** Penempatan acak dan merata untuk kelompok yang belum berkategori. */
router.post('/distribute', catchAsync(async (req: Request, res: Response) => {
  await ensureSuperAdmin(req.user?.id as string);
  const result = await categoryService.distributeGroups();
  responseHandler(res, 200, 'Kelompok dibagi ke kategori', result);
}));

export default router;
