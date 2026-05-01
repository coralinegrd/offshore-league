import { Router } from "express";
import { getDb } from "../db/database.js";

const router = Router();

function displayName(fullName) {
  const parts = fullName.trim().split(/\s+/);
  const first = parts[0] || "Angler";
  const initial = parts[1]?.[0] ? `${parts[1][0].toUpperCase()}.` : "";
  return [first, initial].filter(Boolean).join(" ");
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
        status,
        started_at,
        ended_at,
        archived_at
      FROM challenges
      ORDER BY COALESCE(archived_at, updated_at) DESC, id DESC`
    );

    res.json({ challenges });
  } catch (err) {
    next(err);
  }
});

export default router;
