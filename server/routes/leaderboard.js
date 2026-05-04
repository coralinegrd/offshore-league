import { Router } from "express";
import { getDb } from "../db/database.js";

const router = Router();

function displayName(fullName) {
  const parts = fullName.trim().split(/\s+/);
  const first = parts[0] || "Angler";
  const initial = parts[1]?.[0] ? `${parts[1][0].toUpperCase()}.` : "";
  return [first, initial].filter(Boolean).join(" ");
}

function toDateRangeLabel(startedAt, endedAt) {
  const start = new Date(startedAt || "");
  const end = new Date(endedAt || "");
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return "";

  const monthFormat = new Intl.DateTimeFormat("en-US", { month: "short" });
  const startMonth = monthFormat.format(start);
  const endMonth = monthFormat.format(end);
  const startDay = start.getUTCDate();
  const endDay = end.getUTCDate();
  const year = start.getUTCFullYear();

  if (startMonth === endMonth) {
    return `${startMonth} ${startDay}\u2013${endDay} ${year}`;
  }

  return `${startMonth} ${startDay}\u2013${endMonth} ${endDay} ${year}`;
}

router.get("/leaderboard", async (req, res, next) => {
  try {
    const db = await getDb();
    const requestedChallengeId = Number(req.query.challengeId);
    const activeChallenge = await db.get("SELECT id FROM challenges WHERE archived_at IS NULL ORDER BY id DESC LIMIT 1");
    const challengeId = Number.isFinite(requestedChallengeId) && requestedChallengeId > 0
      ? requestedChallengeId
      : (activeChallenge?.id || null);

    if (!challengeId) {
      return res.json({ challengeId: null, entries: [] });
    }

    const rows = await db.all(`
      SELECT submissions.id, participants.name, submissions.species, submissions.media_path, submissions.verified_length, submissions.status
      FROM submissions
      JOIN participants ON participants.id = submissions.participant_id
      WHERE submissions.status = 'approved'
        AND submissions.verified_length IS NOT NULL
        AND participants.challenge_id = ?
      ORDER BY submissions.verified_length DESC, submissions.created_at ASC
    `, challengeId);

    res.json({
      challengeId,
      entries: rows.map((row) => ({
        id: row.id,
        display_name: displayName(row.name),
        species: row.species,
        media_path: null,
        length: row.verified_length,
        status: row.status
      }))
    });
  } catch (err) {
    next(err);
  }
});

router.get("/leaderboard/history", async (req, res, next) => {
  try {
    const db = await getDb();
    const challenges = await db.all(
      `SELECT
        id,
        title,
        location,
        species,
        entry_fee,
        status,
        started_at,
        ended_at,
        archived_at,
        (
          SELECT COUNT(*)
          FROM participants p
          WHERE p.challenge_id = challenges.id
        ) AS participant_count,
        (
          SELECT p.name
          FROM submissions s
          JOIN participants p ON p.id = s.participant_id
          WHERE p.challenge_id = challenges.id
            AND s.status = 'approved'
            AND s.verified_length IS NOT NULL
          ORDER BY s.verified_length DESC, datetime(s.created_at) ASC
          LIMIT 1
        ) AS winner_name
      FROM challenges
      ORDER BY datetime(started_at) DESC, id DESC`
    );

    res.json({
      challenges: challenges.map((challenge) => {
        const participants = Number(challenge.participant_count || 0);
        const entryFee = Number(challenge.entry_fee || 0);
        return {
          ...challenge,
          participant_count: participants,
          prize_pool: Number((participants * entryFee).toFixed(2)),
          winner_name: challenge.winner_name || "\u2014",
          date_range: toDateRangeLabel(challenge.started_at, challenge.ended_at || challenge.started_at)
        };
      })
    });
  } catch (err) {
    next(err);
  }
});

export default router;
