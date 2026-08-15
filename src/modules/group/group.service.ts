import { eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../../db/index.ts';
import { groups } from '../../db/schema/groups.ts';
import { users } from '../../db/schema/users.ts';
import { memberConfirmations } from '../../db/schema/member_confirmations.ts';
import { leaderVotes } from '../../db/schema/leader_votes.ts';
import ApiError from '../../utils/ApiError.ts';
import { assertCheckedIn } from '../../utils/attendance.ts';

export const autoGroupUser = async (userId: string) => {
  await assertCheckedIn(userId);

  const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user.length) throw ApiError.notFound('User not found');
  if (user[0].groupId) throw ApiError.badRequest('User already in a group');

  // Find an existing group with less than 6 members that hasn't already
  // elected a leader (once a leader is set, the group is past the point
  // where new members can still confirm/vote alongside everyone else).
  const availableGroups = await db.execute(sql`
    SELECT g.id, COUNT(u.id) as member_count
    FROM groups g
    LEFT JOIN users u ON u.group_id = g.id
    WHERE g.leader_id IS NULL
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

/**
 * SRS 5.3 — "Sistem mengacak peserta hadir ke kelompok (maks 6). Algoritma acak
 * dijalankan panitia dari dashboard (tombol Generate Kelompok)."
 *
 * Berbeda dari autoGroupUser yang dipicu peserta satu per satu, ini membentuk
 * seluruh kelompok sekaligus dari kumpulan peserta yang sudah hadir. Pengacakan
 * dilakukan agar rekan sekantor yang mendaftar berurutan tidak otomatis
 * sekelompok — justru bercampur, sesuai tujuan acara.
 */
export const generateGroups = async (maxPerGroup = 6) => {
  const waiting = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`${users.role} = 'PARTICIPANT' AND ${users.groupId} IS NULL AND ${users.checkInAt} IS NOT NULL`);

  if (!waiting.length) {
    return { created: 0, assigned: 0, message: 'Tidak ada peserta hadir yang menunggu kelompok' };
  }

  // Fisher–Yates: acak merata, tidak bergantung urutan pendaftaran.
  const pool = waiting.map(u => u.id);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  let assigned = 0;
  let created = 0;

  await db.transaction(async (tx: any) => {
    // Isi dulu kelompok yang masih longgar dan belum berketua, baru buat baru —
    // supaya tidak meninggalkan banyak kelompok setengah penuh.
    const openGroups = await tx.execute(sql`
      SELECT g.id, COUNT(u.id) AS member_count
      FROM groups g
      LEFT JOIN users u ON u.group_id = g.id
      WHERE g.leader_id IS NULL
      GROUP BY g.id
      HAVING COUNT(u.id) < ${maxPerGroup}
      ORDER BY COUNT(u.id) DESC
    `);

    const slots: Array<{ id: string; free: number }> = openGroups.rows.map((r: any) => ({
      id: r.id as string,
      free: maxPerGroup - Number(r.member_count),
    }));

    for (const userId of pool) {
      let target = slots.find(s => s.free > 0);

      if (!target) {
        const newId = nanoid(16);
        await tx.insert(groups).values({ id: newId, name: 'Group ' + nanoid(6).toUpperCase() });
        target = { id: newId, free: maxPerGroup };
        slots.push(target);
        created += 1;
      }

      await tx.update(users).set({ groupId: target.id, updatedAt: new Date() }).where(eq(users.id, userId));
      target.free -= 1;
      assigned += 1;
    }
  });

  return {
    created,
    assigned,
    message: `${assigned} peserta hadir dibagi ke dalam kelompok (${created} kelompok baru dibuat)`,
  };
};

export const updateGroupName = async (groupId: string, newName: string, requesterId: string) => {
  const group = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1);
  if (!group.length) throw ApiError.notFound('Group not found');
  if (group[0].leaderId !== requesterId) {
    throw ApiError.forbidden('Only the group leader can name the group');
  }

  // Case-insensitive per SRS ("cek keunikan nama secara real-time, case-insensitive")
  const existing = await db.select().from(groups).where(
    sql`LOWER(${groups.name}) = LOWER(${newName})`
  ).limit(1);
  if (existing.length > 0 && existing[0].id !== groupId) {
    throw ApiError.badRequest('Group name already exists');
  }

  await db.update(groups)
    .set({ name: newName, nameSetAt: new Date(), updatedAt: new Date() })
    .where(eq(groups.id, groupId));
};

export const setGroupPhotoCompleted = async (groupId: string, photoUrl?: string) => {
  const group = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1);
  if (!group.length) throw ApiError.notFound('Group not found');

  await db.update(groups)
    .set({ photoCompletedAt: new Date(), photoUrl, updatedAt: new Date() })
    .where(eq(groups.id, groupId));
};

export const confirmMember = async (groupId: string, confirmerId: string, confirmedId: string) => {
  if (confirmerId === confirmedId) {
    throw ApiError.badRequest('Cannot confirm yourself');
  }

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
  if (voterId === nomineeId) {
    throw ApiError.badRequest('Cannot vote for yourself');
  }

  const group = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1);
  if (!group.length) throw ApiError.notFound('Group not found');
  if (group[0].leaderId) throw ApiError.badRequest('Group already has a leader');

  // Verify membership
  const user = await db.select().from(users).where(eq(users.id, voterId)).limit(1);
  const nominee = await db.select().from(users).where(eq(users.id, nomineeId)).limit(1);
  if (!user.length || user[0].groupId !== groupId) throw ApiError.badRequest('Voter must be in this group');
  if (!nominee.length || nominee[0].groupId !== groupId) throw ApiError.badRequest('Nominee must be in this group');

  const groupMembers = await db.select().from(users).where(eq(users.groupId, groupId));

  // Get current round. A round only counts as "current/open" if it hasn't
  // been fully voted yet — otherwise (e.g. after a tie) everyone would
  // immediately fail the "already voted" check below and the group would
  // be stuck forever on the tied round.
  const maxRoundRes = await db.execute(sql`SELECT MAX(round) as max_round FROM leader_votes WHERE group_id = ${groupId}`);
  const maxRound = maxRoundRes.rows[0].max_round ? Number(maxRoundRes.rows[0].max_round) : 0;

  let currentRound = maxRound || 1;
  if (maxRound > 0) {
    const votesInMaxRound = await db.select().from(leaderVotes).where(
      sql`${leaderVotes.groupId} = ${groupId} AND ${leaderVotes.round} = ${maxRound}`
    );
    currentRound = votesInMaxRound.length >= groupMembers.length ? maxRound + 1 : maxRound;
  }

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

  // SRS 5.3: "menang dengan >= 3 suara; seri atau tidak memenuhi syarat →
  // sistem reset dan buka voting ulang otomatis". Kelompok yang lebih kecil
  // dari 3 orang tidak akan pernah mencapai 3 suara, jadi ambangnya dibatasi
  // jumlah anggota agar tidak mengunci mereka selamanya.
  const WINNING_VOTES = Math.min(3, groupMembers.length);
  const everyoneVoted = allVotes.length >= groupMembers.length;

  if (groupMembers.length > 0) {
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

    // Menang begitu ambang tercapai dan tidak seri — tidak perlu menunggu
    // anggota yang belum memilih.
    if (!tie && maxVotes >= WINNING_VOTES) {
      await db.update(groups).set({ leaderId: winningCandidate, updatedAt: new Date() }).where(eq(groups.id, groupId));
      return { status: 'LEADER_ELECTED', leaderId: winningCandidate };
    }

    if (everyoneVoted) {
      // Semua sudah memilih tapi hasilnya seri atau tidak ada yang mencapai
      // ambang. SRS meminta sistem me-reset dan membuka voting ulang sendiri,
      // bukan sekadar memberi tahu klien — suara ronde ini dibuang supaya
      // peserta bisa langsung memilih lagi tanpa menunggu tindakan panitia.
      await db.delete(leaderVotes).where(
        sql`${leaderVotes.groupId} = ${groupId} AND ${leaderVotes.round} = ${currentRound}`,
      );
      return { status: 'NEEDS_REVOTE', newRound: currentRound + 1 };
    }
  }

  return { status: 'VOTE_RECORDED' };
};

/** Cek keunikan nama kelompok secara langsung, untuk umpan balik saat mengetik. */
export const isGroupNameAvailable = async (name: string, groupId: string) => {
  const trimmed = name.trim();
  if (!trimmed) return { available: false, reason: 'Nama kelompok tidak boleh kosong' };
  if (trimmed.length < 3) return { available: false, reason: 'Nama minimal 3 karakter' };

  const [taken] = await db.select({ id: groups.id }).from(groups)
    .where(sql`LOWER(${groups.name}) = LOWER(${trimmed})`).limit(1);

  if (taken && taken.id !== groupId) {
    return { available: false, reason: 'Nama ini sudah dipakai kelompok lain' };
  }
  return { available: true, reason: null };
};

/**
 * Jaring pengaman lapangan: panitia menunjuk ketua secara manual ketika
 * pemilihan tidak kunjung selesai (anggota tidak hadir, HP mati, dsb).
 */
export const setLeaderManually = async (groupId: string, nomineeId: string) => {
  const group = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1);
  if (!group.length) throw ApiError.notFound('Group not found');

  const nominee = await db.select().from(users).where(eq(users.id, nomineeId)).limit(1);
  if (!nominee.length || nominee[0].groupId !== groupId) {
    throw ApiError.badRequest('Nominee must be in this group');
  }

  await db.update(groups)
    .set({ leaderId: nomineeId, updatedAt: new Date() })
    .where(eq(groups.id, groupId));

  return { groupId, leaderId: nomineeId };
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
