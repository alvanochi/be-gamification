import type { Request, Response, NextFunction } from 'express';
import catchAsync from '../../utils/catchAsync.ts';
import response from '../../utils/response.ts';
import ApiError from '../../utils/ApiError.ts';
import { db } from '../../db/index.ts';
import { users } from '../../db/schema/users.ts';
import { assignments } from '../../db/schema/assignments.ts';
import { barterSteps } from '../../db/schema/barter_steps.ts';
import { scoreEntries } from '../../db/schema/score_entries.ts';
import { sponsors } from '../../db/schema/sponsors.ts';
import { groups } from '../../db/schema/groups.ts';
import { eq, and, gt, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

// Middleware or helper to ensure admin
const ensureAdmin = async (userId: string) => {
    const [user] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId)).limit(1);
    if (!user || (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN')) {
        throw ApiError.forbidden('Only ADMIN or SUPER_ADMIN can perform this action');
    }
};

export const getReviewQueue = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.user?.id as string;
    await ensureAdmin(userId);

    const queue = await db.select().from(assignments).where(eq(assignments.status, 'REVIEW'));
    return response(res, 200, 'Review queue fetched', queue);
});

export const addManualScore = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.user?.id as string;
    await ensureAdmin(userId);

    const { groupId, point, referenceId } = req.body;
    if (!groupId || !point) {
        throw ApiError.badRequest('groupId and point are required');
    }

    const [entry] = await db.insert(scoreEntries).values({
        id: nanoid(16),
        groupId,
        source: 'MANUAL',
        referenceId,
        point,
        createdBy: userId,
    }).returning();

    return response(res, 201, 'Manual score added', entry);
});

export const getBanners = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const banners = await db.select().from(sponsors);
    return response(res, 200, 'Banners fetched', banners);
});

export const createBanner = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.user?.id as string;
    await ensureAdmin(userId);

    const { name, logoUrl, linkUrl, orderNum, isActive } = req.body;
    if (!name || !logoUrl) throw ApiError.badRequest('name and logoUrl are required');

    const [banner] = await db.insert(sponsors).values({
        id: nanoid(16),
        name,
        logoUrl,
        linkUrl,
        orderNum: orderNum || 0,
        isActive: isActive !== false,
    }).returning();

    return response(res, 201, 'Banner created', banner);
});

export const updateBanner = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.user?.id as string;
    await ensureAdmin(userId);

    const { id } = req.params;
    const updateData = req.body;

    const [banner] = await db.update(sponsors).set({
        ...updateData,
        updatedAt: new Date(),
    }).where(eq(sponsors.id, id)).returning();

    if (!banner) throw ApiError.notFound('Banner not found');
    return response(res, 200, 'Banner updated', banner);
});

export const deleteBanner = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.user?.id as string;
    await ensureAdmin(userId);

    const { id } = req.params;
    await db.delete(sponsors).where(eq(sponsors.id, id));
    return response(res, 200, 'Banner deleted', null);
});

export const verifyBarter = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.user?.id as string;
    await ensureAdmin(userId);

    const { assignmentId } = req.params;
    const { validUntilStep, point } = req.body; // Step number until which it is valid

    if (validUntilStep === undefined || point === undefined) {
        throw ApiError.badRequest('validUntilStep and point are required');
    }

    const assignment = await db.select().from(assignments).where(eq(assignments.id, assignmentId)).limit(1);
    if (!assignment.length) throw ApiError.notFound('Assignment not found');

    await db.transaction(async (tx: any) => {
        // Invalidate steps > validUntilStep
        await tx.update(barterSteps)
            .set({ isValid: false, updatedAt: new Date() })
            .where(and(eq(barterSteps.assignmentId, assignmentId), gt(barterSteps.stepNo, validUntilStep)));

        // Update assignment status
        await tx.update(assignments)
            .set({ status: 'ACCEPTED', updatedAt: new Date() })
            .where(eq(assignments.id, assignmentId));

        // Add points to score_entries
        await tx.insert(scoreEntries).values({
            id: nanoid(16),
            groupId: assignment[0].groupId,
            source: 'BARTER',
            referenceId: assignmentId,
            point,
            createdBy: userId,
        });
        
        // Also update group static score just in case, but we will move to dynamic soon
        const group = await tx.select().from(groups).where(eq(groups.id, assignment[0].groupId)).limit(1);
        if (group.length) {
            await tx.update(groups).set({ score: group[0].score + point, updatedAt: new Date() }).where(eq(groups.id, group[0].id));
        }
    });

    return response(res, 200, 'Barter verified', null);
});

export const exportLeaderboard = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.user?.id as string;
    await ensureAdmin(userId);

    const result = await db.execute(sql`
        SELECT g.name as group_name, COALESCE(SUM(s.point), 0)::int as score,
        (SELECT COUNT(u.id) FROM users u WHERE u.group_id = g.id) as members_count
        FROM groups g
        LEFT JOIN score_entries s ON s.group_id = g.id
        GROUP BY g.id
        ORDER BY score DESC
    `);

    const rows = result.rows;
    let csv = 'Nama Grup,Skor Total,Jumlah Anggota\n';
    rows.forEach((row: any) => {
        csv += `"${row.group_name}",${row.score},${row.members_count}\n`;
    });

    res.header('Content-Type', 'text/csv');
    res.attachment('leaderboard_export.csv');
    return res.send(csv);
});
