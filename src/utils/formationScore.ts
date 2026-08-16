import env from '../config/env.ts';

/**
 * Poin pembentukan kelompok, dihitung dari lamanya kelompok menyelesaikan
 * onboarding — sejak kelompok terbentuk sampai namanya tersimpan.
 *
 * Tepat waktu (dalam batas) = poin penuh. Terlambat satu tenggang = separuh.
 * Lebih dari itu = nol.
 */
export const FORMATION_LIMIT_MINUTES = 30;
export const FORMATION_GRACE_MINUTES = 15;
export const FORMATION_FULL_POINT = 100;
export const FORMATION_LATE_POINT = 50;

export const calculateFormationPoint = (startedAt: Date | null, finishedAt: Date): number => {
  // Kelompok lama yang terbentuk sebelum penanda mulai ada tidak dihukum.
  if (!startedAt) return FORMATION_FULL_POINT;

  const minutes = (finishedAt.getTime() - startedAt.getTime()) / 60000;

  if (minutes <= FORMATION_LIMIT_MINUTES) return FORMATION_FULL_POINT;
  if (minutes <= FORMATION_LIMIT_MINUTES + FORMATION_GRACE_MINUTES) return FORMATION_LATE_POINT;
  return 0;
};

/** Sisa waktu dalam detik, untuk hitung mundur di layar peserta. */
export const formationSecondsLeft = (startedAt: Date | null, now: Date = new Date()): number => {
  if (!startedAt) return FORMATION_LIMIT_MINUTES * 60;
  const elapsed = (now.getTime() - startedAt.getTime()) / 1000;
  return Math.max(0, Math.round(FORMATION_LIMIT_MINUTES * 60 - elapsed));
};
