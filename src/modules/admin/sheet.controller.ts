import type { Request, Response, NextFunction } from 'express';
import * as XLSX from 'xlsx';
import { nanoid } from 'nanoid';
import bcrypt from 'bcrypt';
import { eq, sql, inArray, asc } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { users } from '../../db/schema/users.ts';
import { groups } from '../../db/schema/groups.ts';
import { groupCategories } from '../../db/schema/group_categories.ts';
import catchAsync from '../../utils/catchAsync.ts';
import response from '../../utils/response.ts';
import ApiError from '../../utils/ApiError.ts';
import { ensureAdmin, ensureSuperAdmin } from '../../utils/roles.ts';

/**
 * Pertukaran data lewat lembar kerja.
 *
 * Daftar peserta acara ini hidup di spreadsheet jauh sebelum sistemnya ada, dan
 * panitia lebih cepat menata kelompok di sana daripada lewat layar. Jadi
 * alih-alih memaksa mereka mengetik ulang tiga ratus baris, sistem menerima
 * berkasnya apa adanya — dan mengeluarkan kembali dalam bentuk yang sama.
 */

/** Header yang dikenali, dalam beberapa ejaan yang wajar dipakai panitia. */
const COLUMN_ALIASES: Record<string, string[]> = {
  fullname: ['nama', 'nama lengkap', 'fullname', 'full name', 'name'],
  phoneNumber: ['nomor telepon', 'no telepon', 'no hp', 'nohp', 'telepon', 'hp', 'phone', 'phonenumber', 'whatsapp', 'wa'],
  email: ['email', 'e-mail', 'surel'],
  businessName: ['nama usaha', 'usaha', 'umkm', 'bisnis', 'business', 'businessname'],
  groupName: ['kelompok', 'nama kelompok', 'tim', 'nama tim', 'group', 'groupname'],
  categoryName: ['kategori', 'rombongan', 'category'],
};

const normaliseHeader = (raw: string) => {
  const key = String(raw ?? '').trim().toLowerCase();
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    if (aliases.includes(key)) return field;
  }
  return null;
};

/** Ubah satu baris lembar menjadi bentuk yang dikenali sistem. */
const mapRow = (row: Record<string, unknown>) => {
  const mapped: Record<string, string> = {};
  for (const [header, value] of Object.entries(row)) {
    const field = normaliseHeader(header);
    if (!field) continue;
    const text = String(value ?? '').trim();
    if (text) mapped[field] = text;
  }
  return mapped;
};

/**
 * Nomor telepon dari spreadsheet nyaris selalu rusak: Excel membuang nol di
 * depan, kadang menyimpannya sebagai angka, kadang menuliskannya +62.
 * Dikembalikan ke bentuk 08xxxx supaya cocok dengan yang diketik peserta.
 */
const normalisePhone = (raw: string) => {
  let digits = String(raw).replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (digits.startsWith('62')) digits = '0' + digits.slice(2);
  else if (!digits.startsWith('0')) digits = '0' + digits;
  return digits;
};

const readSheet = (buffer: Buffer) => {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw ApiError.badRequest('Berkas tidak berisi lembar apa pun');
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName], { defval: '' });
};

/**
 * Berkas contoh untuk diisi panitia.
 *
 * Menyertakan barisnya sendiri sebagai contoh isian — header kosong hampir
 * selalu dijawab dengan tebakan format yang salah.
 */
export const downloadAccountTemplate = catchAsync(async (req: Request, res: Response) => {
  await ensureAdmin(req.user?.id as string);

  const rows = [
    {
      Nama: 'Siti Rahayu',
      'Nomor Telepon': '081234567890',
      Email: 'siti@contoh.com',
      'Nama Usaha': 'Batik Siti',
      Kelompok: '',
      Kategori: '',
    },
  ];

  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [{ wch: 28 }, { wch: 18 }, { wch: 26 }, { wch: 24 }, { wch: 18 }, { wch: 16 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Peserta');

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="template-peserta.xlsx"');
  return res.send(buffer);
});

/**
 * Unduh daftar akun beserta susunan kelompoknya.
 *
 * Kolom Kelompok dan Kategori sengaja bisa disunting lalu diunggah kembali:
 * panitia menata pembagian di spreadsheet — tempat mereka paling cepat
 * bekerja — dan sistem tinggal mengikutinya.
 */
export const exportAccounts = catchAsync(async (req: Request, res: Response) => {
  await ensureAdmin(req.user?.id as string);

  const rows = await db
    .select({
      fullname: users.fullname,
      phoneNumber: users.phoneNumber,
      email: users.email,
      businessName: users.businessName,
      role: users.role,
      checkInAt: users.checkInAt,
      groupName: groups.name,
      categoryName: groupCategories.name,
    })
    .from(users)
    .leftJoin(groups, eq(groups.id, users.groupId))
    .leftJoin(groupCategories, eq(groupCategories.id, groups.categoryId))
    .orderBy(asc(users.fullname));

  const sheetRows = rows.map(r => ({
    Nama: r.fullname,
    'Nomor Telepon': r.phoneNumber ?? '',
    Email: r.email ?? '',
    'Nama Usaha': r.businessName ?? '',
    Peran: r.role,
    Hadir: r.checkInAt ? 'Ya' : 'Belum',
    Kelompok: r.groupName ?? '',
    Kategori: r.categoryName ?? '',
  }));

  const ws = XLSX.utils.json_to_sheet(sheetRows);
  ws['!cols'] = [
    { wch: 28 }, { wch: 18 }, { wch: 26 }, { wch: 24 },
    { wch: 14 }, { wch: 10 }, { wch: 20 }, { wch: 16 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Peserta');

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="daftar-peserta.xlsx"');
  return res.send(buffer);
});

/**
 * Unggah daftar peserta.
 *
 * Baris yang nomor teleponnya sudah terdaftar diperbarui, bukan digandakan —
 * panitia biasanya mengunggah ulang berkas yang sama setelah menambal
 * beberapa baris, dan menggandakan peserta di hari-H jauh lebih merepotkan
 * daripada menimpa data yang memang sudah benar.
 *
 * Kolom Kelompok dan Kategori bersifat opsional; bila terisi, kelompok dan
 * kategorinya dibuatkan sesuai nama yang tertulis.
 */
export const importAccounts = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  await ensureAdmin(req.user?.id as string);
  if (!req.file) return next(ApiError.badRequest('Pilih berkas .xlsx atau .csv terlebih dahulu'));

  const raw = readSheet(req.file.buffer);
  if (!raw.length) return next(ApiError.badRequest('Lembar pertama tidak berisi baris data'));

  const created: string[] = [];
  const updated: string[] = [];
  const skipped: Array<{ row: number; name: string; reason: string }> = [];

  // Nama kelompok & kategori dikumpulkan dulu supaya tidak dibuat berulang.
  const groupCache = new Map<string, string>();
  const categoryCache = new Map<string, string>();

  const findOrCreateCategory = async (name: string) => {
    const key = name.toLowerCase();
    if (categoryCache.has(key)) return categoryCache.get(key)!;

    const [found] = await db.select({ id: groupCategories.id }).from(groupCategories)
      .where(sql`LOWER(${groupCategories.name}) = ${key}`).limit(1);

    if (found) {
      categoryCache.set(key, found.id);
      return found.id;
    }

    const id = nanoid(16);
    // Warna bawaan; panitia menyesuaikannya nanti di panel kategori.
    await db.insert(groupCategories).values({ id, name, color: '#8A8A8A' });
    categoryCache.set(key, id);
    return id;
  };

  const findOrCreateGroup = async (name: string, categoryId: string | null) => {
    const key = name.toLowerCase();
    if (groupCache.has(key)) return groupCache.get(key)!;

    const [found] = await db.select({ id: groups.id }).from(groups)
      .where(sql`LOWER(${groups.name}) = ${key}`).limit(1);

    if (found) {
      if (categoryId) {
        await db.update(groups).set({ categoryId, updatedAt: new Date() }).where(eq(groups.id, found.id));
      }
      groupCache.set(key, found.id);
      return found.id;
    }

    const id = nanoid(16);
    await db.insert(groups).values({ id, name, categoryId, startedAt: new Date() });
    groupCache.set(key, id);
    return id;
  };

  for (const [index, rawRow] of raw.entries()) {
    // +2: satu untuk baris header, satu lagi karena nomor baris Excel mulai dari 1.
    const rowNo = index + 2;
    const row = mapRow(rawRow);

    if (!row.fullname) {
      skipped.push({ row: rowNo, name: '—', reason: 'Kolom nama kosong' });
      continue;
    }
    if (!row.phoneNumber) {
      skipped.push({ row: rowNo, name: row.fullname, reason: 'Nomor telepon kosong' });
      continue;
    }

    const phone = normalisePhone(row.phoneNumber);
    if (phone.length < 8) {
      skipped.push({ row: rowNo, name: row.fullname, reason: `Nomor telepon tidak wajar (${phone})` });
      continue;
    }

    const email = row.email ? row.email.toLowerCase() : null;

    let categoryId: string | null = null;
    if (row.categoryName) categoryId = await findOrCreateCategory(row.categoryName);

    let groupId: string | null = null;
    if (row.groupName) groupId = await findOrCreateGroup(row.groupName, categoryId);

    const [existing] = await db.select({ id: users.id }).from(users)
      .where(eq(users.phoneNumber, phone)).limit(1);

    if (existing) {
      await db.update(users).set({
        fullname: row.fullname,
        businessName: row.businessName ?? null,
        // Nomor telepon merangkap kata sandi, jadi hash-nya ikut disegarkan.
        password: await bcrypt.hash(phone, 10),
        ...(email ? { email } : {}),
        ...(groupId ? { groupId } : {}),
        updatedAt: new Date(),
      }).where(eq(users.id, existing.id));
      updated.push(row.fullname);
      continue;
    }

    if (email) {
      const [dupEmail] = await db.select({ id: users.id }).from(users)
        .where(eq(users.email, email)).limit(1);
      if (dupEmail) {
        skipped.push({ row: rowNo, name: row.fullname, reason: `Email ${email} sudah dipakai akun lain` });
        continue;
      }
    }

    await db.insert(users).values({
      id: nanoid(16),
      fullname: row.fullname,
      phoneNumber: phone,
      email,
      businessName: row.businessName ?? null,
      role: 'PARTICIPANT',
      password: await bcrypt.hash(phone, 10),
      qrToken: nanoid(32),
      groupId,
    });
    created.push(row.fullname);
  }

  return response(res, 200, `${created.length} peserta baru, ${updated.length} diperbarui`, {
    created: created.length,
    updated: updated.length,
    skipped,
  });
});

/**
 * Unduh susunan kelompok, satu baris per anggota.
 *
 * Dipakai panitia sebagai lembar kerja lapangan dan sebagai bahan untuk
 * menyusun ulang pembagian sebelum diunggah kembali.
 */
export const exportGroups = catchAsync(async (req: Request, res: Response) => {
  await ensureAdmin(req.user?.id as string);

  const rows = await db
    .select({
      groupName: groups.name,
      groupScore: groups.score,
      categoryName: groupCategories.name,
      memberName: users.fullname,
      phoneNumber: users.phoneNumber,
      isLeader: sql<boolean>`${groups.leaderId} = ${users.id}`,
    })
    .from(groups)
    .leftJoin(users, eq(users.groupId, groups.id))
    .leftJoin(groupCategories, eq(groupCategories.id, groups.categoryId))
    .orderBy(asc(groups.name), asc(users.fullname));

  const sheetRows = rows.map(r => ({
    Kelompok: r.groupName,
    Kategori: r.categoryName ?? '',
    Poin: r.groupScore,
    Anggota: r.memberName ?? '(belum ada anggota)',
    'Nomor Telepon': r.phoneNumber ?? '',
    Ketua: r.isLeader ? 'Ya' : '',
  }));

  const ws = XLSX.utils.json_to_sheet(sheetRows);
  ws['!cols'] = [{ wch: 22 }, { wch: 16 }, { wch: 8 }, { wch: 28 }, { wch: 18 }, { wch: 8 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Kelompok');

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="susunan-kelompok.xlsx"');
  return res.send(buffer);
});

/**
 * Unggah susunan kelompok yang sudah ditata panitia di spreadsheet.
 *
 * Ini jalur alternatif dari tombol Generate Kelompok: alih-alih membiarkan
 * sistem mengacak, panitia menentukan sendiri siapa sekelompok dengan siapa —
 * dan berapa orang per kelompok, karena itu semata jumlah baris yang mereka
 * beri nama kelompok yang sama.
 *
 * Peserta dicocokkan lewat nomor telepon; nama terlalu sering berbeda ejaan.
 */
export const importGroups = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  await ensureSuperAdmin(req.user?.id as string);
  if (!req.file) return next(ApiError.badRequest('Pilih berkas .xlsx atau .csv terlebih dahulu'));

  const raw = readSheet(req.file.buffer);
  if (!raw.length) return next(ApiError.badRequest('Lembar pertama tidak berisi baris data'));

  const groupCache = new Map<string, string>();
  const categoryCache = new Map<string, string>();
  let placed = 0;
  const skipped: Array<{ row: number; name: string; reason: string }> = [];

  for (const [index, rawRow] of raw.entries()) {
    const rowNo = index + 2;
    const row = mapRow(rawRow);

    const label = row.fullname || row.phoneNumber || '—';

    if (!row.groupName) {
      skipped.push({ row: rowNo, name: label, reason: 'Kolom kelompok kosong' });
      continue;
    }
    if (!row.phoneNumber) {
      skipped.push({ row: rowNo, name: label, reason: 'Nomor telepon kosong — tidak bisa dicocokkan' });
      continue;
    }

    const phone = normalisePhone(row.phoneNumber);
    const [participant] = await db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.phoneNumber, phone))
      .limit(1);

    if (!participant) {
      skipped.push({ row: rowNo, name: label, reason: `Tidak ada peserta dengan nomor ${phone}` });
      continue;
    }
    if (participant.role !== 'PARTICIPANT') {
      skipped.push({ row: rowNo, name: label, reason: 'Akun panitia tidak bisa dimasukkan ke kelompok' });
      continue;
    }

    let categoryId: string | null = null;
    if (row.categoryName) {
      const key = row.categoryName.toLowerCase();
      if (categoryCache.has(key)) {
        categoryId = categoryCache.get(key)!;
      } else {
        const [found] = await db.select({ id: groupCategories.id }).from(groupCategories)
          .where(sql`LOWER(${groupCategories.name}) = ${key}`).limit(1);
        if (found) categoryId = found.id;
        else {
          categoryId = nanoid(16);
          await db.insert(groupCategories).values({ id: categoryId, name: row.categoryName, color: '#8A8A8A' });
        }
        categoryCache.set(key, categoryId);
      }
    }

    const groupKey = row.groupName.toLowerCase();
    let groupId = groupCache.get(groupKey) ?? null;

    if (!groupId) {
      const [found] = await db.select({ id: groups.id }).from(groups)
        .where(sql`LOWER(${groups.name}) = ${groupKey}`).limit(1);

      if (found) {
        groupId = found.id;
        if (categoryId) {
          await db.update(groups).set({ categoryId, updatedAt: new Date() }).where(eq(groups.id, found.id));
        }
      } else {
        groupId = nanoid(16);
        await db.insert(groups).values({
          id: groupId,
          name: row.groupName,
          categoryId,
          // Hitung mundur pembentukan mulai berjalan begitu kelompoknya ada.
          startedAt: new Date(),
        });
      }
      groupCache.set(groupKey, groupId);
    }

    await db.update(users)
      .set({ groupId, updatedAt: new Date() })
      .where(eq(users.id, participant.id));
    placed += 1;
  }

  return response(res, 200, `${placed} peserta ditempatkan ke ${groupCache.size} kelompok`, {
    placed,
    groups: groupCache.size,
    skipped,
  });
});
