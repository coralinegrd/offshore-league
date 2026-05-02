import { Router } from "express";
import { getDb } from "../db/database.js";

const router = Router();

function toChallengePayload(challenge, participants = 0) {
  const closesAtMs = challenge?.closes_at ? new Date(challenge.closes_at).getTime() : null;
  const now = Date.now();
  const msRemaining = Number.isFinite(closesAtMs) && closesAtMs > now ? closesAtMs - now : 0;
  const hours = Math.floor(msRemaining / (60 * 60 * 1000));
  const minutes = Math.floor((msRemaining % (60 * 60 * 1000)) / (60 * 1000));
  const entryFee = Number(challenge?.entry_fee || 30);

  return {
    id: challenge?.id || null,
    title: challenge?.title || "Tampa Mahi-Mahi Challenge",
    location: challenge?.location || "Tampa",
    species: challenge?.species || "Mahi-Mahi",
    entryFee,
    status: challenge?.status || "active",
    closesAt: challenge?.closes_at || null,
    cancellationReason: challenge?.cancellation_reason || "",
    cancelledAt: challenge?.cancelled_at || null,
    participants,
    prizePool: participants * entryFee,
    countdown: `${hours}h ${String(minutes).padStart(2, "0")}m`
  };
}

async function getChallengeWithStats(db, challengeId) {
  const challenge = await db.get(
    `SELECT
      c.id,
      c.title,
      c.location,
      c.species,
      c.entry_fee,
      c.status,
      c.closes_at,
      c.cancellation_reason,
      c.updated_at,
      c.cancelled_at,
      (
        SELECT COUNT(*)
        FROM participants p
        LEFT JOIN users u ON u.id = p.user_id
        WHERE p.challenge_id = c.id
          AND COALESCE(u.is_demo, 0) = 0
      ) AS participants
    FROM challenges c
    WHERE c.id = ?
    LIMIT 1`,
    challengeId
  );

  if (!challenge) return null;
  return toChallengePayload(challenge, Number(challenge.participants || 0));
}

router.get("/challenges", async (req, res, next) => {
  try {
    const db = await getDb();
    const statuses = String(req.query.status || "").trim();
    const statusFilters = statuses
      ? statuses
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean)
      : [];

    const whereParts = ["c.archived_at IS NULL"];
    const params = [];
    if (statusFilters.length > 0) {
      whereParts.push(`c.status IN (${statusFilters.map(() => "?").join(",")})`);
      params.push(...statusFilters);
    }

    const rows = await db.all(
      `SELECT
        c.id,
        c.title,
        c.location,
        c.species,
        c.entry_fee,
        c.status,
        c.closes_at,
        c.cancellation_reason,
        c.cancelled_at,
        (
          SELECT COUNT(*)
          FROM participants p
          LEFT JOIN users u ON u.id = p.user_id
          WHERE p.challenge_id = c.id
            AND COALESCE(u.is_demo, 0) = 0
        ) AS participants
      FROM challenges c
      WHERE ${whereParts.join(" AND ")}
      ORDER BY
        CASE c.status
          WHEN 'active' THEN 0
          WHEN 'paused' THEN 1
          WHEN 'draft' THEN 2
          WHEN 'closed' THEN 3
          WHEN 'cancelled' THEN 4
          ELSE 5
        END,
        datetime(c.closes_at) ASC,
        c.id DESC`,
      ...params
    );

    return res.json({
      challenges: rows.map((row) => toChallengePayload(row, Number(row.participants || 0)))
    });
  } catch (err) {
    return next(err);
  }
});

router.get("/challenge", async (req, res, next) => {
  try {
    const db = await getDb();
    const requestedChallengeId = Number(req.query.challengeId);
    if (Number.isFinite(requestedChallengeId) && requestedChallengeId > 0) {
      const challenge = await getChallengeWithStats(db, requestedChallengeId);
      if (!challenge) {
        return res.status(404).json({ error: "Challenge not found." });
      }
      return res.json(challenge);
    }

    const selectedChallenge = await db.get(
      `SELECT id
       FROM challenges
       WHERE archived_at IS NULL
       ORDER BY
         CASE status
           WHEN 'active' THEN 0
           WHEN 'paused' THEN 1
           WHEN 'draft' THEN 2
           WHEN 'closed' THEN 3
           WHEN 'cancelled' THEN 4
           ELSE 5
         END,
         datetime(closes_at) ASC,
         id DESC
       LIMIT 1`
    );

    if (!selectedChallenge?.id) {
      return res.status(404).json({ error: "No challenge found." });
    }

    const challenge = await getChallengeWithStats(db, selectedChallenge.id);
    if (!challenge) {
      return res.status(404).json({ error: "No challenge found." });
    }

    return res.json(challenge);
  } catch (err) {
    return next(err);
  }
});

router.get("/challenge/:challengeId", async (req, res, next) => {
  try {
    const db = await getDb();
    const challengeId = Number(req.params.challengeId);
    if (!Number.isFinite(challengeId) || challengeId <= 0) {
      return res.status(400).json({ error: "Challenge ID is invalid." });
    }

    const challenge = await getChallengeWithStats(db, challengeId);
    if (!challenge) {
      return res.status(404).json({ error: "Challenge not found." });
    }

    return res.json(challenge);
  } catch (err) {
    return next(err);
  }
});

export default router;
