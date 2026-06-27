import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import bcrypt from 'bcrypt';
import { db } from '../../db/index.ts';
import { users } from '../../db/schema/users.ts';
import type { RegisterInput, UpdateProfileInput } from '../../validations/user.validation.ts';
import type { LoginInput } from '../../validations/auth.validation.ts';

export const createUser = async ({ email, password, fullname }: RegisterInput) => {
    const id = nanoid(16);
    const hashedPassword = await bcrypt.hash(password, 10);

    const [user] = await db
        .insert(users)
        .values({
            id,
            email,
            password: hashedPassword,
            fullname,
        })
        .returning({
            id: users.id,
            email: users.email,
            fullname: users.fullname,
            createdAt: users.createdAt,
        });

    return user;
};

export const checkEmailExists = async (email: string) => {
    const user = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

    return user.length > 0;
};

export const verifyUserCredential = async ({ email, password }: LoginInput) => {
    const [user] = await db
        .select({
            id: users.id,
            password: users.password,
        })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

    if (!user) return null;

    const isPasswordMatch = await bcrypt.compare(password, user.password);
    if (!isPasswordMatch) return null;

    return user.id;
};

export const getUserById = async (id: string) => {
    const [user] = await db
        .select({
            id: users.id,
            email: users.email,
            fullname: users.fullname,
            createdAt: users.createdAt,
            updatedAt: users.updatedAt,
        })
        .from(users)
        .where(eq(users.id, id))
        .limit(1);

    return user || null;
};

export const getProfile = async (userId: string) => {
    return getUserById(userId);
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
