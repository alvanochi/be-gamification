import type { Request, Response, NextFunction } from 'express';
import * as XLSX from 'xlsx';
import { nanoid } from 'nanoid';
import bcrypt from 'bcrypt';
import { eq, sql, asc } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { users } from '../../db/schema/users.ts';
import { groups } from '../../db/schema/groups.ts';
import catchAsync from '../../utils/catchAsync.ts';
import response from '../../utils/response.ts';
import ApiError from '../../utils/ApiError.ts';
import { ensureSuperAdmin } from '../../utils/roles.ts';

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
  gender: ['jenis kelamin', 'kelamin', 'gender', 'l/p', 'jk'],
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
 * Jenis kelamin ditulis panitia dengan bermacam cara: "L", "Laki-laki", "P",
 * "Perempuan", kadang "Pria"/"Wanita". Semuanya dikerucutkan ke satu huruf.
 */
const normaliseGender = (raw?: string): 'L' | 'P' | null => {
  const value = String(raw ?? '').trim().toUpperCase();
  if (!value) return null;
  if (value.startsWith('L') || value.startsWith('M') || value.startsWith('PRIA')) return 'L';
  if (value.startsWith('P') || value.startsWith('W') || value.startsWith('F')) return 'P';
  return null;
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
  await ensureSuperAdmin(req.user?.id as string);

  const rows = [
    {
      Nama: 'Alvano Hastagina',
      'Nomor Telepon': '081297727009',
      Email: 'alvanhastagina@gmail.com',
      'Nama Usaha': 'Usaha kecap',
      Kelompok: 'Kelompok 1',
    },
  ];

  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [{ wch: 28 }, { wch: 18 }, { wch: 26 }, { wch: 24 }, { wch: 20 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Peserta');

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="template-peserta.xlsx"');
  return res.send(buffer);
});

/**
 * Unduh daftar akun beserta susunan kelompoknya — satu lembar untuk keduanya.
 *
 * Dulu ada dua lembar berisi orang yang sama: satu untuk data peserta, satu
 * lagi untuk pembagian kelompok. Panitia harus menyunting keduanya dan menjaga
 * agar keduanya tetap sepakat. Kolom Kelompok kini menempel pada barisnya
 * sendiri: mengisinya berarti kelompok itu dibuat dan peserta itu ditempatkan
 * di dalamnya, sekali unggah.
 */
export const exportAccounts = catchAsync(async (req: Request, res: Response) => {
  await ensureSuperAdmin(req.user?.id as string);

  const rows = await db
    .select({
      fullname: users.fullname,
      phoneNumber: users.phoneNumber,
      email: users.email,
      businessName: users.businessName,
      gender: users.gender,
      role: users.role,
      checkInAt: users.checkInAt,
      groupName: groups.name,
    })
    .from(users)
    .leftJoin(groups, eq(groups.id, users.groupId))
    .orderBy(asc(users.fullname));

  const sheetRows = rows.map(r => ({
    Nama: r.fullname,
    'Nomor Telepon': r.phoneNumber ?? '',
    Email: r.email ?? '',
    'Jenis Kelamin': r.gender ?? '',
    'Nama Usaha': r.businessName ?? '',
    Peran: r.role,
    Hadir: r.checkInAt ? 'Ya' : 'Belum',
    Kelompok: r.groupName ?? '',
  }));

  const ws = XLSX.utils.json_to_sheet(sheetRows);
  ws['!cols'] = [
    { wch: 28 }, { wch: 18 }, { wch: 26 }, { wch: 14 }, { wch: 24 },
    { wch: 14 }, { wch: 10 }, { wch: 20 },
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
 * Kolom Kelompok dan Jenis Kelamin bersifat opsional; bila Kelompok terisi,
 * kelompoknya dibuatkan sesuai nama yang tertulis lalu peserta baris itu
 * langsung ditempatkan di dalamnya.
 */
export const importAccounts = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  await ensureSuperAdmin(req.user?.id as string);
  if (!req.file) return next(ApiError.badRequest('Pilih berkas .xlsx atau .csv terlebih dahulu'));

  const raw = readSheet(req.file.buffer);
  if (!raw.length) return next(ApiError.badRequest('Lembar pertama tidak berisi baris data'));

  const created: string[] = [];
  const updated: string[] = [];
  const skipped: Array<{ row: number; name: string; reason: string }> = [];

  // Nama kelompok dikumpulkan dulu supaya tidak dibuat berulang.
  const groupCache = new Map<string, string>();

  const findOrCreateGroup = async (name: string) => {
    const key = name.toLowerCase();
    if (groupCache.has(key)) return groupCache.get(key)!;

    const [found] = await db.select({ id: groups.id }).from(groups)
      .where(sql`LOWER(${groups.name}) = ${key}`).limit(1);

    if (found) {
      groupCache.set(key, found.id);
      return found.id;
    }

    const id = nanoid(16);
    // Hitung mundurnya baru berjalan saat anggota pertama masuk — lihat
    // markCheckedIn di user.service.
    await db.insert(groups).values({ id, name });
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

    let groupId: string | null = null;
    if (row.groupName) groupId = await findOrCreateGroup(row.groupName);

    const [existing] = await db.select({ id: users.id }).from(users)
      .where(eq(users.phoneNumber, phone)).limit(1);

    const gender = normaliseGender(row.gender);

    if (existing) {
      await db.update(users).set({
        fullname: row.fullname,
        businessName: row.businessName ?? null,
        // Kolom yang dikosongkan panitia tidak menghapus data yang sudah ada —
        // lembar kerja sering diunggah ulang hanya untuk menambal satu kolom.
        ...(gender ? { gender } : {}),
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
      gender,
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
