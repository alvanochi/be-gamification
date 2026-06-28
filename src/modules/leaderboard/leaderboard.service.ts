import { desc } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { groups } from '../../db/schema/groups.ts';

export const getLeaderboard = async () => {
  return await db.select({
    id: groups.id,
    name: groups.name,
    score: groups.score,
  })
  .from(groups)
  .orderBy(desc(groups.score))
  .limit(50);
};

// Template for Phase 2: WebSocket Broadcaster
export const broadcastLeaderboardUpdate = (io: any, leaderboardData: any) => {
  if (io) {
    io.emit('leaderboard_update', leaderboardData);
  }
};
