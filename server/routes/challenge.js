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

function parsePositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function normalizeRegionFilter(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized || null;
}

function includesRegion(text, regionFilter) {
  if (!regionFilter) return true;
  return String(text || "").toLowerCase().includes(regionFilter);
}

function formatLengthCm(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return `${numeric.toFixed(1)} cm`;
}

function toIso(ms) {
  return new Date(ms).toISOString();
}

function clampToLast48Hours(ms) {
  const now = Date.now();
  const minMs = now - 48 * 60 * 60 * 1000;
  return Math.max(minMs, Math.min(now, ms));
}

function demoOffsetMinutes(seed, minMinutes, maxMinutes) {
  const span = Math.max(1, maxMinutes - minMinutes + 1);
  return minMinutes + ((seed * 9301 + 49297) % 233280) % span;
}

function toFeedEvent({
  id,
  eventType,
  actorName,
  region,
  challengeTitle,
  species,
  length,
  rank,
  occurredAt,
  source
}) {
  const eventRegion = String(region || "Offshore").trim() || "Offshore";
  const title = String(challengeTitle || "the challenge").trim() || "the challenge";
  const displaySpecies = String(species || "catch").trim() || "catch";
  const displayName = String(actorName || "Angler").trim() || "Angler";
  const lengthLabel = formatLengthCm(length);

  let message = `${displayName} in ${eventRegion}`;
  if (eventType === "join_challenge") {
    message = `${displayName} joined ${title} in ${eventRegion}`;
  } else if (eventType === "submit_catch") {
    message = `${displayName} submitted a ${displaySpecies}${lengthLabel ? ` (${lengthLabel})` : ""} in ${eventRegion}`;
  } else if (eventType === "climb_leaderboard") {
    message = `${displayName} climbed to #${rank || "-"} on ${title} in ${eventRegion}`;
  }

  return {
    id,
    eventType,
    source,
    actorName: displayName,
    region: eventRegion,
    occurredAt,
    message
  };
}

function buildDemoEvents({ users, challenge, limit }) {
  const now = Date.now();
  const targetSpecies = String(challenge?.species || "Mahi-Mahi").trim() || "Mahi-Mahi";
  const challengeTitle = String(challenge?.title || "Weekend Challenge").trim() || "Weekend Challenge";
  const fallbackRegion = String(challenge?.location || "Offshore").trim() || "Offshore";
  const feed = [];

  for (const [index, user] of users.entries()) {
    if (feed.length >= limit) break;
    const seed = Number(user.id || index + 1);
    const personaRegion = String(user.region || fallbackRegion).trim() || fallbackRegion;
    const speciesList = (() => {
      try {
        const parsed = JSON.parse(String(user.species_preferences || "[]"));
        return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
      } catch {
        return [];
      }
    })();
    const personaSpecies = String(speciesList[0] || targetSpecies).trim() || targetSpecies;

    const submitMinutesAgo = demoOffsetMinutes(seed + 11, 45, 47 * 60);
    const joinMinutesAgo = Math.min(47 * 60, submitMinutesAgo + demoOffsetMinutes(seed + 17, 25, 220));
    const climbMinutesAgo = Math.max(10, submitMinutesAgo - demoOffsetMinutes(seed + 23, 8, 140));

    const submitAt = toIso(clampToLast48Hours(now - submitMinutesAgo * 60 * 1000));
    const joinAt = toIso(clampToLast48Hours(now - joinMinutesAgo * 60 * 1000));
    const climbAt = toIso(clampToLast48Hours(now - climbMinutesAgo * 60 * 1000));
    const syntheticLength = 76 + ((seed * 7) % 18) + (index % 3) * 0.4;
    const syntheticRank = 1 + ((seed + index) % 8);

    feed.push(
      toFeedEvent({
        id: `demo-join-${user.id}`,
        eventType: "join_challenge",
        actorName: user.name,
        region: personaRegion,
        challengeTitle,
        species: personaSpecies,
        occurredAt: joinAt,
        source: "demo"
      })
    );

    if (feed.length >= limit) break;
    feed.push(
      toFeedEvent({
        id: `demo-submit-${user.id}`,
        eventType: "submit_catch",
        actorName: user.name,
        region: personaRegion,
        challengeTitle,
        species: personaSpecies,
        length: syntheticLength,
        occurredAt: submitAt,
        source: "demo"
      })
    );

    if (feed.length >= limit) break;
    feed.push(
      toFeedEvent({
        id: `demo-climb-${user.id}`,
        eventType: "climb_leaderboard",
        actorName: user.name,
        region: personaRegion,
        challengeTitle,
        species: personaSpecies,
        rank: syntheticRank,
        occurredAt: climbAt,
        source: "demo"
      })
    );
  }

  return feed;
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

router.get("/activity-feed", async (req, res, next) => {
  try {
    const db = await getDb();
    const requestedChallengeId = parsePositiveInt(req.query.challengeId, null);
    const requestedLimit = Math.min(30, parsePositiveInt(req.query.limit, 8));
    const regionFilter = normalizeRegionFilter(req.query.region);

    const challengeRow = requestedChallengeId
      ? await db.get(
        `SELECT id, title, location, species
         FROM challenges
         WHERE id = ?
         LIMIT 1`,
        requestedChallengeId
      )
      : await db.get(
        `SELECT id, title, location, species
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

    if (!challengeRow?.id) {
      return res.json({ challengeId: null, events: [] });
    }

    const challengeId = Number(challengeRow.id);
    const challengeTitle = String(challengeRow.title || "Weekend Challenge");
    const challengeSpecies = String(challengeRow.species || "Mahi-Mahi");
    const challengeRegion = String(challengeRow.location || "Offshore");

    const participantEvents = await db.all(
      `SELECT
        p.id,
        strftime('%Y-%m-%dT%H:%M:%fZ', p.created_at) AS occurred_at,
        p.name,
        COALESCE(NULLIF(TRIM(u.region), ''), NULLIF(TRIM(u.location), ''), c.location) AS region
      FROM participants p
      LEFT JOIN users u ON u.id = p.user_id
      JOIN challenges c ON c.id = p.challenge_id
      WHERE p.challenge_id = ?
        AND datetime(p.created_at) >= datetime('now', '-48 hours')
        AND COALESCE(u.is_demo, 0) = 0
      ORDER BY datetime(p.created_at) DESC
      LIMIT 50`,
      challengeId
    );

    const submissionEvents = await db.all(
      `SELECT
        s.id,
        strftime('%Y-%m-%dT%H:%M:%fZ', s.created_at) AS occurred_at,
        s.species,
        COALESCE(s.verified_length, s.claimed_length, s.length) AS length,
        p.name,
        COALESCE(NULLIF(TRIM(u.region), ''), NULLIF(TRIM(u.location), ''), c.location) AS region
      FROM submissions s
      JOIN participants p ON p.id = s.participant_id
      LEFT JOIN users u ON u.id = p.user_id
      JOIN challenges c ON c.id = p.challenge_id
      WHERE p.challenge_id = ?
        AND datetime(s.created_at) >= datetime('now', '-48 hours')
        AND COALESCE(u.is_demo, 0) = 0
      ORDER BY datetime(s.created_at) DESC
      LIMIT 50`,
      challengeId
    );

    const rankEvents = await db.all(
      `WITH ranked AS (
        SELECT
          s.id,
          strftime('%Y-%m-%dT%H:%M:%fZ', s.created_at) AS occurred_at,
          p.name,
          COALESCE(NULLIF(TRIM(u.region), ''), NULLIF(TRIM(u.location), ''), c.location) AS region,
          ROW_NUMBER() OVER (
            ORDER BY s.verified_length DESC, datetime(s.created_at) ASC, s.id ASC
          ) AS rank
        FROM submissions s
        JOIN participants p ON p.id = s.participant_id
        LEFT JOIN users u ON u.id = p.user_id
        JOIN challenges c ON c.id = p.challenge_id
        WHERE p.challenge_id = ?
          AND s.status = 'approved'
          AND s.verified_length IS NOT NULL
          AND datetime(s.created_at) >= datetime('now', '-48 hours')
          AND COALESCE(u.is_demo, 0) = 0
      )
      SELECT id, occurred_at, name, region, rank
      FROM ranked
      WHERE rank <= 10
      ORDER BY datetime(occurred_at) DESC
      LIMIT 30`,
      challengeId
    );

    const realEvents = [];
    for (const row of participantEvents) {
      if (!includesRegion(row.region, regionFilter)) continue;
      realEvents.push(
        toFeedEvent({
          id: `real-join-${row.id}`,
          eventType: "join_challenge",
          actorName: row.name,
          region: row.region,
          challengeTitle,
          species: challengeSpecies,
          occurredAt: row.occurred_at,
          source: "real"
        })
      );
    }

    for (const row of submissionEvents) {
      if (!includesRegion(row.region, regionFilter)) continue;
      realEvents.push(
        toFeedEvent({
          id: `real-submit-${row.id}`,
          eventType: "submit_catch",
          actorName: row.name,
          region: row.region,
          challengeTitle,
          species: row.species,
          length: row.length,
          occurredAt: row.occurred_at,
          source: "real"
        })
      );
    }

    for (const row of rankEvents) {
      if (!includesRegion(row.region, regionFilter)) continue;
      realEvents.push(
        toFeedEvent({
          id: `real-climb-${row.id}`,
          eventType: "climb_leaderboard",
          actorName: row.name,
          region: row.region,
          challengeTitle,
          species: challengeSpecies,
          rank: row.rank,
          occurredAt: row.occurred_at,
          source: "real"
        })
      );
    }

    const demoUsers = await db.all(
      `SELECT id, name, region, location, species_preferences
       FROM users
       WHERE COALESCE(is_demo, 0) = 1
       ORDER BY id ASC
       LIMIT 12`
    );

    const filteredDemoUsers = demoUsers
      .map((user) => ({
        ...user,
        region: String(user.region || user.location || challengeRegion).trim() || challengeRegion
      }))
      .filter((user) => includesRegion(user.region, regionFilter));

    const demoEvents = buildDemoEvents({
      users: filteredDemoUsers.length > 0 ? filteredDemoUsers : demoUsers,
      challenge: challengeRow,
      limit: requestedLimit * 2
    });

    const merged = [...realEvents, ...demoEvents]
      .sort((a, b) => {
        const sourcePriority = (a.source === "real" ? 0 : 1) - (b.source === "real" ? 0 : 1);
        if (sourcePriority !== 0) return sourcePriority;
        const timeDiff = new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime();
        if (timeDiff !== 0) return timeDiff;
        return String(a.id).localeCompare(String(b.id));
      })
      .slice(0, requestedLimit);

    return res.json({
      challengeId,
      region: regionFilter || null,
      events: merged
    });
  } catch (err) {
    return next(err);
  }
});

export default router;
