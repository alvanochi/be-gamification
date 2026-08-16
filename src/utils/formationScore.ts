
/**
 * Poin pembentukan kelompok, dihitung dari lamanya kelompok menyelesaikan
 * onboarding — sejak kelompok terbentuk sampai namanya tersimpan.
 *
 * Tepat waktu (dalam batas) = poin penuh. Terlambat satu tenggang = separuh.
 * Lebih dari itu = nol.
 */
export interface FormationRule {
  formationLimitMinutes: number;
  formationGraceMinutes: number;
  formationFullPoint: number;
  formationLatePoint: number;
}

export const calculateFormationPoint = (
  startedAt: Date | null,
  finishedAt: Date,
  rule: FormationRule,
): number => {
  // Kelompok lama yang terbentuk sebelum penanda mulai ada tidak dihukum.
  if (!startedAt) return rule.formationFullPoint;

  const minutes = (finishedAt.getTime() - startedAt.getTime()) / 60000;

  if (minutes <= rule.formationLimitMinutes) return rule.formationFullPoint;
  if (minutes <= rule.formationLimitMinutes + rule.formationGraceMinutes) return rule.formationLatePoint;
  return 0;
};

/** Sisa waktu dalam detik, untuk hitung mundur di layar peserta. */
export const formationSecondsLeft = (
  startedAt: Date | null,
  limitMinutes: number,
  now: Date = new Date(),
): number => {
  if (!startedAt) return limitMinutes * 60;
  const elapsed = (now.getTime() - startedAt.getTime()) / 1000;
  return Math.max(0, Math.round(limitMinutes * 60 - elapsed));
};
