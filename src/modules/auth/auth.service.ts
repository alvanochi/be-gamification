import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../../db/index.ts';
import { authentications } from '../../db/schema/authentications.ts';

export const addRefreshToken = async ({ userId, refreshToken }: { userId: string; refreshToken: string }) => {
  const id = nanoid(12);

  await db.insert(authentications).values({
    id,
    userId,
    refreshToken,
  });
};

export const deleteRefreshToken = async ({ refreshToken }: { refreshToken: string }) => {
  await db
    .delete(authentications)
    .where(eq(authentications.refreshToken, refreshToken));
};

export const verifyAndRefreshToken = async ({ refreshToken }: { refreshToken: string }) => {
  const [result] = await db
    .update(authentications)
    .set({ updatedAt: new Date() })
    .where(eq(authentications.refreshToken, refreshToken))
    .returning({
      id: authentications.id,
      userId: authentications.userId,
      refreshToken: authentications.refreshToken,
    });

  return result || null;
};
