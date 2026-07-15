import { eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../../db/index.ts';
import { groups } from '../../db/schema/groups.ts';
import { users } from '../../db/schema/users.ts';
import { memberConfirmations } from '../../db/schema/member_confirmations.ts';
import { leaderVotes } from '../../db/schema/leader_votes.ts';
import ApiError from '../../utils/ApiError.ts';

export const autoGroupUser = async (userId: string) => {
  const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user.length) throw ApiError.notFound('User not found');
  if (user[0].groupId) throw ApiError.badRequest('User already in a group');

  // Find an existing group with less than 6 members
  const availableGroups = await db.execute(sql`
    SELECT g.id, COUNT(u.id) as member_count
    FROM groups g
    LEFT JOIN users u ON u.group_id = g.id
    GROUP BY g.id
    HAVING COUNT(u.id) < 6
    LIMIT 1
  `);

  let targetGroupId = null;

  if (availableGroups.rows.length > 0) {
    targetGroupId = availableGroups.rows[0].id;
  } else {
    // Create new group
    targetGroupId = nanoid(16);
    const newGroupName = 'Group ' + nanoid(6).toUpperCase();
    await db.insert(groups).values({
      id: targetGroupId as string,
      name: newGroupName,
    });
  }

  // Update user's group
  await db.update(users)
    .set({ groupId: targetGroupId as string, updatedAt: new Date() })
    .where(eq(users.id, userId));

  return { groupId: targetGroupId };
};

export const updateGroupName = async (groupId: string, newName: string) => {
  const existing = await db.select().from(groups).where(eq(groups.name, newName)).limit(1);
  if (existing.length > 0 && existing[0].id !== groupId) {
    throw ApiError.badRequest('Group name already exists');
  }

  await db.update(groups).set({ name: newName, updatedAt: new Date() }).where(eq(groups.id, groupId));
};

export const confirmMember = async (groupId: string, confirmerId: string, confirmedId: string) => {
  // Check if they are in the same group
  const user1 = await db.select().from(users).where(eq(users.id, confirmerId)).limit(1);
  const user2 = await db.select().from(users).where(eq(users.id, confirmedId)).limit(1);

  if (!user1.length || !user2.length || user1[0].groupId !== groupId || user2[0].groupId !== groupId) {
    throw ApiError.badRequest('Both users must be in the specified group');
  }

  // Insert or ignore
  const existing = await db.select().from(memberConfirmations).where(
    sql`${memberConfirmations.confirmerId} = ${confirmerId} AND ${memberConfirmations.confirmedId} = ${confirmedId}`
  ).limit(1);

  if (!existing.length) {
    await db.insert(memberConfirmations).values({
      id: nanoid(16),
      groupId,
      confirmerId,
      confirmedId,
    });
  }
};

export const getConfirmations = async (groupId: string) => {
  return await db.select().from(memberConfirmations).where(eq(memberConfirmations.groupId, groupId));
};

export const recordVote = async (groupId: string, voterId: string, nomineeId: string) => {
  const group = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1);
  if (!group.length) throw ApiError.notFound('Group not found');
  if (group[0].leaderId) throw ApiError.badRequest('Group already has a leader');

  // Verify membership
  const user = await db.select().from(users).where(eq(users.id, voterId)).limit(1);
  const nominee = await db.select().from(users).where(eq(users.id, nomineeId)).limit(1);
  if (!user.length || user[0].groupId !== groupId) throw ApiError.badRequest('Voter must be in this group');
  if (!nominee.length || nominee[0].groupId !== groupId) throw ApiError.badRequest('Nominee must be in this group');

  // Get current round
  const maxRoundRes = await db.execute(sql`SELECT MAX(round) as max_round FROM leader_votes WHERE group_id = ${groupId}`);
  let currentRound = maxRoundRes.rows[0].max_round ? Number(maxRoundRes.rows[0].max_round) : 1;

  // Check if voter already voted in current round
  const existingVote = await db.select().from(leaderVotes).where(
    sql`${leaderVotes.voterId} = ${voterId} AND ${leaderVotes.groupId} = ${groupId} AND ${leaderVotes.round} = ${currentRound}`
  ).limit(1);
  if (existingVote.length) throw ApiError.badRequest('You have already voted in this round');

  await db.insert(leaderVotes).values({
    id: nanoid(16),
    groupId,
    round: currentRound,
    voterId,
    candidateId: nomineeId,
  });

  // Check total votes in this round
  const allVotes = await db.select().from(leaderVotes).where(
    sql`${leaderVotes.groupId} = ${groupId} AND ${leaderVotes.round} = ${currentRound}`
  );

  const groupMembers = await db.select().from(users).where(eq(users.groupId, groupId));
  
  if (allVotes.length >= groupMembers.length && groupMembers.length > 0) {
    // Tally votes
    const voteCounts: Record<string, number> = {};
    for (const v of allVotes) {
      voteCounts[v.candidateId] = (voteCounts[v.candidateId] || 0) + 1;
    }
    
    let maxVotes = 0;
    let winningCandidate = null;
    let tie = false;

    for (const [candidate, count] of Object.entries(voteCounts)) {
      if (count > maxVotes) {
        maxVotes = count;
        winningCandidate = candidate;
        tie = false;
      } else if (count === maxVotes) {
        tie = true;
      }
    }

    if (!tie && maxVotes > 0) {
      await db.update(groups).set({ leaderId: winningCandidate, updatedAt: new Date() }).where(eq(groups.id, groupId));
      return { status: 'LEADER_ELECTED', leaderId: winningCandidate };
    } else {
      // It's a tie, increment round (by returning needs_revote to client)
      return { status: 'NEEDS_REVOTE', newRound: currentRound + 1 };
    }
  }

  return { status: 'VOTE_RECORDED' };
};

export const getGroupDetails = async (groupId: string) => {
  const group = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1);
  if (!group.length) throw ApiError.notFound('Group not found');

  const members = await db.select({
    id: users.id,
    fullname: users.fullname,
    role: users.role,
  }).from(users).where(eq(users.groupId, groupId));

  return {
    ...group[0],
    members,
  };
};
