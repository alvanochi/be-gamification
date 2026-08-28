import type { Request, Response, NextFunction } from 'express';
import * as XLSX from 'xlsx';
import { nanoid } from 'nanoid';
import { eq, sql, asc } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { missions } from '../../db/schema/missions.ts';
import catchAsync from '../../utils/catchAsync.ts';
import response from '../../utils/response.ts';
import ApiError from '../../utils/ApiError.ts';
import { ensureSuperAdmin } from '../../utils/roles.ts';

/**
 * Misi lewat lembar kerja.
 *
 * Rangkaian misi acara ini disusun panitia di spreadsheet jauh sebelum
 * sistemnya ada — lengkap dengan sesi, lokasi, dan cara penilaiannya. Mengetik
 * ulang lima puluh misi lewat form satu per satu memakan waktu berjam-jam dan
 * setiap barisnya adalah satu kesempatan salah ketik.
 *
 * Soal kuis sengaja tidak ikut: bentuknya bertingkat (satu misi, banyak soal,
 * tiap soal banyak pilihan) dan tidak muat dalam satu baris tanpa menjadi
 * teka-teki sendiri. Misi kuis dibuat lewat lembar ini, soalnya disusun di
 * layar Kelola Pertanyaan.
 */

/** Judul kolom ↔ nilai enum. Panitia menulis bahasa Indonesia, bukan konstanta. */
const TYPE_MAP: Record<string, string> = {
  tantangan: 'TANTANGAN',
  'bigger better': 'BIGGER_BETTER',
  bigger_better: 'BIGGER_BETTER',
  barter: 'BIGGER_BETTER',
  'soal lokasi': 'SOAL_LOKASI',
  soal_lokasi: 'SOAL_LOKASI',
  kuis: 'KUIS',
};

const CATEGORY_MAP: Record<string, string> = {
  mandiri: 'MANDIRI',
  terstruktur: 'TERSTRUKTUR',
};

const PROOF_MAP: Record<string, string> = {
  foto: 'FOTO',
  video: 'VIDEO',
  'foto & video': 'FOTO_VIDEO',
  'foto dan video': 'FOTO_VIDEO',
  foto_video: 'FOTO_VIDEO',
  'link sosmed': 'LINK_SOSMED',
  'link sosial media': 'LINK_SOSMED',
  link_sosmed: 'LINK_SOSMED',
  'laporan petugas': 'LAPORAN_PETUGAS',
  laporan_petugas: 'LAPORAN_PETUGAS',
  'input hasil': 'INPUT_HASIL',
  input_hasil: 'INPUT_HASIL',
};

const CLUE_MAP: Record<string, string> = {
  '': 'NONE',
  'tanpa petunjuk': 'NONE',
  none: 'NONE',
  teks: 'TEKS',
  'petunjuk teks': 'TEKS',
  morse: 'MORSE',
  'sandi morse': 'MORSE',
  'sandi angka': 'SANDI_ANGKA',
  sandi_angka: 'SANDI_ANGKA',
  'foto lokasi': 'FOTO',
  foto: 'FOTO',
};

const SCORING_MAP: Record<string, string> = {
  '': 'FLAT',
  'poin tetap': 'FLAT',
  flat: 'FLAT',
  rentang: 'RANGE',
  range: 'RANGE',
  'per satuan': 'PER_UNIT',
  per_unit: 'PER_UNIT',
  waktu: 'TIME_BASED',
  'berdasarkan waktu': 'TIME_BASED',
  time_based: 'TIME_BASED',
  otomatis: 'AUTO_QUIZ',
  'otomatis dari jawaban': 'AUTO_QUIZ',
  auto_quiz: 'AUTO_QUIZ',
};

/** Label yang dipakai saat menulis lembarnya kembali. */
const TYPE_LABEL: Record<string, string> = {
  TANTANGAN: 'Tantangan',
  BIGGER_BETTER: 'Bigger Better',
  SOAL_LOKASI: 'Soal Lokasi',
  KUIS: 'Kuis',
};
const CATEGORY_LABEL: Record<string, string> = { MANDIRI: 'Mandiri', TERSTRUKTUR: 'Terstruktur' };
const PROOF_LABEL: Record<string, string> = {
  FOTO: 'Foto',
  VIDEO: 'Video',
  FOTO_VIDEO: 'Foto & Video',
  LINK_SOSMED: 'Link Sosmed',
  LAPORAN_PETUGAS: 'Laporan Petugas',
  INPUT_HASIL: 'Input Hasil',
};
const CLUE_LABEL: Record<string, string> = {
  NONE: 'Tanpa petunjuk',
  TEKS: 'Teks',
  MORSE: 'Morse',
  SANDI_ANGKA: 'Sandi Angka',
  GPS: 'GPS',
  FOTO: 'Foto Lokasi',
  MAP: 'Peta',
};
const SCORING_LABEL: Record<string, string> = {
  FLAT: 'Poin Tetap',
  RANGE: 'Rentang',
  PER_UNIT: 'Per Satuan',
  TIME_BASED: 'Berdasarkan Waktu',
  AUTO_QUIZ: 'Otomatis dari Jawaban',
};

const COLUMNS = [
  'Judul',
  'Deskripsi',
  'Tipe',
  'Kategori',
  'Poin',
  'Jumlah Pemain',
  'Pembuktian',
  'Lokasi',
  'Sesi Mulai',
  'Sesi Selesai',
  'Durasi (menit)',
  'Jenis Petunjuk',
  'Isi Petunjuk',
  'Cara Penilaian',
  'Poin Min',
  'Poin Maks',
  'Poin per Hasil',
  'Maks Hasil',
  'Waktu Acuan (detik)',
  'Wajib',
  'Wajib Check-in',
  'Yel-Yel',
] as const;

const COL_WIDTHS = [
  { wch: 28 }, { wch: 44 }, { wch: 16 }, { wch: 14 }, { wch: 8 }, { wch: 14 },
  { wch: 18 }, { wch: 24 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 16 },
  { wch: 28 }, { wch: 20 }, { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 12 },
  { wch: 18 }, { wch: 10 }, { wch: 16 }, { wch: 10 },
];

const pick = (row: Record<string, unknown>, column: string) =>
  String(row[column] ?? '').trim();

const asEnum = (map: Record<string, string>, value: string, fallback?: string) =>
  map[value.trim().toLowerCase()] ?? fallback;

/** "Ya"/"Y"/"TRUE"/"1" — panitia menulisnya bermacam-macam. */
const asBool = (value: string) => /^(ya|y|true|1|✓|v)$/i.test(value.trim());

const asInt = (value: string) => {
  const n = Number(String(value).replace(/[^\d-]/g, ''));
  return Number.isFinite(n) && String(value).trim() !== '' ? n : null;
};

/** Sesi ditulis "09:00" atau "09.00"; keduanya diterima. */
const asHhMm = (value: string) => {
  const match = /^(\d{1,2})[:.](\d{2})$/.exec(value.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

const readSheet = (buffer: Buffer) => {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw ApiError.badRequest('Berkas tidak berisi lembar apa pun');
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName], { defval: '' });
};

const sendWorkbook = (res: Response, rows: Record<string, unknown>[], filename: string) => {
  const ws = XLSX.utils.json_to_sheet(rows, { header: [...COLUMNS] });
  ws['!cols'] = COL_WIDTHS;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Misi');

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send(buffer);
};

/**
 * Berkas contoh, berisi tiga baris yang memperagakan cara penilaian berbeda —
 * header kosong hampir selalu dijawab dengan tebakan format yang salah.
 */
export const downloadMissionTemplate = catchAsync(async (req: Request, res: Response) => {
  await ensureSuperAdmin(req.user?.id as string);

  const rows = [
    {
      Judul: 'Foto di depan Tugu Jogja',
      Deskripsi: 'Seluruh anggota kelompok berfoto bersama menghadap Tugu.',
      Tipe: 'Tantangan',
      Kategori: 'Mandiri',
      Poin: 100,
      'Jumlah Pemain': 6,
      Pembuktian: 'Foto',
      Lokasi: 'Tugu Yogyakarta',
      'Sesi Mulai': '',
      'Sesi Selesai': '',
      'Durasi (menit)': '',
      'Jenis Petunjuk': 'Tanpa petunjuk',
      'Isi Petunjuk': '',
      'Cara Penilaian': 'Poin Tetap',
      'Poin Min': '',
      'Poin Maks': '',
      'Poin per Hasil': '',
      'Maks Hasil': '',
      'Waktu Acuan (detik)': '',
      Wajib: 'Tidak',
      'Wajib Check-in': 'Tidak',
      'Yel-Yel': 'Tidak',
    },
    {
      Judul: 'Jemparingan',
      Deskripsi: 'Tiap kelompok memanah; poin dihitung dari anak panah yang tepat sasaran.',
      Tipe: 'Tantangan',
      Kategori: 'Terstruktur',
      Poin: 0,
      'Jumlah Pemain': 3,
      Pembuktian: 'Laporan Petugas',
      Lokasi: 'Lapangan Kenari',
      'Sesi Mulai': '09:00',
      'Sesi Selesai': '12:00',
      'Durasi (menit)': 15,
      'Jenis Petunjuk': 'Tanpa petunjuk',
      'Isi Petunjuk': '',
      'Cara Penilaian': 'Per Satuan',
      'Poin Min': '',
      'Poin Maks': '',
      'Poin per Hasil': 50,
      'Maks Hasil': 5,
      'Waktu Acuan (detik)': '',
      Wajib: 'Tidak',
      'Wajib Check-in': 'Ya',
      'Yel-Yel': 'Tidak',
    },
    {
      Judul: 'Membatik',
      Deskripsi: 'Hasil batik dinilai panitia sesuai kerapian.',
      Tipe: 'Tantangan',
      Kategori: 'Terstruktur',
      Poin: 0,
      'Jumlah Pemain': 2,
      Pembuktian: 'Foto',
      Lokasi: 'Sanggar Batik',
      'Sesi Mulai': '13:00',
      'Sesi Selesai': '16:00',
      'Durasi (menit)': 30,
      'Jenis Petunjuk': 'Teks',
      'Isi Petunjuk': 'Cari bangunan bercat hijau di seberang pasar.',
      'Cara Penilaian': 'Rentang',
      'Poin Min': 50,
      'Poin Maks': 100,
      'Poin per Hasil': '',
      'Maks Hasil': '',
      'Waktu Acuan (detik)': '',
      Wajib: 'Tidak',
      'Wajib Check-in': 'Ya',
      'Yel-Yel': 'Tidak',
    },
  ];

  return sendWorkbook(res, rows, 'template-misi.xlsx');
});

/** Unduh seluruh misi dalam bentuk yang bisa disunting lalu diunggah kembali. */
export const exportMissions = catchAsync(async (req: Request, res: Response) => {
  await ensureSuperAdmin(req.user?.id as string);

  const rows = await db.select().from(missions).orderBy(asc(missions.createdAt));

  const sheetRows = rows.map(m => ({
    Judul: m.title,
    Deskripsi: m.description,
    Tipe: TYPE_LABEL[m.type] ?? m.type,
    Kategori: CATEGORY_LABEL[m.category] ?? m.category,
    Poin: m.pointWeight,
    'Jumlah Pemain': m.participantCount,
    Pembuktian: PROOF_LABEL[m.proofType] ?? m.proofType,
    Lokasi: m.locationName ?? '',
    'Sesi Mulai': m.sessionStart ?? '',
    'Sesi Selesai': m.sessionEnd ?? '',
    'Durasi (menit)': m.durationMinutes ?? '',
    'Jenis Petunjuk': CLUE_LABEL[m.clueType] ?? m.clueType,
    'Isi Petunjuk': m.clue ?? '',
    'Cara Penilaian': SCORING_LABEL[m.scoringMode] ?? m.scoringMode,
    'Poin Min': m.pointMin ?? '',
    'Poin Maks': m.pointMax ?? '',
    'Poin per Hasil': m.pointPerUnit ?? '',
    'Maks Hasil': m.maxUnits ?? '',
    'Waktu Acuan (detik)': m.timeTargetSeconds ?? '',
    Wajib: m.isMandatory ? 'Ya' : 'Tidak',
    'Wajib Check-in': m.requiresCheckIn ? 'Ya' : 'Tidak',
    'Yel-Yel': m.isYelYel ? 'Ya' : 'Tidak',
  }));

  return sendWorkbook(res, sheetRows, 'daftar-misi.xlsx');
});

/**
 * Unggah daftar misi.
 *
 * Misi dicocokkan lewat judulnya: baris yang judulnya sudah ada diperbarui,
 * bukan digandakan — panitia biasanya mengunggah ulang berkas yang sama setelah
 * menambal beberapa baris.
 */
export const importMissions = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  await ensureSuperAdmin(req.user?.id as string);
  if (!req.file) return next(ApiError.badRequest('Pilih berkas .xlsx atau .csv terlebih dahulu'));

  const raw = readSheet(req.file.buffer);
  if (!raw.length) return next(ApiError.badRequest('Lembar pertama tidak berisi baris data'));

  let created = 0;
  let updated = 0;
  const skipped: Array<{ row: number; name: string; reason: string }> = [];

  for (const [index, rawRow] of raw.entries()) {
    // +2: satu untuk baris header, satu lagi karena nomor baris Excel mulai dari 1.
    const rowNo = index + 2;
    const title = pick(rawRow, 'Judul');
    const description = pick(rawRow, 'Deskripsi');

    if (!title) {
      skipped.push({ row: rowNo, name: '—', reason: 'Kolom Judul kosong' });
      continue;
    }
    if (title.length < 3) {
      skipped.push({ row: rowNo, name: title, reason: 'Judul minimal 3 huruf' });
      continue;
    }
    if (!description) {
      skipped.push({ row: rowNo, name: title, reason: 'Kolom Deskripsi kosong' });
      continue;
    }

    const type = asEnum(TYPE_MAP, pick(rawRow, 'Tipe'));
    if (!type) {
      skipped.push({
        row: rowNo,
        name: title,
        reason: `Tipe "${pick(rawRow, 'Tipe')}" tidak dikenali (Tantangan / Bigger Better / Soal Lokasi / Kuis)`,
      });
      continue;
    }

    const scoringMode = asEnum(SCORING_MAP, pick(rawRow, 'Cara Penilaian'), 'FLAT')!;
    const pointMin = asInt(pick(rawRow, 'Poin Min'));
    const pointMax = asInt(pick(rawRow, 'Poin Maks'));
    const pointPerUnit = asInt(pick(rawRow, 'Poin per Hasil'));
    const timeTargetSeconds = asInt(pick(rawRow, 'Waktu Acuan (detik)'));

    // Tiap cara penilaian punya kolom pendukungnya sendiri. Misi yang tersimpan
    // tanpa itu tidak bisa dinilai siapa pun saat hari-H.
    if (scoringMode === 'RANGE' && (pointMin === null || pointMax === null)) {
      skipped.push({ row: rowNo, name: title, reason: 'Penilaian Rentang butuh Poin Min & Poin Maks' });
      continue;
    }
    if (scoringMode === 'PER_UNIT' && pointPerUnit === null) {
      skipped.push({ row: rowNo, name: title, reason: 'Penilaian Per Satuan butuh Poin per Hasil' });
      continue;
    }
    if (scoringMode === 'TIME_BASED' && timeTargetSeconds === null) {
      skipped.push({ row: rowNo, name: title, reason: 'Penilaian Berdasarkan Waktu butuh Waktu Acuan' });
      continue;
    }

    const sessionStart = asHhMm(pick(rawRow, 'Sesi Mulai'));
    const sessionEnd = asHhMm(pick(rawRow, 'Sesi Selesai'));
    if ((sessionStart === null) !== (sessionEnd === null)) {
      skipped.push({ row: rowNo, name: title, reason: 'Sesi Mulai & Sesi Selesai harus diisi bersamaan' });
      continue;
    }

    const clueType = asEnum(CLUE_MAP, pick(rawRow, 'Jenis Petunjuk'), 'NONE')!;
    const clue = pick(rawRow, 'Isi Petunjuk') || null;
    if (clueType !== 'NONE' && !clue) {
      skipped.push({ row: rowNo, name: title, reason: 'Jenis Petunjuk terisi tapi Isi Petunjuk kosong' });
      continue;
    }

    const values = {
      title,
      description,
      type: type as typeof missions.$inferInsert.type,
      category: (asEnum(CATEGORY_MAP, pick(rawRow, 'Kategori'), 'MANDIRI') as typeof missions.$inferInsert.category),
      pointWeight: asInt(pick(rawRow, 'Poin')) ?? 0,
      participantCount: asInt(pick(rawRow, 'Jumlah Pemain')) ?? 1,
      proofType: (asEnum(PROOF_MAP, pick(rawRow, 'Pembuktian'), 'FOTO') as typeof missions.$inferInsert.proofType),
      locationName: pick(rawRow, 'Lokasi') || null,
      sessionStart,
      sessionEnd,
      durationMinutes: asInt(pick(rawRow, 'Durasi (menit)')),
      clueType: clueType as typeof missions.$inferInsert.clueType,
      clue,
      scoringMode: scoringMode as typeof missions.$inferInsert.scoringMode,
      pointMin,
      pointMax,
      pointPerUnit,
      maxUnits: asInt(pick(rawRow, 'Maks Hasil')),
      timeTargetSeconds,
      isMandatory: asBool(pick(rawRow, 'Wajib')),
      requiresCheckIn: asBool(pick(rawRow, 'Wajib Check-in')),
      isYelYel: asBool(pick(rawRow, 'Yel-Yel')),
      updatedAt: new Date(),
    };

    const [existing] = await db
      .select({ id: missions.id })
      .from(missions)
      .where(sql`LOWER(${missions.title}) = ${title.toLowerCase()}`)
      .limit(1);

    if (existing) {
      await db.update(missions).set(values).where(eq(missions.id, existing.id));
      updated += 1;
    } else {
      await db.insert(missions).values({ id: nanoid(16), ...values });
      created += 1;
    }
  }

  // Yel-yel hanya boleh satu; baris terakhir yang ditandai yang menang.
  const yelYelRows = await db
    .select({ id: missions.id })
    .from(missions)
    .where(eq(missions.isYelYel, true))
    .orderBy(asc(missions.updatedAt));

  if (yelYelRows.length > 1) {
    const keepId = yelYelRows[yelYelRows.length - 1].id;
    await db
      .update(missions)
      .set({ isYelYel: false })
      .where(sql`${missions.isYelYel} = TRUE AND ${missions.id} <> ${keepId}`);
  }

  return response(res, 200, `${created} misi baru, ${updated} diperbarui`, {
    created,
    updated,
    skipped,
  });
});
