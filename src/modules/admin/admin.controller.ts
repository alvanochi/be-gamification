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
import { missions } from '../../db/schema/missions.ts';
import { groups } from '../../db/schema/groups.ts';
import { recalculateGroupScore } from '../../utils/groupScore.ts';
import { eq, and, gt, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import * as groupService from '../group/group.service.ts';
import { ensureAdmin, ensureSuperAdmin } from '../../utils/roles.ts';
import { submissions } from '../../db/schema/submissions.ts';
import { calculateMissionPoint } from '../../utils/scoring.ts';

/**
 * Daftar akun untuk pengelolaan peran (khusus Super Admin).
 * Mengembalikan seluruh panitia, plus peserta yang cocok dengan kata kunci
 * pencarian — supaya Super Admin bisa mencari orang yang akan diangkat.
 */
export const listAccounts = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    await ensureSuperAdmin(req.user?.id as string);

    const search = String(req.query.search ?? '').trim().toLowerCase();

    const rows = await db
        .select({
            id: users.id,
            fullname: users.fullname,
            email: users.email,
            phoneNumber: users.phoneNumber,
            role: users.role,
            checkInAt: users.checkInAt,
        })
        .from(users);

    const filtered = rows.filter(u => {
        if (u.role !== 'PARTICIPANT') return true;
        if (!search) return false;
        return `${u.fullname} ${u.email ?? ''} ${u.phoneNumber ?? ''}`.toLowerCase().includes(search);
    });

    return response(res, 200, 'Accounts fetched', filtered);
});

export const setAccountRole = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const actorId = req.user?.id as string;
    await ensureSuperAdmin(actorId);

    const targetId = req.params.userId as string;
    const { role } = req.body ?? {};

    if (!['PARTICIPANT', 'ADMIN', 'SUPER_ADMIN'].includes(role)) {
        throw ApiError.badRequest('Peran tidak dikenali');
    }

    // Menurunkan peran diri sendiri bisa membuat acara kehilangan Super Admin
    // terakhirnya di tengah jalan.
    if (targetId === actorId && role !== 'SUPER_ADMIN') {
        throw ApiError.badRequest('Anda tidak bisa menurunkan peran akun Anda sendiri');
    }

    const [target] = await db.select({ id: users.id }).from(users).where(eq(users.id, targetId)).limit(1);
    if (!target) throw ApiError.notFound('Akun tidak ditemukan');

    await db.update(users).set({ role, updatedAt: new Date() }).where(eq(users.id, targetId));

    return response(res, 200, 'Peran akun diperbarui', { id: targetId, role });
});

export const setGroupLeader = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.user?.id as string;
    await ensureAdmin(userId);

    const { nomineeId } = req.body ?? {};
    if (!nomineeId) throw ApiError.badRequest('nomineeId is required');

    const result = await groupService.setLeaderManually(req.params.groupId as string, nomineeId);
    return response(res, 200, 'Ketua kelompok ditetapkan oleh panitia', result);
});

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
    if (!groupId || point === undefined || point === null) {
        throw ApiError.badRequest('groupId and point are required');
    }
    if (!Number.isInteger(point)) {
        throw ApiError.badRequest('point must be an integer');
    }

    const entry = await db.transaction(async (tx: any) => {
        const [inserted] = await tx.insert(scoreEntries).values({
            id: nanoid(16),
            groupId,
            source: 'MANUAL',
            referenceId,
            point,
            createdBy: userId,
        }).returning();

        await recalculateGroupScore(tx, groupId);
        return inserted;
    });

    return response(res, 201, 'Manual score added', entry);
});

/**
 * Input hasil dari petugas pos (MR6: pembuktian "LAPORAN PETUGAS" dan
 * "INPUT HASIL YANG DIDAPAT, diawasi oleh petugas pos").
 *
 * Petugas cukup memasukkan hasil mentahnya — jumlah anak panah tepat sasaran,
 * waktu tempuh, atau nilai penjurian — dan sistem yang menghitung poinnya
 * sesuai cara penilaian misi. Sebelumnya perhitungan ini harus dilakukan
 * manual di luar sistem lalu dititipkan sebagai skor manual.
 */
export const submitFieldResult = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.user?.id as string;
    await ensureAdmin(userId);

    const { groupId, missionId, units, timeSeconds, awardedPoint, note } = req.body ?? {};
    if (!groupId || !missionId) throw ApiError.badRequest('groupId dan missionId wajib diisi');

    const [mission] = await db.select().from(missions).where(eq(missions.id, missionId)).limit(1);
    if (!mission) throw ApiError.notFound('Misi tidak ditemukan');

    const [group] = await db.select({ id: groups.id }).from(groups).where(eq(groups.id, groupId)).limit(1);
    if (!group) throw ApiError.notFound('Kelompok tidak ditemukan');

    const existing = await db.select().from(submissions).where(and(
        eq(submissions.missionId, missionId),
        eq(submissions.groupId, groupId),
    ));
    if (existing.some(s => s.status === 'APPROVED' || s.status === 'PENDING')) {
        throw ApiError.badRequest('Kelompok ini sudah punya hasil untuk misi tersebut');
    }

    const point = calculateMissionPoint(mission, { units, timeSeconds, awardedPoint });

    const submissionId = nanoid(16);
    await db.transaction(async (tx: any) => {
        await tx.insert(submissions).values({
            id: submissionId,
            missionId,
            groupId,
            submittedBy: userId,
            status: 'APPROVED',
            answerText: note ?? 'Hasil dilaporkan petugas pos',
            awardedPoint: point,
            validatedBy: userId,
            validatedAt: new Date(),
        });

        if (point > 0) {
            await tx.insert(scoreEntries).values({
                id: nanoid(16),
                groupId,
                source: 'CHALLENGE',
                referenceId: submissionId,
                point,
                createdBy: userId,
            });
            await recalculateGroupScore(tx, groupId);
        }
    });

    return response(res, 201, `Hasil tercatat — ${point} poin untuk kelompok ini`, {
        submissionId,
        point,
    });
});

export const generateGroups = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    await ensureAdmin(req.user?.id as string);

    const result = await groupService.generateGroups(Number(req.body?.maxPerGroup) || 6);
    return response(res, 201, result.message, result);
});

/**
 * Peta progres seluruh kelompok (SRS 5.8) — jendela utama panitia saat acara
 * berjalan: sudah sampai mana tiap kelompok, berapa yang menunggu divalidasi,
 * dan siapa saja anggotanya yang benar-benar hadir.
 */
export const getMonitoring = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    await ensureAdmin(req.user?.id as string);

    const rows = await db.execute(sql`
        SELECT
          g.id,
          g.name,
          g.score,
          g.leader_id                                              AS "leaderId",
          g.photo_url                                              AS "photoUrl",
          g.name_set_at                                            AS "nameSetAt",
          (SELECT COUNT(*) FROM users u WHERE u.group_id = g.id)   AS "memberCount",
          (SELECT COUNT(*) FROM users u
             WHERE u.group_id = g.id AND u.checkin_at IS NOT NULL) AS "presentCount",
          (SELECT COUNT(*) FROM submissions s
             WHERE s.group_id = g.id AND s.status = 'APPROVED')    AS "approvedCount",
          (SELECT COUNT(*) FROM submissions s
             WHERE s.group_id = g.id AND s.status = 'PENDING')     AS "pendingCount",
          (SELECT COUNT(*) FROM submissions s
             WHERE s.group_id = g.id AND s.status = 'REJECTED')    AS "rejectedCount",
          (SELECT COUNT(*) FROM mission_checkins c
             WHERE c.group_id = g.id AND c.checked_out_at IS NULL) AS "openCheckIns",
          (SELECT MAX(s.created_at) FROM submissions s
             WHERE s.group_id = g.id)                              AS "lastActivityAt"
        FROM groups g
        ORDER BY g.score DESC, g.name ASC
    `);

    const [{ total }] = (await db.execute(sql`SELECT COUNT(*)::int AS total FROM missions`)).rows as any[];

    return response(res, 200, 'Monitoring fetched', {
        totalMissions: Number(total),
        groups: rows.rows.map((r: any) => ({
            ...r,
            memberCount: Number(r.memberCount),
            presentCount: Number(r.presentCount),
            approvedCount: Number(r.approvedCount),
            pendingCount: Number(r.pendingCount),
            rejectedCount: Number(r.rejectedCount),
            openCheckIns: Number(r.openCheckIns),
        })),
    });
});

/**
 * Sudut pandang sebaliknya: per misi, kelompok mana saja yang sudah
 * mengerjakannya. Peta progres menjawab "kelompok A sampai mana"; ini menjawab
 * "misi A sudah dikerjakan siapa saja" — yang dibutuhkan penjaga pos.
 */
export const getMissionMonitoring = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    await ensureAdmin(req.user?.id as string);

    const [{ total }] = (await db.execute(sql`SELECT COUNT(*)::int AS total FROM groups`)).rows as any[];

    const rows = (await db.execute(sql`
        SELECT
          m.id, m.title, m.type, m.category, m.proof_type AS "proofType",
          m.requires_check_in AS "requiresCheckIn",
          COUNT(*) FILTER (WHERE s.status = 'APPROVED')  AS "approvedCount",
          COUNT(*) FILTER (WHERE s.status = 'PENDING')   AS "pendingCount",
          COUNT(*) FILTER (WHERE s.status = 'REJECTED')  AS "rejectedCount",
          COALESCE(
            json_agg(
              json_build_object('groupId', g.id, 'groupName', g.name, 'status', s.status,
                                'point', s.awarded_point, 'at', s.created_at)
              ORDER BY s.created_at DESC
            ) FILTER (WHERE s.id IS NOT NULL),
            '[]'
          ) AS groups
        FROM missions m
        LEFT JOIN submissions s ON s.mission_id = m.id
        LEFT JOIN groups g      ON g.id = s.group_id
        GROUP BY m.id
        ORDER BY m.is_mandatory DESC, m.created_at ASC
    `)).rows;

    return response(res, 200, 'Mission monitoring fetched', {
        totalGroups: Number(total),
        missions: rows.map((r: any) => ({
            ...r,
            approvedCount: Number(r.approvedCount),
            pendingCount: Number(r.pendingCount),
            rejectedCount: Number(r.rejectedCount),
        })),
    });
});

/** Rincian satu kelompok: anggota, kehadiran, riwayat misi, dan check-in pos. */
export const getGroupDetail = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    await ensureAdmin(req.user?.id as string);
    const groupId = req.params.groupId as string;

    const members = (await db.execute(sql`
        SELECT id, fullname, email, checkin_at AS "checkInAt"
        FROM users WHERE group_id = ${groupId} ORDER BY fullname
    `)).rows;

    const activity = (await db.execute(sql`
        SELECT s.id, s.status, s.awarded_point AS "awardedPoint", s.reject_reason AS "rejectReason",
               s.created_at AS "createdAt", s.validated_at AS "validatedAt",
               m.title AS "missionTitle",
               u.fullname AS "submittedByName",
               v.fullname AS "validatedByName"
        FROM submissions s
        JOIN missions m ON m.id = s.mission_id
        JOIN users u    ON u.id = s.submitted_by
        LEFT JOIN users v ON v.id = s.validated_by
        WHERE s.group_id = ${groupId}
        ORDER BY s.created_at DESC
    `)).rows;

    const checkIns = (await db.execute(sql`
        SELECT c.id, m.title AS "missionTitle", c.queue_number AS "queueNumber",
               c.checked_in_at AS "checkedInAt", c.checked_out_at AS "checkedOutAt",
               i.fullname AS "checkedInByName", o.fullname AS "checkedOutByName"
        FROM mission_checkins c
        JOIN missions m ON m.id = c.mission_id
        JOIN users i    ON i.id = c.checked_in_by
        LEFT JOIN users o ON o.id = c.checked_out_by
        WHERE c.group_id = ${groupId}
        ORDER BY c.checked_in_at DESC
    `)).rows;

    return response(res, 200, 'Group detail fetched', { members, activity, checkIns });
});

/** Daftar kelompok untuk pemilihan di form hasil lapangan. */
export const listGroups = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    await ensureAdmin(req.user?.id as string);

    const rows = await db
        .select({ id: groups.id, name: groups.name, score: groups.score })
        .from(groups)
        .orderBy(groups.name);

    return response(res, 200, 'Groups fetched', rows);
});

export const getBanners = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const banners = await db.select().from(sponsors);
    return response(res, 200, 'Banners fetched', banners);
});

export const createBanner = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.user?.id as string;
    await ensureSuperAdmin(userId);

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
    await ensureSuperAdmin(userId);

    const id = req.params.id as string;
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
    await ensureSuperAdmin(userId);

    const id = req.params.id as string;

    // Menghapus sponsor yang masih ditautkan ke misi melanggar foreign key dan
    // dulu berbalas 500. Beri tahu misi mana yang menahannya.
    const tagged = await db.select({ title: missions.title }).from(missions).where(eq(missions.sponsorId, id));
    if (tagged.length) {
        throw ApiError.conflict(
            `Sponsor masih ditautkan ke ${tagged.length} misi (${tagged.map(m => m.title).join(', ')}). Lepas tautannya lebih dulu.`,
        );
    }

    await db.delete(sponsors).where(eq(sponsors.id, id));
    return response(res, 200, 'Banner deleted', null);
});

export const verifyBarter = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.user?.id as string;
    await ensureAdmin(userId);

    const assignmentId = req.params.assignmentId as string;
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

        await recalculateGroupScore(tx, assignment[0].groupId);
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
