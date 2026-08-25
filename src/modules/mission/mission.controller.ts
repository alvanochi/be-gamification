import { Request, Response, NextFunction } from 'express';
import * as missionService from './mission.service.ts';
import * as questionService from './question.service.ts';
import { ensureSuperAdmin } from '../../utils/roles.ts';
import catchAsync from '../../utils/catchAsync.ts';
import response from '../../utils/response.ts';
import type { CreateMissionInput } from '../../validations/mission.validation.ts';
import ApiError from '../../utils/ApiError.ts';
import { db } from '../../db/index.ts';
import { users } from '../../db/schema/users.ts';
import { eq } from 'drizzle-orm';

export const createMission = catchAsync(async (req: Request, res: Response) => {
  await ensureSuperAdmin(req.user?.id as string);

  const data = req.body as CreateMissionInput;
  const result = await missionService.createMission(data);
  response(res, 201, 'Mission created successfully', result);
});

export const updateMission = catchAsync(async (req: Request, res: Response) => {
  await ensureSuperAdmin(req.user?.id as string);

  const result = await missionService.updateMission(req.params.missionId as string, req.body);
  response(res, 200, 'Mission updated successfully', result);
});

export const deleteMission = catchAsync(async (req: Request, res: Response) => {
  await ensureSuperAdmin(req.user?.id as string);

  await missionService.deleteMission(req.params.missionId as string);
  response(res, 200, 'Mission deleted successfully', null);
});

export const setMissionQuestions = catchAsync(async (req: Request, res: Response) => {
  await ensureSuperAdmin(req.user?.id as string);

  const result = await questionService.replaceQuestions(
    req.params.missionId as string,
    req.body.questions ?? [],
  );
  response(res, 200, 'Pertanyaan misi disimpan', result);
});

export const getMissionQuestions = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user?.id as string;
  const [user] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId)).limit(1);

  // Kunci jawaban hanya untuk panitia. Peserta menerima soal tanpa penanda
  // jawaban benar — pemeriksaan sepenuhnya dilakukan di server.
  const isPanitia = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';

  const missionId = req.params.missionId as string;

  // Misi berpertanyaan yang dipagari koordinat baru membuka soalnya setelah
  // kelompok membuktikan berada di lokasi. Panitia tidak ikut dipagari.
  if (!isPanitia) {
    const groupId = await requireGroup(userId);
    const { unlocked, fenced } = await missionService.isQuizUnlocked(missionId, groupId);
    if (fenced && !unlocked) {
      return response(res, 200, 'Soal masih terkunci', {
        locked: true,
        questions: [],
      });
    }
  }

  const result = await questionService.getQuestions(missionId, isPanitia);
  response(res, 200, 'Pertanyaan misi', { locked: false, questions: result });
});

/**
 * Peserta menekan "Saya sudah di lokasi".
 *
 * Koordinat diambil dari perangkat peserta lalu diperiksa di server — jarak
 * tidak pernah dihitung di sisi klien, supaya tidak bisa dipalsukan dengan
 * mengubah tampilan.
 */
export const verifyLocation = catchAsync(async (req: Request, res: Response, next: NextFunction) => {
  const userId = req.user?.id as string;
  const groupId = await requireGroup(userId);
  const { lat, lng } = req.body ?? {};

  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return next(ApiError.badRequest('Koordinat lokasi tidak terbaca. Izinkan akses lokasi lalu coba lagi.'));
  }

  const result = await missionService.verifyMissionLocation(
    req.params.missionId as string,
    groupId,
    userId,
    { lat, lng },
  );
  response(res, 200, 'Lokasi terverifikasi', result);
});

export const getMissions = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user?.id as string;
  
  // Get user's group
  const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user.length) throw ApiError.notFound('User not found');
  
  // Admin/panitia/super_admin see every mission, unfiltered by group gatekeeper status.
  if (user[0].role !== 'PARTICIPANT') {
    const allMissions = await missionService.getAllMissions();
    return response(res, 200, 'Missions fetched', allMissions);
  }

  if (!user[0].groupId) {
    throw ApiError.badRequest('User must join a group first before viewing missions');
  }

  const result = await missionService.getAvailableMissions(user[0].groupId);
  response(res, 200, 'Missions fetched successfully', result);
});

export const createAssignment = catchAsync(async (req: Request, res: Response) => {
  const missionId = req.params.missionId as string;
  // Klien yang tidak mengirim body sama sekali membuat req.body undefined,
  // dan destructuring-nya melempar sebelum sempat divalidasi.
  const { assigneeUserId } = req.body ?? {};
  const userId = req.user?.id as string;
  
  const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user.length || !user[0].groupId) throw ApiError.badRequest('User must be in a group');

  const result = await missionService.assignMission(missionId, user[0].groupId, assigneeUserId);
  response(res, 201, 'Assignment created', result);
});

export const getMyAssignments = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user?.id as string;
  const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user.length || !user[0].groupId) throw ApiError.badRequest('User must be in a group');

  const assignmentsData = await missionService.getAssignmentsByGroup(user[0].groupId);
  response(res, 200, 'Assignments fetched', assignmentsData);
});

/** Ambil groupId peserta, dipakai semua handler check-in/out. */
const requireGroup = async (userId: string) => {
  const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user.length) throw ApiError.notFound('User not found');
  if (!user[0].groupId) throw ApiError.badRequest('User must join a group first');
  return user[0].groupId;
};

export const checkInMission = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user?.id as string;
  const groupId = await requireGroup(userId);

  const result = await missionService.checkInMission(
    req.params.missionId as string,
    groupId,
    userId,
  );
  response(res, 201, 'Check-in berhasil', result);
});

export const checkOutMission = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user?.id as string;
  const groupId = await requireGroup(userId);

  const result = await missionService.checkOutMission(req.params.missionId as string, groupId, userId);
  response(res, 200, 'Check-out berhasil', result);
});

export const getMyCheckIns = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user?.id as string;
  const groupId = await requireGroup(userId);

  const result = await missionService.getCheckInsByGroup(groupId);
  response(res, 200, 'Check-ins fetched', result);
});
