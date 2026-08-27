import { eq, sql, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../../db/index.ts';
import { groups } from '../../db/schema/groups.ts';
import { users } from '../../db/schema/users.ts';
import { memberConfirmations } from '../../db/schema/member_confirmations.ts';
import { leaderVotes } from '../../db/schema/leader_votes.ts';
import { groupCategories } from '../../db/schema/group_categories.ts';
import ApiError from '../../utils/ApiError.ts';
import { assertCheckedIn } from '../../utils/attendance.ts';
import { broadcastToGroup } from '../../realtime/hub.ts';
import { scoreEntries } from '../../db/schema/score_entries.ts';
import { recalculateGroupScore } from '../../utils/groupScore.ts';
import { calculateFormationPoint, formationSecondsLeft } from '../../utils/formationScore.ts';
import { yelYelDeadline, yelYelSecondsLeft, isYelYelExpired } from '../../utils/yelYel.ts';
import { missions } from '../../db/schema/missions.ts';
import { submissions } from '../../db/schema/submissions.ts';
import { getSettings } from '../settings/settings.service.ts';

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
    // Pesan "tidak ada yang menunggu" saja membingungkan: panitia tidak tahu
    // apakah belum ada yang check-in, atau semuanya memang sudah kebagian
    // kelompok. Sebutkan angkanya supaya jelas mana yang terjadi.
    const [stat] = await db
      .select({
        total: sql<number>`COUNT(*)::int`,
        present: sql<number>`COUNT(*) FILTER (WHERE ${users.checkInAt} IS NOT NULL)::int`,
        grouped: sql<number>`COUNT(*) FILTER (WHERE ${users.groupId} IS NOT NULL)::int`,
      })
      .from(users)
      .where(sql`${users.role} = 'PARTICIPANT'`);

    const belumHadir = Number(stat.total) - Number(stat.present);
    const message = belumHadir > 0
      ? `Belum ada yang bisa dibagi. ${stat.grouped} peserta sudah punya kelompok, dan ${belumHadir} peserta belum dipindai panitia — pindai boarding pass mereka dulu.`
      : `Semua ${stat.present} peserta hadir sudah punya kelompok. Tidak ada yang perlu dibagi.`;

    return { created: 0, assigned: 0, message };
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
        // startedAt menandai awal hitung mundur pembentukan kelompok.
        await tx.insert(groups).values({
          id: newId,
          name: 'Group ' + nanoid(6).toUpperCase(),
          startedAt: new Date(),
        });
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

  // Nama kelompok menutup tahap onboarding — di sinilah hitung mundur berhenti
  // dan poin pembentukan diberikan.
  const now = new Date();
  const settings = await getSettings();
  const alreadyScored = group[0].nameSetAt !== null;
  const point = calculateFormationPoint(group[0].startedAt, now, settings);

  await db.transaction(async (tx: any) => {
    await tx.update(groups)
      .set({
        name: newName,
        nameSetAt: group[0].nameSetAt ?? now,
        formationPoint: alreadyScored ? group[0].formationPoint : point,
        updatedAt: now,
      })
      .where(eq(groups.id, groupId));

    // Poin hanya diberikan sekali; mengganti nama belakangan tidak menambah.
    if (!alreadyScored && point > 0) {
      await tx.insert(scoreEntries).values({
        id: nanoid(16),
        groupId,
        source: 'MANUAL',
        referenceId: `formation:${groupId}`,
        point,
        createdBy: requesterId,
      });
      await recalculateGroupScore(tx, groupId);
    }
  });

  broadcastToGroup(groupId, 'group:updated', { groupId, name: newName, formationPoint: point });
  return { formationPoint: alreadyScored ? group[0].formationPoint : point };
};

/**
 * Foto selfie kelompok — cukup satu unggahan per kelompok.
 *
 * Siapa pun anggota boleh mengunggah, tapi yang pertama masuklah yang tercatat;
 * anggota lain diberi tahu namanya dan tidak bisa menimpanya.
 */
export const setGroupPhotoCompleted = async (groupId: string, userId: string, photoUrl?: string) => {
  const [group] = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1);
  if (!group) throw ApiError.notFound('Group not found');

  if (group.photoCompletedAt) {
    const [by] = group.photoBy
      ? await db.select({ fullname: users.fullname }).from(users).where(eq(users.id, group.photoBy)).limit(1)
      : [];
    throw ApiError.badRequest(
      by ? `Foto kelompok sudah diunggah oleh ${by.fullname}.` : 'Foto kelompok sudah diunggah.',
    );
  }

  await db.update(groups)
    .set({ photoCompletedAt: new Date(), photoUrl, photoBy: userId, updatedAt: new Date() })
    .where(eq(groups.id, groupId));

  const [uploader] = await db.select({ fullname: users.fullname }).from(users).where(eq(users.id, userId)).limit(1);
  broadcastToGroup(groupId, 'group:photo', {
    groupId,
    photoUrl,
    photoBy: userId,
    photoByName: uploader?.fullname ?? null,
  });
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

  // Putaran kedua hanya menyisakan calon yang tadi seri di puncak; memilih di
  // luar mereka akan mengulang kebuntuan yang sama.
  const runoff = group[0].runoffCandidateIds;
  if (runoff?.length && !runoff.includes(nomineeId)) {
    throw ApiError.badRequest('Putaran kedua hanya antara calon yang suaranya seri');
  }

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

    // Puncak perolehan bisa dihuni lebih dari satu calon. Dikumpulkan lebih
    // dulu, baru diputuskan — perbandingan sambil jalan membuat hasilnya
    // bergantung pada urutan baris.
    const maxVotes = Math.max(...Object.values(voteCounts));
    const leaders = Object.keys(voteCounts).filter(c => voteCounts[c] === maxVotes);

    // Menang lebih awal hanya boleh bila kejarannya sudah mustahil. Sebelumnya
    // siapa pun yang lebih dulu menyentuh ambang langsung diangkat, sehingga di
    // kelompok berisi enam orang calon pertama yang mencapai tiga suara menang
    // saat masih ada tiga surat suara di tangan — hasil seri 3–3 yang justru
    // ingin ditangani tidak pernah sempat terbentuk.
    const remainingVotes = Math.max(0, groupMembers.length - allVotes.length);
    const runnerUp = Math.max(
      0,
      ...Object.entries(voteCounts)
        .filter(([c]) => c !== leaders[0])
        .map(([, n]) => n),
    );
    const unassailable = maxVotes > runnerUp + remainingVotes;

    if (leaders.length === 1 && maxVotes >= WINNING_VOTES && unassailable) {
      const winningCandidate = leaders[0];
      await db.update(groups)
        .set({ leaderId: winningCandidate, runoffCandidateIds: null, updatedAt: new Date() })
        .where(eq(groups.id, groupId));
      broadcastToGroup(groupId, 'group:leader-elected', { groupId, leaderId: winningCandidate });
      return { status: 'LEADER_ELECTED', leaderId: winningCandidate };
    }

    if (everyoneVoted) {
      // Suara ronde ini dibuang supaya peserta bisa langsung memilih lagi
      // tanpa menunggu tindakan panitia.
      await db.delete(leaderVotes).where(
        sql`${leaderVotes.groupId} = ${groupId} AND ${leaderVotes.round} = ${currentRound}`,
      );

      // Dua calon atau lebih seri di puncak: putaran berikutnya dipersempit
      // ke mereka saja, alih-alih mengulang dari seluruh anggota. Pilihan
      // yang lebih sedikit jauh lebih mungkin memecah kebuntuan.
      const isRunoff = leaders.length > 1;
      await db.update(groups)
        .set({ runoffCandidateIds: isRunoff ? leaders : null, updatedAt: new Date() })
        .where(eq(groups.id, groupId));

      const nominees = isRunoff
        ? await db.select({ id: users.id, fullname: users.fullname })
            .from(users).where(inArray(users.id, leaders))
        : [];

      broadcastToGroup(groupId, 'group:revote', {
        groupId,
        round: currentRound + 1,
        runoffCandidates: nominees,
      });
      return {
        status: isRunoff ? 'NEEDS_RUNOFF' : 'NEEDS_REVOTE',
        newRound: currentRound + 1,
        runoffCandidates: nominees,
      };
    }
  }

  broadcastToGroup(groupId, 'group:vote', { groupId });
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
    .set({ leaderId: nomineeId, runoffCandidateIds: null, updatedAt: new Date() })
    .where(eq(groups.id, groupId));

  broadcastToGroup(groupId, 'group:leader-elected', { groupId, leaderId: nomineeId });
  return { groupId, leaderId: nomineeId };
};

/**
 * Keadaan yel-yel sebuah kelompok, apa adanya untuk layar peserta.
 *
 * Dikembalikan `null` bila panitia belum menandai satu pun misi sebagai
 * yel-yel — rangkaian checkpoint melompatinya begitu saja.
 */
export const getYelYelState = async (
  group: { id: string; nameSetAt: Date | null; yelYelSkippedAt: Date | null },
  settings: Awaited<ReturnType<typeof getSettings>>,
) => {
  const [mission] = await db.select({ id: missions.id, title: missions.title, description: missions.description })
    .from(missions).where(eq(missions.isYelYel, true)).limit(1);
  if (!mission) return null;

  const [submission] = await db.select({ id: submissions.id, status: submissions.status })
    .from(submissions)
    .where(sql`${submissions.groupId} = ${group.id} AND ${submissions.missionId} = ${mission.id}`)
    .limit(1);

  const expired = isYelYelExpired(group.nameSetAt, settings.yelYelDeadlineHours);

  return {
    missionId: mission.id,
    title: mission.title,
    description: mission.description,
    deadlineAt: yelYelDeadline(group.nameSetAt, settings.yelYelDeadlineHours),
    secondsLeft: yelYelSecondsLeft(group.nameSetAt, settings.yelYelDeadlineHours),
    deadlineHours: settings.yelYelDeadlineHours,
    expired,
    skipped: group.yelYelSkippedAt !== null,
    submissionStatus: submission?.status ?? null,
    // Layar peserta memakai ini untuk memutuskan apakah checkpoint yel-yel
    // masih perlu ditampilkan.
    done: submission != null || group.yelYelSkippedAt !== null || expired,
  };
};

/**
 * Kelompok memilih mengerjakan yel-yel belakangan.
 *
 * Keputusan ini milik ketua, sama seperti penamaan kelompok, dan hanya bisa
 * diambil sekali. Bukti tetap boleh dikirim sampai tenggat.
 */
export const skipYelYel = async (groupId: string, requesterId: string) => {
  const [group] = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1);
  if (!group) throw ApiError.notFound('Group not found');
  if (group.leaderId !== requesterId) {
    throw ApiError.forbidden('Hanya ketua kelompok yang bisa melewati yel-yel');
  }
  if (group.yelYelSkippedAt) return { skippedAt: group.yelYelSkippedAt };

  const now = new Date();
  await db.update(groups).set({ yelYelSkippedAt: now, updatedAt: now }).where(eq(groups.id, groupId));
  broadcastToGroup(groupId, 'group:updated', { groupId, yelYelSkippedAt: now });

  return { skippedAt: now };
};

export const getGroupDetails = async (groupId: string) => {
  const group = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1);
  if (!group.length) throw ApiError.notFound('Group not found');

  // Nomor telepon ikut: anggota satu kelompok saling mencari di lapangan, dan
  // nomor inilah satu-satunya cara menghubungi yang belum sampai. Data ini
  // hanya keluar ke sesama anggota kelompok — endpoint ini memang dijaga
  // begitu — bukan ke seluruh peserta acara.
  const members = await db.select({
    id: users.id,
    fullname: users.fullname,
    phoneNumber: users.phoneNumber,
    role: users.role,
  }).from(users).where(eq(users.groupId, groupId)).orderBy(users.fullname);

  const settings = await getSettings();

  // Kategori ikut dikirim beserta warnanya supaya penandaan di layar peserta
  // dan panitia memakai warna yang sama.
  const [category] = group[0].categoryId
    ? await db.select().from(groupCategories).where(eq(groupCategories.id, group[0].categoryId)).limit(1)
    : [];

  const [photoByUser] = group[0].photoBy
    ? await db.select({ fullname: users.fullname }).from(users).where(eq(users.id, group[0].photoBy)).limit(1)
    : [];

  return {
    ...group[0],
    members,
    category: category ?? null,
    photoByName: photoByUser?.fullname ?? null,
    // Hitung mundur pembentukan kelompok; berhenti begitu nama tersimpan.
    formationSecondsLeft: group[0].nameSetAt
      ? 0
      : formationSecondsLeft(group[0].startedAt, settings.formationLimitMinutes),
    formationRule: {
      limitMinutes: settings.formationLimitMinutes,
      graceMinutes: settings.formationGraceMinutes,
      fullPoint: settings.formationFullPoint,
      latePoint: settings.formationLatePoint,
    },
    yelYel: await getYelYelState(group[0], settings),
    // Bila putaran kedua sedang berjalan, layar pemilihan hanya menampilkan
    // calon-calon ini.
    runoffCandidateIds: group[0].runoffCandidateIds ?? null,
  };
};
