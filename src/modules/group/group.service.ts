import { eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../../db/index.ts';
import { groups } from '../../db/schema/groups.ts';
import { users } from '../../db/schema/users.ts';
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

export const setLeader = async (groupId: string, leaderId: string) => {
  const group = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1);
  if (!group.length) throw ApiError.notFound('Group not found');
  if (group[0].leaderId) throw ApiError.badRequest('Group already has a leader');

  // Ensure leader is part of the group
  const user = await db.select().from(users).where(eq(users.id, leaderId)).limit(1);
  if (!user.length || user[0].groupId !== groupId) {
    throw ApiError.badRequest('Leader must be a member of this group');
  }

  await db.update(groups).set({ leaderId, updatedAt: new Date() }).where(eq(groups.id, groupId));
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
