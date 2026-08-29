/**
 * Nilai akhir acara.
 *
 * Terdiri dari dua penilaian yang lahir di tempat berbeda:
 *
 *   Penilaian 1 — apa yang dikerjakan kelompok di lapangan.
 *     (poin sistem + jumlah postingan seluruh anggotanya) × 70%
 *
 *     "Poin sistem" adalah jumlah seluruh score_entries kelompok itu: misi
 *     yang disetujui panitia, barter, pembentukan kelompok, yel-yel. Jumlah
 *     postingan datang dari pihak eksternal, dicocokkan per peserta lewat
 *     username Instagram, lalu dijumlahkan se-kelompok.
 *
 *   Penilaian 2 — gaung di media sosial.
 *     nett likes & share, dikirim pihak eksternal
 *
 *     Angka ini SUDAH dibobot 30% di sisi pengirim, jadi di sini ia hanya
 *     ditambahkan. Itu sebabnya ENGAGEMENT_WEIGHT bernilai 1 dan bukan 0,3 —
 *     mengalikannya lagi berarti membobot dua kali dan memangkas nilai
 *     akhirnya menjadi kurang dari sepertiga yang seharusnya.
 *
 *   Nilai akhir = Penilaian 1 + Penilaian 2
 *
 * Kedua bobot berdiri sebagai konstanta bernama supaya bisa diubah di satu
 * baris bila panitia mengubah aturannya — dan supaya nilai yang tampil di
 * layar selalu bisa ditelusuri kembali ke rumus ini, bukan ke perhitungan
 * yang tersebar di beberapa berkas.
 */

/** Bobot penilaian 1. Ditulis sebagai pembagian agar "70%" terbaca apa adanya. */
export const MISSION_WEIGHT = 70 / 100;

/**
 * Bobot penilaian 2 di sisi kita.
 *
 * Bernilai 1 karena pihak eksternal mengirim nett yang sudah dikalikan 30%.
 * Bila suatu saat mereka berganti mengirim angka mentah, ini yang diubah
 * menjadi `30 / 100` — bukan rumus di bawah.
 */
export const ENGAGEMENT_WEIGHT = 1;

/** Dua angka di belakang koma. Pecahan biner tidak boleh bocor ke layar. */
const round2 = (value: number) => Math.round(value * 100) / 100;

export interface FinalScoreInput {
  /** Jumlah seluruh score_entries kelompok — poin kotor dari sistem ini. */
  systemPoint: number;
  /** Jumlah postingan seluruh anggota kelompok. */
  postCount: number;
  /** Nett likes & share dari pihak eksternal, sudah berbobot. */
  externalNett: number;
}

export interface FinalScoreBreakdown extends FinalScoreInput {
  /** Poin sistem + jumlah postingan, sebelum dibobot. */
  grossPoint: number;
  /** Penilaian 1 setelah dikalikan 70%. */
  missionScore: number;
  /** Penilaian 2 sebagaimana dihitung di sini. */
  engagementScore: number;
  finalScore: number;
}

export const computeFinalScore = ({
  systemPoint,
  postCount,
  externalNett,
}: FinalScoreInput): FinalScoreBreakdown => {
  const grossPoint = systemPoint + postCount;
  const missionScore = round2(grossPoint * MISSION_WEIGHT);
  const engagementScore = round2(externalNett * ENGAGEMENT_WEIGHT);

  return {
    systemPoint,
    postCount,
    externalNett,
    grossPoint,
    missionScore,
    engagementScore,
    finalScore: round2(missionScore + engagementScore),
  };
};

/**
 * Username Instagram dalam bentuk yang bisa dibandingkan.
 *
 * Peserta menuliskannya bermacam-macam — "@nama", "nama",
 * "instagram.com/nama/", bahkan dengan spasi di ujungnya. Pihak eksternal pun
 * belum tentu menulis dengan gaya yang sama. Keduanya diratakan ke bentuk yang
 * sama sebelum dicocokkan, supaya postingan tidak gagal terhitung hanya karena
 * beda tanda @.
 */
export const normaliseInstagram = (value: string | null | undefined) => {
  if (!value) return '';

  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^(www\.)?instagram\.com\//, '')
    .replace(/^@/, '')
    .replace(/[/?#].*$/, '')
    .trim();
};
