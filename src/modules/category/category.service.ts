import { eq, sql, inArray, asc } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../../db/index.ts';
import { groupCategories } from '../../db/schema/group_categories.ts';
import { groups } from '../../db/schema/groups.ts';
import ApiError from '../../utils/ApiError.ts';
import { broadcast } from '../../realtime/hub.ts';

const HEX = /^#[0-9a-fA-F]{6}$/;

export const listCategories = async () => {
  const rows = await db
    .select()
    .from(groupCategories)
    .orderBy(asc(groupCategories.sortOrder), asc(groupCategories.name));

  // Jumlah kelompok per kategori dipakai panel untuk menunjukkan sebaran, dan
  // untuk mencegah penghapusan kategori yang masih terpakai.
  const counts = await db
    .select({ categoryId: groups.categoryId, total: sql<number>`count(*)::int` })
    .from(groups)
    .groupBy(groups.categoryId);

  const byId = new Map(counts.map(c => [c.categoryId, c.total]));
  return rows.map(c => ({ ...c, groupCount: byId.get(c.id) ?? 0 }));
};

export const createCategory = async (name: string, color: string, sortOrder = 0) => {
  const trimmed = (name ?? '').trim();
  if (trimmed.length < 2) throw ApiError.badRequest('Nama kategori minimal 2 karakter');
  if (!HEX.test(color ?? '')) throw ApiError.badRequest('Warna harus berupa kode heksadesimal, mis. #E8543F');

  const [taken] = await db.select({ id: groupCategories.id }).from(groupCategories)
    .where(sql`LOWER(${groupCategories.name}) = LOWER(${trimmed})`).limit(1);
  if (taken) throw ApiError.badRequest('Kategori dengan nama ini sudah ada');

  const id = nanoid(16);
  await db.insert(groupCategories).values({ id, name: trimmed, color, sortOrder });
  broadcast('categories:changed', {});
  return { id };
};

export const updateCategory = async (
  id: string,
  patch: { name?: string; color?: string; sortOrder?: number },
) => {
  const [existing] = await db.select().from(groupCategories).where(eq(groupCategories.id, id)).limit(1);
  if (!existing) throw ApiError.notFound('Kategori tidak ditemukan');

  if (patch.color !== undefined && !HEX.test(patch.color)) {
    throw ApiError.badRequest('Warna harus berupa kode heksadesimal, mis. #E8543F');
  }
  if (patch.name !== undefined) {
    const trimmed = patch.name.trim();
    if (trimmed.length < 2) throw ApiError.badRequest('Nama kategori minimal 2 karakter');
    const [taken] = await db.select({ id: groupCategories.id }).from(groupCategories)
      .where(sql`LOWER(${groupCategories.name}) = LOWER(${trimmed})`).limit(1);
    if (taken && taken.id !== id) throw ApiError.badRequest('Kategori dengan nama ini sudah ada');
    patch.name = trimmed;
  }

  await db.update(groupCategories).set(patch).where(eq(groupCategories.id, id));
  broadcast('categories:changed', {});
  return { id };
};

/**
 * Menghapus kategori, dan melepas kelompok yang ada di dalamnya.
 *
 * Menolak penghapusan selama masih ada anggotanya memaksa panitia memindahkan
 * puluhan kelompok satu per satu hanya untuk membuang kategori yang salah
 * ketik. Kelompoknya sendiri tidak boleh ikut hilang — kategori hanya label,
 * bukan pemilik — jadi mereka dilepas menjadi tanpa kategori.
 */
export const deleteCategory = async (id: string) => {
  const [existing] = await db.select().from(groupCategories)
    .where(eq(groupCategories.id, id)).limit(1);
  if (!existing) throw ApiError.notFound('Kategori tidak ditemukan');

  const released = await db
    .update(groups)
    .set({ categoryId: null, updatedAt: new Date() })
    .where(eq(groups.categoryId, id))
    .returning({ id: groups.id });

  await db.delete(groupCategories).where(eq(groupCategories.id, id));
  broadcast('categories:changed', {});

  return { released: released.length };
};

/** Menempatkan kelompok-kelompok tertentu ke satu kategori sekaligus. */
export const assignGroups = async (categoryId: string | null, groupIds: string[]) => {
  if (!groupIds.length) throw ApiError.badRequest('Pilih kelompok terlebih dahulu');

  if (categoryId) {
    const [category] = await db.select().from(groupCategories)
      .where(eq(groupCategories.id, categoryId)).limit(1);
    if (!category) throw ApiError.notFound('Kategori tidak ditemukan');
  }

  await db.update(groups)
    .set({ categoryId, updatedAt: new Date() })
    .where(inArray(groups.id, groupIds));

  broadcast('categories:changed', {});
  return { assigned: groupIds.length };
};

/**
 * Membagi seluruh kelompok yang belum berkategori secara merata dan acak.
 *
 * Dipakai panitia ketika kategori hanya perlu memecah peserta jadi beberapa
 * rombongan yang seimbang, tanpa kriteria khusus.
 */
export const distributeGroups = async () => {
  const categories = await db.select().from(groupCategories)
    .orderBy(asc(groupCategories.sortOrder), asc(groupCategories.name));
  if (!categories.length) throw ApiError.badRequest('Belum ada kategori. Buat kategorinya dulu.');

  const pending = await db.select({ id: groups.id }).from(groups)
    .where(sql`${groups.categoryId} IS NULL`);
  if (!pending.length) {
    throw ApiError.badRequest('Semua kelompok sudah punya kategori.');
  }

  // Fisher–Yates, supaya urutan pembentukan kelompok tidak menentukan
  // kategorinya.
  const shuffled = [...pending];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const perCategory: Record<string, string[]> = {};
  shuffled.forEach((g, i) => {
    const cat = categories[i % categories.length];
    (perCategory[cat.id] ??= []).push(g.id);
  });

  for (const [categoryId, ids] of Object.entries(perCategory)) {
    await db.update(groups)
      .set({ categoryId, updatedAt: new Date() })
      .where(inArray(groups.id, ids));
  }

  broadcast('categories:changed', {});
  return {
    distributed: shuffled.length,
    perCategory: categories.map(c => ({
      id: c.id,
      name: c.name,
      added: perCategory[c.id]?.length ?? 0,
    })),
  };
};
