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
import { missionCheckins } from '../../db/schema/mission_checkins.ts';
import { groups } from '../../db/schema/groups.ts';
import { leaderVotes } from '../../db/schema/leader_votes.ts';
import { memberConfirmations } from '../../db/schema/member_confirmations.ts';
import { recalculateGroupScore } from '../../utils/groupScore.ts';
import { eq, and, sql, inArray, desc } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { nanoid } from 'nanoid';
import bcrypt from 'bcrypt';
import * as groupService from '../group/group.service.ts';
import * as missionService from '../mission/mission.service.ts';
import { ensureQrToken } from '../user/user.service.ts';
import { ensureAdmin, ensureSuperAdmin } from '../../utils/roles.ts';
import { submissions } from '../../db/schema/submissions.ts';
import { calculateMissionPoint } from '../../utils/scoring.ts';
import { getSettings } from '../settings/settings.service.ts';
import { broadcast, broadcastToGroup } from '../../realtime/hub.ts';

/**
 * Daftar akun & kelompok — satu tempat untuk menemukan siapa pun di acara ini.
 *
 * Master akun adalah pintu ke seluruh identitas acara: nomor telepon merangkap
 * kata sandi, dan kelompok menentukan ke mana poin jatuh. Karena itu seluruh
 * jalurnya — membaca maupun mengubah — dikunci untuk Super Admin.
 */
export const listAccounts = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    await ensureSuperAdmin(req.user?.id as string);

    const search = String(req.query.search ?? '').trim().toLowerCase();
    const roleFilter = String(req.query.role ?? '').trim();
    const page = Math.max(1, Number(req.query.page) || 1);
    const perPage = Math.min(200, Math.max(1, Number(req.query.perPage) || 25));

    const rows = await db
        .select({
            id: users.id,
            fullname: users.fullname,
            email: users.email,
            phoneNumber: users.phoneNumber,
            businessName: users.businessName,
            gender: users.gender,
            role: users.role,
            checkInAt: users.checkInAt,
            groupId: users.groupId,
            // Nama kelompoknya ikut supaya panitia bisa melihat — dan mencari —
            // pembagian kelompok tanpa berpindah ke daftar lain.
            groupName: groups.name,
            qrToken: users.qrToken,
        })
        .from(users)
        .leftJoin(groups, eq(groups.id, users.groupId))
        .orderBy(users.fullname);

    const filtered = rows.filter(u => {
        if (roleFilter && u.role !== roleFilter) return false;
        if (!search) return true;
        return `${u.fullname} ${u.email ?? ''} ${u.phoneNumber ?? ''} ${u.groupName ?? ''}`
            .toLowerCase()
            .includes(search);
    });

    const start = (page - 1) * perPage;

    // qrToken tidak ikut dikirim di sini. Menelusuri daftar akun tidak boleh
    // menaruh ratusan kredensial di browser panitia — token baru diambil
    // lewat endpoint terpisah, hanya untuk orang yang benar-benar dicetak.
    const items = filtered.slice(start, start + perPage).map(({ qrToken, ...u }) => ({
        ...u,
        hasQrToken: Boolean(qrToken),
    }));

    return response(res, 200, 'Accounts fetched', {
        page,
        perPage,
        total: filtered.length,
        totalPages: Math.max(1, Math.ceil(filtered.length / perPage)),
        counts: {
            all: rows.length,
            PARTICIPANT: rows.filter(u => u.role === 'PARTICIPANT').length,
            ADMIN: rows.filter(u => u.role === 'ADMIN').length,
            SUPER_ADMIN: rows.filter(u => u.role === 'SUPER_ADMIN').length,
        },
        items,
    });
});

/**
 * Token QR untuk sekumpulan peserta yang dipilih panitia.
 *
 * Dipisahkan dari daftar akun dengan sengaja: token adalah kredensial, dan
 * membuka halaman daftar tidak boleh menarik kredensial semua orang ke
 * browser. Di sini panitia sudah menyatakan siapa yang akan dicetak.
 */
export const getQrTokensForPrint = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    await ensureSuperAdmin(req.user?.id as string);

    const { userIds } = req.body ?? {};
    if (!Array.isArray(userIds) || userIds.length === 0) {
        return next(ApiError.badRequest('Pilih peserta yang akan dicetak terlebih dahulu'));
    }
    if (userIds.length > 500) {
        return next(ApiError.badRequest('Maksimal 500 kartu sekali cetak'));
    }

    const rows = await db
        .select({
            id: users.id,
            fullname: users.fullname,
            businessName: users.businessName,
            role: users.role,
            qrToken: users.qrToken,
        })
        .from(users)
        .where(inArray(users.id, userIds))
        .orderBy(users.fullname);

    // Panitia masuk lewat email & nomor telepon, tidak punya kartu QR.
    const participants = rows.filter(u => u.role === 'PARTICIPANT');
    const skipped = rows.filter(u => u.role !== 'PARTICIPANT').map(u => u.fullname);

    const cards = await Promise.all(
        participants.map(async u => ({
            id: u.id,
            fullname: u.fullname,
            businessName: u.businessName,
            qrToken: await ensureQrToken(u.id, u.qrToken),
        })),
    );

    return response(res, 200, 'QR tokens fetched', { cards, skipped });
});

/**
 * Mengubah peran beberapa akun sekaligus.
 *
 * Mengangkat panitia satu per satu menjelang hari-H memakan waktu, dan
 * setiap klik adalah satu kesempatan salah pilih orang.
 */
export const setAccountRolesBulk = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const actorId = req.user?.id as string;
    await ensureSuperAdmin(actorId);

    const { userIds, role } = req.body ?? {};
    if (!Array.isArray(userIds) || userIds.length === 0) {
        return next(ApiError.badRequest('Pilih akun terlebih dahulu'));
    }
    if (!['PARTICIPANT', 'ADMIN', 'SUPER_ADMIN'].includes(role)) {
        return next(ApiError.badRequest('Peran tidak dikenali'));
    }

    // Menurunkan peran diri sendiri bisa membuat acara kehilangan Super Admin
    // terakhirnya di tengah jalan — disaring, bukan menggagalkan seluruh batch.
    const targets = userIds.filter((id: string) => !(id === actorId && role !== 'SUPER_ADMIN'));
    const skippedSelf = targets.length !== userIds.length;

    if (targets.length === 0) {
        return next(ApiError.badRequest('Anda tidak bisa menurunkan peran akun Anda sendiri'));
    }

    await db.update(users)
        .set({ role, updatedAt: new Date() })
        .where(inArray(users.id, targets));

    return response(res, 200, 'Peran akun diperbarui', {
        updated: targets.length,
        skippedSelf,
    });
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

    const { groupId, point, referenceId } = req.body ?? {};
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

/** Antrean pertukaran Bigger Better yang menunggu validasi panitia. */
export const getBarterQueue = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    await ensureAdmin(req.user?.id as string);

    const rows = (await db.execute(sql`
        SELECT b.id, b.step_no AS "stepNo", b.item_from AS "itemFrom", b.item_to AS "itemTo",
               b.partner_name AS "partnerName", b.video_url AS "mediaUrl", b.created_at AS "createdAt",
               g.id AS "groupId", g.name AS "groupName", m.title AS "missionTitle",
               -- Assignment ikut dikirim karena "Akhiri" menutup seluruh rantai
               -- kelompok itu, bukan satu pertukaran yang sedang dilihat.
               a.id AS "assignmentId",
               (SELECT COUNT(*)::int FROM barter_steps s
                  WHERE s.assignment_id = a.id AND s.status = 'APPROVED') AS "approvedSteps"
        FROM barter_steps b
        JOIN assignments a ON a.id = b.assignment_id
        JOIN groups g      ON g.id = a.group_id
        JOIN missions m    ON m.id = a.mission_id
        WHERE b.status = 'PENDING'
        ORDER BY b.created_at ASC
    `)).rows;

    return response(res, 200, 'Barter queue fetched', rows);
});

/**
 * Validasi satu pertukaran. Setiap pertukaran yang disetujui bernilai poin
 * tetap yang bisa diatur panitia — pemenangnya adalah kelompok dengan
 * pertukaran sah terbanyak.
 *
 * Penolakan menutup rantainya. Dulu kelompok dibiarkan memperbaiki lalu
 * mengirim ulang, tetapi barter berlangsung di lapangan dengan barang yang
 * sudah berpindah tangan — tidak ada yang bisa "diperbaiki", dan misinya hanya
 * menggantung di daftar mereka sampai acara usai.
 */
export const validateBarterStep = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.user?.id as string;
    await ensureAdmin(userId);

    const stepId = req.params.stepId as string;
    const { status, rejectReason } = req.body ?? {};
    if (!['APPROVED', 'REJECTED'].includes(status)) {
        throw ApiError.badRequest('status harus APPROVED atau REJECTED');
    }

    const [step] = await db.select().from(barterSteps).where(eq(barterSteps.id, stepId)).limit(1);
    if (!step) throw ApiError.notFound('Pertukaran tidak ditemukan');
    if (step.status !== 'PENDING') throw ApiError.badRequest('Pertukaran ini sudah divalidasi');

    const [assignment] = await db.select().from(assignments)
        .where(eq(assignments.id, step.assignmentId)).limit(1);
    if (!assignment) throw ApiError.notFound('Assignment tidak ditemukan');

    const settings = await getSettings();
    const point = status === 'APPROVED' ? settings.barterPointPerStep : 0;

    await db.transaction(async (tx: any) => {
        await tx.update(barterSteps).set({
            status,
            isValid: status === 'APPROVED',
            awardedPoint: point,
            rejectReason: status === 'REJECTED' ? (rejectReason ?? null) : null,
            validatedBy: userId,
            validatedAt: new Date(),
            updatedAt: new Date(),
        }).where(eq(barterSteps.id, stepId));

        if (status === 'REJECTED') {
            await tx.update(assignments)
                .set({ status: 'REJECTED', rejectReason: rejectReason ?? null, updatedAt: new Date() })
                .where(eq(assignments.id, assignment.id));
        }

        if (point > 0) {
            await tx.insert(scoreEntries).values({
                id: nanoid(16),
                groupId: assignment.groupId,
                source: 'BARTER',
                referenceId: stepId,
                point,
                createdBy: userId,
            });
            await recalculateGroupScore(tx, assignment.groupId);
        }
    });

    broadcastToGroup(assignment.groupId, 'barter:validated', {
        stepId,
        status,
        point,
        /** Rantai ditutup: misi barternya pindah ke bagian selesai di layar peserta. */
        closed: status === 'REJECTED',
    });
    broadcast('leaderboard:changed', { groupId: assignment.groupId });

    return response(
        res,
        200,
        status === 'APPROVED'
            ? `Pertukaran disetujui — ${point} poin untuk kelompok ini`
            : 'Pertukaran ditolak — rantai barter kelompok ini ditutup',
        { stepId, status, point },
    );
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

    const page = Math.max(1, Number(req.query.page) || 1);
    const perPage = Math.min(200, Math.max(5, Number(req.query.perPage) || 25));
    const offset = (page - 1) * perPage;

    const [{ count: groupTotal }] = (await db.execute(sql`SELECT COUNT(*)::int AS count FROM groups`)).rows as any[];

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
        LIMIT ${perPage} OFFSET ${offset}
    `);

    const [{ total }] = (await db.execute(sql`SELECT COUNT(*)::int AS total FROM missions`)).rows as any[];

    // Berapa peserta hadir yang belum kebagian kelompok — panitia perlu tahu
    // ini sebelum menekan Generate Kelompok.
    const [peserta] = (await db.execute(sql`
        SELECT
          COUNT(*)::int                                                            AS "totalParticipants",
          COUNT(*) FILTER (WHERE checkin_at IS NOT NULL)::int                      AS "checkedIn",
          COUNT(*) FILTER (WHERE checkin_at IS NOT NULL AND group_id IS NULL)::int  AS "waitingForGroup"
        FROM users WHERE role = 'PARTICIPANT'
    `)).rows as any[];

    return response(res, 200, 'Monitoring fetched', {
        page,
        perPage,
        totalGroups: Number(groupTotal),
        totalPages: Math.max(1, Math.ceil(Number(groupTotal) / perPage)),
        totalMissions: Number(total),
        totalParticipants: Number(peserta.totalParticipants),
        checkedIn: Number(peserta.checkedIn),
        waitingForGroup: Number(peserta.waitingForGroup),
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

    const page = Math.max(1, Number(req.query.page) || 1);
    const perPage = Math.min(200, Math.max(5, Number(req.query.perPage) || 25));
    const offset = (page - 1) * perPage;
    const [{ count: missionTotal }] = (await db.execute(sql`SELECT COUNT(*)::int AS count FROM missions`)).rows as any[];

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
        LIMIT ${perPage} OFFSET ${offset}
    `)).rows;

    return response(res, 200, 'Mission monitoring fetched', {
        page,
        perPage,
        totalMissions: Number(missionTotal),
        totalPages: Math.max(1, Math.ceil(Number(missionTotal) / perPage)),
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
        SELECT c.id, m.title AS "missionTitle",
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

/**
 * Daftar kelompok — dipakai form hasil lapangan sekaligus tab Kelompok di
 * master akun, jadi jumlah anggotanya ikut dihitung di sini.
 */
export const listGroups = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    await ensureAdmin(req.user?.id as string);

    const rows = (await db.execute(sql`
        SELECT g.id, g.name, g.score, g.category_id AS "categoryId",
               (SELECT COUNT(*)::int FROM users u WHERE u.group_id = g.id)                       AS "memberCount",
               (SELECT COUNT(*)::int FROM users u WHERE u.group_id = g.id AND u.gender = 'L')    AS "maleCount",
               (SELECT COUNT(*)::int FROM users u WHERE u.group_id = g.id AND u.gender = 'P')    AS "femaleCount"
        FROM groups g
        ORDER BY g.name ASC
    `)).rows;

    return response(res, 200, 'Groups fetched', rows);
});

export const getBanners = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const banners = await db.select().from(sponsors);
    return response(res, 200, 'Banners fetched', banners);
});

export const createBanner = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.user?.id as string;
    await ensureSuperAdmin(userId);

    const { name, logoUrl, linkUrl, orderNum, isActive } = req.body ?? {};
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

/**
 * Mengakhiri rantai barter sebuah kelompok.
 *
 * Bigger Better tidak punya garis akhir alami: kelompok bisa terus menukar
 * sampai waktu habis. Panitialah yang menutupnya — memberi nilai akhir atas
 * keseluruhan rantai, lalu misinya berhenti muncul sebagai tugas di layar
 * kelompok itu.
 */
export const finishBarter = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const userId = req.user?.id as string;
    await ensureAdmin(userId);

    const assignmentId = req.params.assignmentId as string;
    const point = Number(req.body?.point);

    if (!Number.isInteger(point) || point < 0) {
        return next(ApiError.badRequest('Nilai akhir harus bilangan bulat tidak negatif'));
    }

    const [assignment] = await db.select().from(assignments)
        .where(eq(assignments.id, assignmentId)).limit(1);
    if (!assignment) return next(ApiError.notFound('Rantai barter tidak ditemukan'));
    if (assignment.status === 'ACCEPTED' || assignment.status === 'REJECTED') {
        return next(ApiError.badRequest('Rantai barter kelompok ini sudah diakhiri'));
    }

    await db.transaction(async (tx: any) => {
        // Pertukaran yang masih menunggu ikut ditutup: penilaiannya sudah
        // terwakili oleh nilai akhir, dan meninggalkannya menggantung berarti
        // antrean validasi menyimpan baris yang tidak bisa ditindaklanjuti.
        await tx.update(barterSteps)
            .set({
                status: 'APPROVED',
                awardedPoint: 0,
                validatedBy: userId,
                validatedAt: new Date(),
                updatedAt: new Date(),
            })
            .where(and(eq(barterSteps.assignmentId, assignmentId), eq(barterSteps.status, 'PENDING')));

        await tx.update(assignments)
            .set({ status: 'ACCEPTED', updatedAt: new Date() })
            .where(eq(assignments.id, assignmentId));

        if (point > 0) {
            await tx.insert(scoreEntries).values({
                id: nanoid(16),
                groupId: assignment.groupId,
                source: 'BARTER',
                referenceId: assignmentId,
                point,
                createdBy: userId,
            });
            await recalculateGroupScore(tx, assignment.groupId);
        }
    });

    broadcastToGroup(assignment.groupId, 'barter:validated', {
        assignmentId,
        status: 'FINISHED',
        point,
        closed: true,
    });
    broadcast('leaderboard:changed', { groupId: assignment.groupId });

    return response(res, 200, `Rantai barter diakhiri — nilai akhir ${point} poin`, {
        assignmentId,
        point,
    });
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

/**
 * Kartu QR peserta untuk dicetak.
 *
 * Tanpa ini login lewat QR mengunci dirinya sendiri: kode hanya tergambar di
 * layar peserta yang sudah masuk, padahal justru kode itulah yang dipakai
 * untuk masuk. Panitia mencetak dari sini sebelum acara, lalu membagikannya
 * di meja registrasi.
 *
 * qrToken adalah kredensial — hanya panitia yang boleh membacanya, dan hanya
 * milik peserta.
 */
export const listParticipantQrCards = catchAsync(async (req: Request, res: Response) => {
  await ensureAdmin(req.user?.id as string);

  const search = String(req.query.search ?? '').trim().toLowerCase();

  const rows = await db
    .select({
      id: users.id,
      fullname: users.fullname,
      email: users.email,
      phoneNumber: users.phoneNumber,
      businessName: users.businessName,
      qrToken: users.qrToken,
      checkInAt: users.checkInAt,
      groupId: users.groupId,
    })
    .from(users)
    .where(eq(users.role, 'PARTICIPANT'))
    .orderBy(users.fullname);

  const filtered = search
    ? rows.filter(u =>
        `${u.fullname} ${u.email ?? ''} ${u.phoneNumber ?? ''}`.toLowerCase().includes(search),
      )
    : rows;

  // Peserta yang didaftarkan sebelum login-QR ada belum punya token. Selama ini
  // token itu baru dibuat saat mereka membuka profilnya sendiri — padahal
  // justru token inilah yang mereka butuhkan untuk bisa masuk. Dibuatkan di
  // sini supaya tidak ada kartu kosong di lembar cetak.
  const withToken = await Promise.all(
    filtered.map(async u =>
      u.qrToken ? u : { ...u, qrToken: await ensureQrToken(u.id, u.qrToken) },
    ),
  );

  return response(res, 200, 'Participant QR cards fetched', withToken);
});

/**
 * Petugas pos memindai QR peserta.
 *
 * Sebelumnya kedatangan di pos dicatat peserta sendiri dari ponselnya, jadi
 * kelompok bisa mengaku hadir tanpa benar-benar datang. Sekarang petugaslah
 * yang memindai: sistem menemukan kelompok peserta itu, lalu mencatat
 * kedatangan atau kepergian atas nama petugas.
 */
export const postScan = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const officerId = req.user?.id as string;
  await ensureAdmin(officerId);

  const { qrToken, missionId, action } = req.body ?? {};
  if (!qrToken) return next(ApiError.badRequest('qrToken wajib diisi'));
  if (!missionId) return next(ApiError.badRequest('Pilih pos/misi terlebih dahulu'));

  // `action` boleh dikosongkan. Petugas yang menghadapi antrean tidak sempat
  // menekan tombol mode setiap kali, dan salah mode berarti catatan yang
  // keliru — jadi sistem yang menyimpulkannya dari keadaan kelompok itu.
  const explicitAction = action === 'CHECK_IN' || action === 'CHECK_OUT' ? action : null;
  if (action != null && !explicitAction) {
    return next(ApiError.badRequest('action harus CHECK_IN atau CHECK_OUT'));
  }

  const [participant] = await db
    .select({ id: users.id, fullname: users.fullname, role: users.role, groupId: users.groupId })
    .from(users)
    .where(eq(users.qrToken, qrToken))
    .limit(1);

  if (!participant || participant.role !== 'PARTICIPANT') {
    return next(ApiError.notFound('QR tidak dikenali atau bukan milik peserta'));
  }
  if (!participant.groupId) {
    return next(ApiError.badRequest(`${participant.fullname} belum tergabung dalam kelompok`));
  }

  const [mission] = await db.select().from(missions).where(eq(missions.id, missionId)).limit(1);
  if (!mission) return next(ApiError.notFound('Pos tidak ditemukan'));

  const existing = await missionService.getCheckIn(missionId, participant.groupId);
  const resolvedAction =
    explicitAction ?? (existing && !existing.checkedOutAt ? 'CHECK_OUT' : 'CHECK_IN');

  const result =
    resolvedAction === 'CHECK_IN'
      ? await missionService.checkInMission(missionId, participant.groupId, officerId, participant.id)
      : await missionService.checkOutMission(missionId, participant.groupId, officerId, true);

  const [group] = await db
    .select({ name: groups.name })
    .from(groups)
    .where(eq(groups.id, participant.groupId))
    .limit(1);

  // Yang dipindai petugas hanya satu orang, tetapi yang tercatat adalah
  // kelompoknya. Tanpa siaran ini, anggota lain — dan bahkan pemilik QR-nya
  // sendiri, yang layarnya sedang dipegang petugas — tidak pernah tahu
  // kedatangannya sudah masuk sistem.
  broadcastToGroup(participant.groupId, 'post:scanned', {
    action: resolvedAction,
    missionId,
    postName: mission.title,
    participantName: participant.fullname,
    groupName: group?.name ?? null,
    at: new Date().toISOString(),
  });

  return response(res, resolvedAction === 'CHECK_IN' ? 201 : 200, 'Tercatat di pos', {
    ...result,
    action: resolvedAction,
    /** Disimpulkan sistem, bukan dipilih petugas. */
    inferred: explicitAction === null,
    participantName: participant.fullname,
    groupId: participant.groupId,
    groupName: group?.name ?? null,
    missionTitle: mission.title,
  });
});

/**
 * Kelompok yang sedang berada di sebuah pos.
 *
 * Menyatukan pemindaian dengan penilaian: begitu petugas memindai QR, kelompok
 * itu muncul di layarnya lengkap dengan keadaan penilaiannya, jadi tidak perlu
 * pindah halaman lalu mencari nama kelompoknya di daftar berisi puluhan.
 */
export const getPostQueue = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  await ensureAdmin(req.user?.id as string);

  const missionId = req.params.missionId as string;
  const [mission] = await db.select().from(missions).where(eq(missions.id, missionId)).limit(1);
  if (!mission) return next(ApiError.notFound('Pos tidak ditemukan'));

  const scannedBy = alias(users, 'scanned_by');

  const rows = await db
    .select({
      checkInId: missionCheckins.id,
      groupId: missionCheckins.groupId,
      groupName: groups.name,
      groupScore: groups.score,
      checkedInAt: missionCheckins.checkedInAt,
      checkedOutAt: missionCheckins.checkedOutAt,
      scannedName: scannedBy.fullname,
    })
    .from(missionCheckins)
    .innerJoin(groups, eq(groups.id, missionCheckins.groupId))
    .leftJoin(scannedBy, eq(scannedBy.id, missionCheckins.scannedParticipantId))
    .where(eq(missionCheckins.missionId, missionId))
    .orderBy(desc(missionCheckins.checkedInAt));

  // Hasil yang sudah tercatat untuk pos ini, supaya petugas tahu kelompok mana
  // yang masih perlu dinilai.
  const scored = await db
    .select({
      groupId: submissions.groupId,
      status: submissions.status,
      awardedPoint: submissions.awardedPoint,
    })
    .from(submissions)
    .where(eq(submissions.missionId, missionId));

  const byGroup = new Map(scored.map(s => [s.groupId, s]));

  const items = rows.map(r => {
    const result = byGroup.get(r.groupId);
    return {
      ...r,
      // Sudah dinilai, masih menunggu, atau belum tersentuh sama sekali.
      resultStatus: result?.status ?? null,
      awardedPoint: result?.awardedPoint ?? null,
    };
  });

  return response(res, 200, 'Post queue fetched', {
    mission: {
      id: mission.id,
      title: mission.title,
      locationName: mission.locationName,
      proofType: mission.proofType,
      scoringMode: mission.scoringMode,
      pointWeight: mission.pointWeight,
      pointMin: mission.pointMin,
      pointMax: mission.pointMax,
      pointPerUnit: mission.pointPerUnit,
      maxUnits: mission.maxUnits,
      timeTargetSeconds: mission.timeTargetSeconds,
    },
    // Yang masih di dalam pos didahulukan; yang sudah pergi tetap tampil
    // supaya penilaian yang terlewat masih bisa disusulkan.
    active: items.filter(i => !i.checkedOutAt),
    departed: items.filter(i => i.checkedOutAt),
  });
});

/**
 * Panitia mendaftarkan peserta baru.
 *
 * Peserta tidak mendaftar sendiri: panitia yang memasukkan datanya dari daftar
 * hadir, lalu mencetak kartu QR-nya. Nomor telepon sekaligus menjadi kata
 * sandinya — itulah yang diketik peserta di layar masuk.
 */
export const createAccount = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  await ensureSuperAdmin(req.user?.id as string);

  const { fullname, phoneNumber, email, businessName, role, gender } = req.body ?? {};

  if (!fullname || String(fullname).trim().length < 2) {
    return next(ApiError.badRequest('Nama lengkap wajib diisi'));
  }
  if (!phoneNumber || String(phoneNumber).trim().length < 6) {
    return next(ApiError.badRequest('Nomor telepon wajib diisi'));
  }

  const wantedRole = role ?? 'PARTICIPANT';
  if (!['PARTICIPANT', 'ADMIN', 'SUPER_ADMIN'].includes(wantedRole)) {
    return next(ApiError.badRequest('Peran tidak dikenali'));
  }

  // Jenis kelamin boleh kosong — sebagian akun panitia memang tidak diisi.
  const cleanGender = gender ? String(gender).trim().toUpperCase() : null;
  if (cleanGender && !['L', 'P'].includes(cleanGender)) {
    return next(ApiError.badRequest('Jenis kelamin harus L atau P'));
  }

  const phone = String(phoneNumber).trim();
  const [dupPhone] = await db.select({ id: users.id }).from(users)
    .where(eq(users.phoneNumber, phone)).limit(1);
  if (dupPhone) return next(ApiError.conflict('Nomor telepon ini sudah terdaftar'));

  const cleanEmail = email ? String(email).trim().toLowerCase() : null;
  if (cleanEmail) {
    const [dupEmail] = await db.select({ id: users.id }).from(users)
      .where(eq(users.email, cleanEmail)).limit(1);
    if (dupEmail) return next(ApiError.conflict('Email ini sudah terdaftar'));
  }

  const id = nanoid(16);
  // Nomor telepon berperan sebagai kata sandi, disimpan sebagai hash — sama
  // seperti jalur pendaftaran mandiri.
  const password = await bcrypt.hash(phone, 10);

  const [created] = await db.insert(users).values({
    id,
    fullname: String(fullname).trim(),
    phoneNumber: phone,
    email: cleanEmail,
    businessName: businessName ? String(businessName).trim() : null,
    gender: cleanGender as 'L' | 'P' | null,
    role: wantedRole,
    password,
    qrToken: nanoid(32),
  }).returning({ id: users.id, fullname: users.fullname, role: users.role });

  return response(res, 201, `${created.fullname} ditambahkan`, created);
});

/** Menyunting data akun. Peran diubah lewat jalurnya sendiri. */
export const updateAccount = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  await ensureSuperAdmin(req.user?.id as string);

  const targetId = req.params.userId as string;
  const { fullname, phoneNumber, email, businessName, gender } = req.body ?? {};

  const [target] = await db.select({ id: users.id }).from(users).where(eq(users.id, targetId)).limit(1);
  if (!target) return next(ApiError.notFound('Akun tidak ditemukan'));

  const patch: Record<string, unknown> = { updatedAt: new Date() };

  if (fullname !== undefined) {
    if (String(fullname).trim().length < 2) return next(ApiError.badRequest('Nama lengkap wajib diisi'));
    patch.fullname = String(fullname).trim();
  }

  if (phoneNumber !== undefined) {
    const phone = String(phoneNumber).trim();
    if (phone.length < 6) return next(ApiError.badRequest('Nomor telepon tidak valid'));
    const [dup] = await db.select({ id: users.id }).from(users)
      .where(eq(users.phoneNumber, phone)).limit(1);
    if (dup && dup.id !== targetId) return next(ApiError.conflict('Nomor telepon ini sudah terdaftar'));
    patch.phoneNumber = phone;
    // Nomor telepon adalah kata sandinya; mengubah satu tanpa yang lain akan
    // mengunci pemiliknya di luar akunnya sendiri.
    patch.password = await bcrypt.hash(phone, 10);
  }

  if (email !== undefined) {
    const cleanEmail = email ? String(email).trim().toLowerCase() : null;
    if (cleanEmail) {
      const [dup] = await db.select({ id: users.id }).from(users)
        .where(eq(users.email, cleanEmail)).limit(1);
      if (dup && dup.id !== targetId) return next(ApiError.conflict('Email ini sudah terdaftar'));
    }
    patch.email = cleanEmail;
  }

  if (businessName !== undefined) {
    patch.businessName = businessName ? String(businessName).trim() : null;
  }

  if (gender !== undefined) {
    const cleanGender = gender ? String(gender).trim().toUpperCase() : null;
    if (cleanGender && !['L', 'P'].includes(cleanGender)) {
      return next(ApiError.badRequest('Jenis kelamin harus L atau P'));
    }
    patch.gender = cleanGender;
  }

  await db.update(users).set(patch).where(eq(users.id, targetId));
  return response(res, 200, 'Akun diperbarui', { id: targetId });
});

/**
 * Alasan sebuah akun tidak boleh dihapus, atau null bila boleh.
 *
 * Akun yang sudah meninggalkan jejak permainan tidak dihapus — menghapusnya
 * akan melubangi riwayat penilaian dan melanggar kunci asing. Yang seperti itu
 * ditolak dengan alasan yang jelas, bukan dibiarkan gagal sebagai galat basis
 * data. Dipakai bersama oleh penghapusan satuan maupun massal.
 */
const findDeleteBlocker = async (userId: string, fullname: string) => {
  const [hasSubmission] = await db.select({ id: submissions.id }).from(submissions)
    .where(eq(submissions.submittedBy, userId)).limit(1);
  if (hasSubmission) {
    return `${fullname} sudah mengirim bukti misi, jadi akunnya tidak bisa dihapus. Ubah datanya bila keliru.`;
  }

  const [hasScore] = await db.select({ id: scoreEntries.id }).from(scoreEntries)
    .where(eq(scoreEntries.createdBy, userId)).limit(1);
  if (hasScore) return `${fullname} tercatat pernah memberi poin, jadi akunnya tidak bisa dihapus.`;

  const [hasCheckIn] = await db.select({ id: missionCheckins.id }).from(missionCheckins)
    .where(eq(missionCheckins.checkedInBy, userId)).limit(1);
  if (hasCheckIn) return `${fullname} tercatat di pos, jadi akunnya tidak bisa dihapus.`;

  return null;
};

/**
 * Jejak pilihan & konfirmasi yang tidak bernilai poin — ikut terhapus.
 *
 * Tanpa ini penghapusan gagal sebagai galat kunci asing yang tidak bisa
 * dimengerti panitia, padahal barisnya memang tidak berarti apa-apa lagi.
 */
const clearUserTraces = async (userIds: string[]) => {
  await db.delete(leaderVotes).where(inArray(leaderVotes.voterId, userIds));
  await db.delete(leaderVotes).where(inArray(leaderVotes.candidateId, userIds));
  await db.delete(memberConfirmations).where(inArray(memberConfirmations.confirmerId, userIds));
  await db.delete(memberConfirmations).where(inArray(memberConfirmations.confirmedId, userIds));

  // leaderId & photoBy menunjuk ke users tanpa kunci asing, jadi tidak ikut
  // terjaga database — dibersihkan di sini supaya tidak menunjuk ke ketiadaan.
  await db.update(groups).set({ leaderId: null }).where(inArray(groups.leaderId, userIds));
  await db.update(groups).set({ photoBy: null }).where(inArray(groups.photoBy, userIds));
};

export const deleteAccount = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const actorId = req.user?.id as string;
  await ensureSuperAdmin(actorId);

  const targetId = req.params.userId as string;
  if (targetId === actorId) {
    return next(ApiError.badRequest('Anda tidak bisa menghapus akun Anda sendiri'));
  }

  const [target] = await db.select({ id: users.id, fullname: users.fullname })
    .from(users).where(eq(users.id, targetId)).limit(1);
  if (!target) return next(ApiError.notFound('Akun tidak ditemukan'));

  const blocker = await findDeleteBlocker(target.id, target.fullname);
  if (blocker) return next(ApiError.conflict(blocker));

  await clearUserTraces([targetId]);
  await db.delete(users).where(eq(users.id, targetId));
  return response(res, 200, `${target.fullname} dihapus`, null);
});

/**
 * Menghapus beberapa akun sekaligus.
 *
 * Salah unggah lembar peserta menghasilkan puluhan baris yang harus dibersihkan;
 * menghapusnya satu per satu berarti puluhan dialog konfirmasi. Akun yang punya
 * jejak permainan tetap dilewati — dengan alasannya, bukan diam-diam.
 */
export const deleteAccountsBulk = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const actorId = req.user?.id as string;
  await ensureSuperAdmin(actorId);

  const { userIds } = req.body ?? {};
  if (!Array.isArray(userIds) || userIds.length === 0) {
    return next(ApiError.badRequest('Pilih akun yang akan dihapus terlebih dahulu'));
  }

  const targets = await db.select({ id: users.id, fullname: users.fullname })
    .from(users).where(inArray(users.id, userIds));

  const deletable: string[] = [];
  const skipped: Array<{ name: string; reason: string }> = [];

  for (const target of targets) {
    if (target.id === actorId) {
      skipped.push({ name: target.fullname, reason: 'Akun Anda sendiri' });
      continue;
    }
    const blocker = await findDeleteBlocker(target.id, target.fullname);
    if (blocker) skipped.push({ name: target.fullname, reason: blocker });
    else deletable.push(target.id);
  }

  if (deletable.length) {
    await clearUserTraces(deletable);
    await db.delete(users).where(inArray(users.id, deletable));
  }

  return response(res, 200, `${deletable.length} akun dihapus`, {
    deleted: deletable.length,
    skipped,
  });
});

/** Memindahkan peserta ke sebuah kelompok. Panitia tidak ikut berkelompok. */
const placeInGroup = async (userIds: string[], groupId: string | null) => {
  const participants = await db.select({ id: users.id }).from(users)
    .where(and(inArray(users.id, userIds), eq(users.role, 'PARTICIPANT')));

  if (!participants.length) return 0;

  await db.update(users)
    .set({ groupId, updatedAt: new Date() })
    .where(inArray(users.id, participants.map(p => p.id)));

  return participants.length;
};

/**
 * Membuat kelompok, sekaligus mengisinya.
 *
 * Panitia menyusun kelompok dari daftar akun yang sedang dilihatnya: pilih
 * beberapa nama, beri nama kelompoknya, selesai. Tanpa ini pembagian manual
 * hanya mungkin lewat unggahan lembar kerja.
 */
export const createGroup = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  await ensureSuperAdmin(req.user?.id as string);

  const name = String(req.body?.name ?? '').trim();
  const memberIds: string[] = Array.isArray(req.body?.memberIds) ? req.body.memberIds : [];

  if (name.length < 2) return next(ApiError.badRequest('Nama kelompok wajib diisi'));

  const [existing] = await db.select({ id: groups.id }).from(groups)
    .where(sql`LOWER(${groups.name}) = ${name.toLowerCase()}`).limit(1);
  if (existing) return next(ApiError.conflict(`Kelompok "${name}" sudah ada`));

  const id = nanoid(16);
  // Hitung mundur pembentukan mulai berjalan begitu kelompoknya ada.
  await db.insert(groups).values({ id, name, startedAt: new Date() });

  const placed = memberIds.length ? await placeInGroup(memberIds, id) : 0;

  return response(res, 201, `Kelompok "${name}" dibuat dengan ${placed} anggota`, { id, placed });
});

export const setGroupMembers = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  await ensureSuperAdmin(req.user?.id as string);

  const groupId = req.params.groupId as string;
  const { userIds } = req.body ?? {};
  if (!Array.isArray(userIds) || userIds.length === 0) {
    return next(ApiError.badRequest('Pilih peserta yang akan dimasukkan terlebih dahulu'));
  }

  const [group] = await db.select({ id: groups.id, name: groups.name })
    .from(groups).where(eq(groups.id, groupId)).limit(1);
  if (!group) return next(ApiError.notFound('Kelompok tidak ditemukan'));

  const placed = await placeInGroup(userIds, groupId);
  return response(res, 200, `${placed} peserta masuk ke ${group.name}`, { placed });
});

/**
 * Membubarkan kelompok.
 *
 * Anggotanya tidak ikut terhapus — mereka kembali menjadi peserta tanpa
 * kelompok, siap dimasukkan ke kelompok lain. Kelompok yang sudah bertanding
 * (punya bukti misi, poin, atau catatan pos) dipertahankan: membubarkannya
 * berarti melubangi papan skor.
 */
export const deleteGroups = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  await ensureSuperAdmin(req.user?.id as string);

  const { groupIds } = req.body ?? {};
  if (!Array.isArray(groupIds) || groupIds.length === 0) {
    return next(ApiError.badRequest('Pilih kelompok yang akan dibubarkan terlebih dahulu'));
  }

  const targets = await db.select({ id: groups.id, name: groups.name })
    .from(groups).where(inArray(groups.id, groupIds));

  const removed: string[] = [];
  const skipped: Array<{ name: string; reason: string }> = [];

  for (const group of targets) {
    const [hasSubmission] = await db.select({ id: submissions.id }).from(submissions)
      .where(eq(submissions.groupId, group.id)).limit(1);
    const [hasScore] = await db.select({ id: scoreEntries.id }).from(scoreEntries)
      .where(eq(scoreEntries.groupId, group.id)).limit(1);
    const [hasCheckIn] = await db.select({ id: missionCheckins.id }).from(missionCheckins)
      .where(eq(missionCheckins.groupId, group.id)).limit(1);
    const [hasAssignment] = await db.select({ id: assignments.id }).from(assignments)
      .where(eq(assignments.groupId, group.id)).limit(1);

    if (hasSubmission || hasScore || hasCheckIn || hasAssignment) {
      skipped.push({
        name: group.name,
        reason: `${group.name} sudah bertanding — riwayat penilaiannya akan ikut hilang.`,
      });
      continue;
    }

    await db.update(users).set({ groupId: null, updatedAt: new Date() })
      .where(eq(users.groupId, group.id));
    await db.delete(leaderVotes).where(eq(leaderVotes.groupId, group.id));
    await db.delete(memberConfirmations).where(eq(memberConfirmations.groupId, group.id));
    await db.delete(groups).where(eq(groups.id, group.id));
    removed.push(group.name);
  }

  return response(res, 200, `${removed.length} kelompok dibubarkan`, {
    deleted: removed.length,
    skipped,
  });
});
