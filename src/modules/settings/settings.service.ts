import { eq } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { eventSettings } from '../../db/schema/event_settings.ts';

const SINGLETON_ID = 'default';

/**
 * Baca pengaturan acara, buatkan baris bawaannya bila belum ada.
 *
 * Dibuat malas seperti ini supaya tidak perlu langkah seeding terpisah yang
 * bisa terlewat saat menyiapkan database baru.
 */
export const getSettings = async () => {
  const [existing] = await db
    .select()
    .from(eventSettings)
    .where(eq(eventSettings.id, SINGLETON_ID))
    .limit(1);

  if (existing) return existing;

  const [created] = await db.insert(eventSettings).values({ id: SINGLETON_ID }).returning();
  return created;
};

export type EventSettings = Awaited<ReturnType<typeof getSettings>>;

export const updateSettings = async (patch: Partial<EventSettings>) => {
  await getSettings();

  // id dan updatedAt tidak boleh ditimpa dari luar.
  const { id: _id, updatedAt: _updatedAt, ...safe } = patch as Record<string, unknown>;

  const [updated] = await db
    .update(eventSettings)
    .set({ ...safe, updatedAt: new Date() })
    .where(eq(eventSettings.id, SINGLETON_ID))
    .returning();

  return updated;
};

/** Buka atau tutup daftar misi untuk seluruh peserta sekaligus. */
export const setMissionsReleased = async (released: boolean) => {
  return updateSettings({
    missionsReleased: released,
    missionsReleasedAt: released ? new Date() : null,
  } as Partial<EventSettings>);
};

/** Kirim pengumuman yang muncul sebagai pop-up di aplikasi peserta. */
export const announce = async (message: string) => {
  return updateSettings({
    announcement: message,
    announcedAt: new Date(),
  } as Partial<EventSettings>);
};

/**
 * Bagian pengaturan yang boleh dibaca peserta.
 * Angka-angka poin sengaja ikut, supaya layar peserta bisa menjelaskan
 * aturannya tanpa menebak.
 */
export const getPublicSettings = async () => {
  const s = await getSettings();
  return {
    missionsReleased: s.missionsReleased,
    missionsReleasedAt: s.missionsReleasedAt,
    announcement: s.announcement,
    announcedAt: s.announcedAt,
    formationLimitMinutes: s.formationLimitMinutes,
    formationGraceMinutes: s.formationGraceMinutes,
    formationFullPoint: s.formationFullPoint,
    formationLatePoint: s.formationLatePoint,
    yelYelDeadlineHours: s.yelYelDeadlineHours,
    yelYelOnTimePoint: s.yelYelOnTimePoint,
    yelYelLatePoint: s.yelYelLatePoint,
    barterPointPerStep: s.barterPointPerStep,
    leaderboardTopN: s.leaderboardTopN,
  };
};
