import ApiError from './ApiError.ts';

export interface ScoringConfig {
  scoringMode: 'FLAT' | 'RANGE' | 'PER_UNIT' | 'TIME_BASED' | 'AUTO_QUIZ';
  pointWeight: number;
  pointMin: number | null;
  pointMax: number | null;
  pointPerUnit: number | null;
  maxUnits: number | null;
  timeTargetSeconds: number | null;
}

export interface ScoringInput {
  /** Nilai yang diketik panitia — dipakai mode RANGE. */
  awardedPoint?: number;
  /** Jumlah satuan hasil (mis. anak panah tepat sasaran) — mode PER_UNIT. */
  units?: number;
  /** Waktu tempuh dalam detik — mode TIME_BASED. */
  timeSeconds?: number;
  /** Poin hasil pemeriksaan jawaban — mode AUTO_QUIZ. */
  quizPoint?: number;
}

/**
 * Hitung poin akhir sebuah misi.
 *
 * MR6 memakai beberapa gaya penilaian sekaligus, dan sebelumnya semuanya
 * dipaksa menjadi satu angka datar — sehingga "1 anak panah = 50 poin" dan
 * "waktu yang ditempuh" harus dihitung manual oleh panitia di luar sistem.
 */
export const calculateMissionPoint = (mission: ScoringConfig, input: ScoringInput): number => {
  switch (mission.scoringMode) {
    case 'RANGE': {
      const { pointMin, pointMax } = mission;
      if (pointMin == null || pointMax == null) {
        throw ApiError.badRequest('Misi berpenilaian rentang belum punya batas poin minimum/maksimum');
      }
      if (input.awardedPoint === undefined) {
        throw ApiError.badRequest(
          `Misi ini dinilai dalam rentang ${pointMin} - ${pointMax} poin. Mohon isi nilainya.`,
        );
      }
      if (input.awardedPoint < pointMin || input.awardedPoint > pointMax) {
        throw ApiError.badRequest(`Nilai harus di antara ${pointMin} dan ${pointMax} poin.`);
      }
      return input.awardedPoint;
    }

    case 'PER_UNIT': {
      if (input.units === undefined) {
        throw ApiError.badRequest('Mohon isi jumlah hasil yang dicapai peserta.');
      }
      if (!Number.isInteger(input.units) || input.units < 0) {
        throw ApiError.badRequest('Jumlah hasil harus bilangan bulat tidak negatif.');
      }
      const perUnit = mission.pointPerUnit ?? 0;
      // Batas satuan menjaga agar salah ketik (mis. 300 anak panah) tidak
      // langsung meledakkan klasemen.
      const units = mission.maxUnits != null ? Math.min(input.units, mission.maxUnits) : input.units;
      return perUnit * units;
    }

    case 'TIME_BASED': {
      if (input.timeSeconds === undefined) {
        throw ApiError.badRequest('Mohon isi waktu tempuh peserta (dalam detik).');
      }
      if (input.timeSeconds <= 0) {
        throw ApiError.badRequest('Waktu tempuh harus lebih dari 0 detik.');
      }
      const target = mission.timeTargetSeconds;
      if (!target) {
        throw ApiError.badRequest('Misi berpenilaian waktu belum punya waktu acuan.');
      }
      // Mencapai atau melampaui waktu acuan berarti poin penuh; lebih lambat
      // berkurang sebanding, dengan lantai 0.
      const ratio = target / input.timeSeconds;
      return Math.max(0, Math.min(mission.pointWeight, Math.round(mission.pointWeight * ratio)));
    }

    case 'AUTO_QUIZ':
      return input.quizPoint ?? 0;

    case 'FLAT':
    default:
      // Panitia tetap boleh menimpa nilai datar bila perlu koreksi.
      return input.awardedPoint ?? mission.pointWeight;
  }
};

/** Penjelasan singkat cara penilaian, untuk ditampilkan ke panitia & peserta. */
export const describeScoring = (mission: ScoringConfig): string => {
  switch (mission.scoringMode) {
    case 'RANGE':
      return `Dinilai panitia, ${mission.pointMin}-${mission.pointMax} poin`;
    case 'PER_UNIT':
      return `${mission.pointPerUnit} poin per hasil${mission.maxUnits ? `, maksimal ${mission.maxUnits}` : ''}`;
    case 'TIME_BASED':
      return `Berdasarkan waktu, poin penuh ${mission.pointWeight} bila ≤ ${mission.timeTargetSeconds} detik`;
    case 'AUTO_QUIZ':
      return 'Dinilai otomatis dari jawaban benar';
    default:
      return `${mission.pointWeight} poin`;
  }
};
