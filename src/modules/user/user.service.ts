import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import bcrypt from 'bcrypt';
import { db } from '../../db/index.ts';
import { users } from '../../db/schema/users.ts';
import type { RegisterInput, UpdateProfileInput } from '../../validations/user.validation.ts';
import type { LoginInput } from '../../validations/auth.validation.ts';

export const createUser = async ({ email, phoneNumber, fullname, businessName, youtubeAccount, instagramAccount, tiktokAccount }: RegisterInput) => {
    const id = nanoid(16);
    const hashedPassword = await bcrypt.hash(phoneNumber, 10);

    const [user] = await db
        .insert(users)
        .values({
            id,
            email,
            phoneNumber,
            password: hashedPassword,
            fullname,
            businessName,
            youtubeAccount,
            instagramAccount,
            tiktokAccount,
            // FR-01: token QR pribadi, dibuat sekali saat registrasi. Peserta
            // menunjukkan QR-nya di lapangan dan panitia memindainya untuk
            // check-in, tanpa antre pencatatan manual. Panjang 32 supaya tidak
            // bisa ditebak/dienumerasi.
            qrToken: nanoid(32),
        })
        .returning({
            id: users.id,
            email: users.email,
            fullname: users.fullname,
            qrToken: users.qrToken,
            createdAt: users.createdAt,
        });

    return user;
};

/**
 * Check-in peserta berdasarkan QR yang dipindai panitia.
 * Idempoten: memindai ulang QR yang sama tidak menimpa waktu check-in pertama.
 */
export const checkInByQrToken = async (qrToken: string) => {
    const [user] = await db
        .select({
            id: users.id,
            fullname: users.fullname,
            groupId: users.groupId,
            checkInAt: users.checkInAt,
        })
        .from(users)
        .where(eq(users.qrToken, qrToken))
        .limit(1);

    if (!user) return null;

    if (user.checkInAt) {
        return { ...user, alreadyCheckedIn: true };
    }

    const checkInAt = new Date();
    await db.update(users).set({ checkInAt, updatedAt: new Date() }).where(eq(users.id, user.id));

    return { ...user, checkInAt, alreadyCheckedIn: false };
};

/**
 * Isi qrToken untuk akun lama yang dibuat sebelum FR-01 ada.
 * Dipanggil saat profil dibaca agar tidak perlu migrasi data terpisah.
 */
export const ensureQrToken = async (userId: string, current: string | null) => {
    if (current) return current;

    const qrToken = nanoid(32);
    await db.update(users).set({ qrToken, updatedAt: new Date() }).where(eq(users.id, userId));
    return qrToken;
};

export const checkEmailExists = async (email: string) => {
    const user = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

    return user.length > 0;
};

export const checkPhoneExists = async (phoneNumber: string) => {
    const user = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.phoneNumber, phoneNumber))
        .limit(1);

    return user.length > 0;
};

export const verifyUserCredential = async ({ email, phoneNumber }: LoginInput) => {
    const [user] = await db
        .select({
            id: users.id,
            password: users.password,
        })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

    if (!user || !user.password) return null;

    const isPasswordMatch = await bcrypt.compare(phoneNumber, user.password);
    if (!isPasswordMatch) return null;

    return user.id;
};

export const getUserById = async (id: string) => {
    const [user] = await db
        .select({
            id: users.id,
            email: users.email,
            fullname: users.fullname,
            role: users.role,
            groupId: users.groupId,
            checkInAt: users.checkInAt,
            createdAt: users.createdAt,
            updatedAt: users.updatedAt,
        })
        .from(users)
        .where(eq(users.id, id))
        .limit(1);

    return user || null;
};

/**
 * Profil diri sendiri — satu-satunya tempat qrToken boleh keluar.
 * `getUserById` (dipakai untuk melihat peserta lain) sengaja tidak
 * mengembalikannya, karena token itu yang dipakai panitia untuk check-in.
 */
export const getProfile = async (userId: string) => {
    const [user] = await db
        .select({
            id: users.id,
            email: users.email,
            fullname: users.fullname,
            role: users.role,
            groupId: users.groupId,
            qrToken: users.qrToken,
            checkInAt: users.checkInAt,
            createdAt: users.createdAt,
            updatedAt: users.updatedAt,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

    if (!user) return null;

    return { ...user, qrToken: await ensureQrToken(user.id, user.qrToken) };
};

export const updateProfile = async (userId: string, data: UpdateProfileInput) => {
    if (data.email) {
        const existing = await db
            .select({ id: users.id })
            .from(users)
            .where(eq(users.email, data.email))
            .limit(1);

        if (existing.length > 0 && existing[0].id !== userId) {
            return { error: 'Email already in use by another account' };
        }
    }

    const updateData: Record<string, any> = { updatedAt: new Date() };
    if (data.fullname) updateData.fullname = data.fullname;
    if (data.email) updateData.email = data.email;

    const [updated] = await db
        .update(users)
        .set(updateData)
        .where(eq(users.id, userId))
        .returning({
            id: users.id,
            email: users.email,
            fullname: users.fullname,
            createdAt: users.createdAt,
            updatedAt: users.updatedAt,
        });

    return updated || null;
};

export const checkInUser = async (userId: string) => {
    const [user] = await db.select({ checkInAt: users.checkInAt }).from(users).where(eq(users.id, userId)).limit(1);
    
    if (user && !user.checkInAt) {
        await db.update(users).set({ checkInAt: new Date(), updatedAt: new Date() }).where(eq(users.id, userId));
    }
};
