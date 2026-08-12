import { Router } from 'express';
import { asc, eq } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { sponsors } from '../../db/schema/sponsors.ts';
import catchAsync from '../../utils/catchAsync.ts';
import response from '../../utils/response.ts';

const router = Router();

/**
 * Daftar sponsor aktif untuk ditampilkan di sisi peserta (footer, halaman
 * kelompok, badge misi). Sengaja publik dan tanpa autentikasi: landing page
 * memakainya sebelum ada sesi, dan datanya memang untuk dipamerkan.
 * Field internal seperti impressions/clicks tidak ikut dikirim.
 */
router.get(
  '/',
  catchAsync(async (_req, res) => {
    const rows = await db
      .select({
        id: sponsors.id,
        name: sponsors.name,
        logoUrl: sponsors.logoUrl,
        linkUrl: sponsors.linkUrl,
        orderNum: sponsors.orderNum,
      })
      .from(sponsors)
      .where(eq(sponsors.isActive, true))
      .orderBy(asc(sponsors.orderNum), asc(sponsors.name));

    response(res, 200, 'Sponsors fetched', rows);
  }),
);

export default router;
