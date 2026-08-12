import env from '../config/env.ts';
import ApiError from './ApiError.ts';

/**
 * Menit sejak tengah malam pada zona waktu acara.
 * Server bisa berjalan di UTC, sementara MR6 menulis sesi dalam waktu lokal
 * (WIB), jadi jam lokal dihitung eksplisit dari offset — bukan dari zona server.
 */
export const minutesOfDayInEventTz = (now: Date = new Date()): number => {
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const shifted = utcMinutes + env.EVENT_TIMEZONE_OFFSET * 60;
  // Modulo positif supaya offset negatif tetap menghasilkan 0..1439.
  return ((shifted % 1440) + 1440) % 1440;
};

/** Ubah "HH:MM" menjadi menit sejak tengah malam. Mengembalikan null jika tidak valid. */
export const parseHhMm = (value?: string | null): number | null => {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
};

const formatHhMm = (totalMinutes: number): string => {
  const h = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
  const m = String(totalMinutes % 60).padStart(2, '0');
  return `${h}:${m}`;
};

/**
 * BR-04 — seluruh aktivitas pengerjaan dibatasi pada satu jendela harian.
 * Tidak melakukan apa-apa bila env belum diisi, supaya tidak mengunci lingkungan
 * pengembangan secara tidak sengaja.
 */
export const assertWithinEventWindow = (now: Date = new Date()): void => {
  const start = parseHhMm(env.EVENT_WINDOW_START);
  const end = parseHhMm(env.EVENT_WINDOW_END);
  if (start === null || end === null) return;

  const current = minutesOfDayInEventTz(now);
  const inside = start <= end
    ? current >= start && current <= end
    : current >= start || current <= end; // jendela yang melewati tengah malam

  if (!inside) {
    throw ApiError.badRequest(
      `Di luar jam acara. Pengerjaan hanya dibuka pukul ${formatHhMm(start)} - ${formatHhMm(end)} WIB.`,
    );
  }
};

/**
 * Sesi per-misi dari MR6 (mis. "09.00 - 12.00"). Sama seperti time box, sesi
 * yang tidak diisi berarti misi terbuka sepanjang jendela acara.
 */
export const assertWithinMissionSession = (
  sessionStart?: string | null,
  sessionEnd?: string | null,
  now: Date = new Date(),
): void => {
  const start = parseHhMm(sessionStart);
  const end = parseHhMm(sessionEnd);
  if (start === null || end === null) return;

  const current = minutesOfDayInEventTz(now);
  if (current < start || current > end) {
    throw ApiError.badRequest(
      `Misi ini hanya dibuka pada sesi ${formatHhMm(start)} - ${formatHhMm(end)} WIB.`,
    );
  }
};
