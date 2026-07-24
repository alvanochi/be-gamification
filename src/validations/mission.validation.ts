import { z } from 'zod';

export const createMissionSchema = z.object({
  body: z.object({
    title: z.string().min(3).max(255),
    description: z.string(),
    // Must match the real `mission_type` DB enum (missions.ts) — the
    // previous MEDIA/MULTIPLE_CHOICE/SHORT_ANSWER values here didn't match
    // it at all, so no request could ever pass validation *and* the DB
    // constraint at the same time.
    type: z.enum(['TANTANGAN', 'BIGGER_BETTER', 'SOAL_LOKASI']),
    isMandatory: z.boolean().default(false),
    pointWeight: z.number().int().min(0),
    sponsorId: z.string().optional(),
    // Scheduling & dependency — read by mission.service.ts's assignMission,
    // but previously had no way to be set at creation time.
    openAt: z.string().datetime().optional(),
    prerequisiteId: z.string().optional(),
    participantCount: z.number().int().min(1).default(1),
    // Geofencing — only meaningful for SOAL_LOKASI, but harmless to accept
    // as optional for the other types.
    geoLat: z.string().optional(),
    geoLng: z.string().optional(),
    geoRadius: z.number().int().min(1).optional(),
    // Free-form per-mission point rules (e.g. the Pickle-game "count from
    // hit #21" threshold example in the SRS) — kept as a config blob rather
    // than hard-coded, per the SRS's own principle.
    pointRules: z.record(z.string(), z.unknown()).optional(),
  }),
});

export type CreateMissionInput = z.infer<typeof createMissionSchema>['body'];
