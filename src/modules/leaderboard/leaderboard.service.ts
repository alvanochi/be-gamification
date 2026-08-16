import { sql } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { getSettings } from '../settings/settings.service.ts';

export const getLeaderboard = async (limit?: number) => {
  const top = limit ?? (await getSettings()).leaderboardTopN;
  const result = await db.execute(sql`
    SELECT g.id, g.name, COALESCE(SUM(s.point), 0)::int as score
    FROM groups g
    LEFT JOIN score_entries s ON s.group_id = g.id
    GROUP BY g.id
    ORDER BY score DESC
    LIMIT ${top}
  `);
  return result.rows;
};

// Template for Phase 2: WebSocket Broadcaster
export const broadcastLeaderboardUpdate = (io: any, leaderboardData: any) => {
  if (io) {
    io.emit('leaderboard_update', leaderboardData);
  }
};
