/**
 * Yel-yel — misi tantangan dengan tenggat sendiri.
 *
 * Berbeda dari misi lain, yel-yel ikut muncul di rangkaian checkpoint tepat
 * setelah kelompok diberi nama, dan jendela pengerjaannya dihitung sejak saat
 * itu. Kelompok boleh melewatinya untuk langsung berlomba, dengan konsekuensi
 * poin yang lebih kecil bila bukti baru dikirim belakangan. Lewat tenggat,
 * misi ini tidak lagi bernilai.
 */

export interface YelYelRule {
  yelYelDeadlineHours: number;
  yelYelOnTimePoint: number;
  yelYelLatePoint: number;
}

/** Tenggat pengumpulan, terhitung sejak nama kelompok tersimpan. */
export const yelYelDeadline = (nameSetAt: Date | null, deadlineHours: number): Date | null => {
  if (!nameSetAt) return null;
  return new Date(nameSetAt.getTime() + deadlineHours * 3600_000);
};

/** Sisa waktu dalam detik, untuk hitung mundur di layar peserta. */
export const yelYelSecondsLeft = (
  nameSetAt: Date | null,
  deadlineHours: number,
  now: Date = new Date(),
): number => {
  const deadline = yelYelDeadline(nameSetAt, deadlineHours);
  if (!deadline) return deadlineHours * 3600;
  return Math.max(0, Math.round((deadline.getTime() - now.getTime()) / 1000));
};

export const isYelYelExpired = (
  nameSetAt: Date | null,
  deadlineHours: number,
  now: Date = new Date(),
): boolean => {
  const deadline = yelYelDeadline(nameSetAt, deadlineHours);
  // Kelompok yang belum sempat diberi nama belum mulai dihitung tenggatnya.
  if (!deadline) return false;
  return now.getTime() > deadline.getTime();
};

/**
 * Poin yel-yel untuk sebuah kelompok.
 *
 * Dikerjakan langsung di checkpoint = poin penuh. Dilewati dulu lalu dikirim
 * belakangan = tarif tertunda. Lewat tenggat = nol.
 */
export const calculateYelYelPoint = (
  group: { nameSetAt: Date | null; yelYelSkippedAt: Date | null },
  rule: YelYelRule,
  now: Date = new Date(),
): number => {
  if (isYelYelExpired(group.nameSetAt, rule.yelYelDeadlineHours, now)) return 0;
  return group.yelYelSkippedAt ? rule.yelYelLatePoint : rule.yelYelOnTimePoint;
};
