import { z } from 'zod';

// Bentuk dasar body misi, dipakai createMissionSchema (utuh + aturan silang)
// dan updateMissionSchema (partial).
const missionBody = z.object({
    title: z.string().min(3).max(255),
    description: z.string(),
    // Must match the real `mission_type` DB enum (missions.ts) — the
    // previous MEDIA/MULTIPLE_CHOICE/SHORT_ANSWER values here didn't match
    // it at all, so no request could ever pass validation *and* the DB
    // constraint at the same time.
    type: z.enum(['TANTANGAN', 'BIGGER_BETTER', 'SOAL_LOKASI']),
    isMandatory: z.boolean().default(false),
    pointWeight: z.number().int().min(0),
    sponsorId: z.string().optional(),
    // Scheduling & dependency — read by mission.service.ts's assignMission,
    // but previously had no way to be set at creation time.
    openAt: z.string().datetime().optional(),
    prerequisiteId: z.string().optional(),
    participantCount: z.number().int().min(1).default(1),
    // Geofencing — only meaningful for SOAL_LOKASI, but harmless to accept
    // as optional for the other types.
    geoLat: z.string().optional(),
    geoLng: z.string().optional(),
    geoRadius: z.number().int().min(1).optional(),
    // Free-form per-mission point rules (e.g. the Pickle-game "count from
    // hit #21" threshold example in the SRS) — kept as a config blob rather
    // than hard-coded, per the SRS's own principle.
    pointRules: z.record(z.string(), z.unknown()).optional(),

    // --- Kebutuhan MR6 ---
    category: z.enum(['TERSTRUKTUR', 'MANDIRI']).default('MANDIRI'),
    clueType: z.enum(['NONE', 'TEKS', 'MORSE', 'SANDI_ANGKA', 'GPS', 'FOTO', 'MAP']).default('NONE'),
    clue: z.string().optional(),
    locationName: z.string().max(255).optional(),
    // "HH:MM" — jam lokal acara, bukan timestamp; lihat komentar di skema.
    sessionStart: z.string().regex(/^\d{2}:\d{2}$/, 'Format sesi harus HH:MM').optional(),
    sessionEnd: z.string().regex(/^\d{2}:\d{2}$/, 'Format sesi harus HH:MM').optional(),
    durationMinutes: z.number().int().min(1).optional(),
    proofType: z
      .enum(['FOTO', 'VIDEO', 'FOTO_VIDEO', 'LINK_SOSMED', 'LAPORAN_PETUGAS', 'INPUT_HASIL'])
      .default('FOTO'),
    pointMin: z.number().int().min(0).optional(),
    pointMax: z.number().int().min(0).optional(),
    requiresCheckIn: z.boolean().default(false),
    equipment: z.string().optional(),

    // Cara penilaian. RANGE memakai pointMin/pointMax, PER_UNIT memakai
    // pointPerUnit, TIME_BASED memakai timeTargetSeconds.
    scoringMode: z.enum(['FLAT', 'RANGE', 'PER_UNIT', 'TIME_BASED', 'AUTO_QUIZ']).default('FLAT'),
    pointPerUnit: z.number().int().min(0).optional(),
    maxUnits: z.number().int().min(1).optional(),
    timeTargetSeconds: z.number().int().min(1).optional(),
});

export const createMissionSchema = z.object({
  body: missionBody
    .refine(
      data => (data.pointMin === undefined) === (data.pointMax === undefined),
      { message: 'pointMin dan pointMax harus diisi bersamaan', path: ['pointMax'] },
    )
    .refine(
      data => data.pointMin === undefined || data.pointMax === undefined || data.pointMin <= data.pointMax,
      { message: 'pointMin tidak boleh lebih besar dari pointMax', path: ['pointMax'] },
    )
    .refine(
      data => (data.sessionStart === undefined) === (data.sessionEnd === undefined),
      { message: 'sessionStart dan sessionEnd harus diisi bersamaan', path: ['sessionEnd'] },
    )
    // Tiap cara penilaian punya kolom pendukungnya sendiri — dijaga di sini
    // supaya misi tidak tersimpan dalam keadaan tidak bisa dinilai.
    .refine(data => data.scoringMode !== 'PER_UNIT' || data.pointPerUnit !== undefined, {
      message: 'Penilaian per satuan membutuhkan poin per satuan',
      path: ['pointPerUnit'],
    })
    .refine(data => data.scoringMode !== 'TIME_BASED' || data.timeTargetSeconds !== undefined, {
      message: 'Penilaian berbasis waktu membutuhkan waktu acuan',
      path: ['timeTargetSeconds'],
    })
    .refine(
      data => data.scoringMode !== 'RANGE' || (data.pointMin !== undefined && data.pointMax !== undefined),
      { message: 'Penilaian rentang membutuhkan poin minimum dan maksimum', path: ['pointMax'] },
    ),
});

export type CreateMissionInput = z.infer<typeof createMissionSchema>['body'];

/**
 * Update misi: seluruh field opsional (partial), tapi aturan silang yang sama
 * tetap berlaku bila pasangannya ikut dikirim.
 */
export const updateMissionSchema = z.object({
  body: missionBody.partial().refine(
    (data: { pointMin?: number; pointMax?: number }) =>
      data.pointMin === undefined || data.pointMax === undefined || data.pointMin <= data.pointMax,
    { message: 'pointMin tidak boleh lebih besar dari pointMax', path: ['pointMax'] },
  ),
});

export const setQuestionsSchema = z.object({
  body: z.object({
    questions: z
      .array(
        z.object({
          questionText: z.string().min(1),
          imageUrl: z.string().url().optional(),
          type: z.enum(['PILIHAN_GANDA', 'ISIAN_SINGKAT']),
          answerKey: z.string().max(255).optional(),
          point: z.number().int().min(0).default(10),
          options: z
            .array(z.object({ optionText: z.string().min(1).max(500), isCorrect: z.boolean() }))
            .optional(),
        }),
      )
      .max(50),
  }),
});

export const missionCheckInSchema = z.object({
  body: z.object({
    queueNumber: z.string().max(20).optional(),
  }),
});
