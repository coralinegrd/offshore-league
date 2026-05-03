import Stripe from "stripe";
import crypto from "node:crypto";
import { Router } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "../db/database.js";
import { requireAdmin } from "./auth.js";
import { queueTransactionalEmail } from "../lib/notifications.js";
import { getPendingPayouts, settleEligiblePayouts } from "../lib/payouts.js";
import { getSubmissionSecurityMetrics } from "./submissions.js";

const router = Router();
const validStatuses = new Set(["approved", "rejected"]);
const challengeStatusValues = new Set(["draft", "active", "paused", "closed", "cancelled"]);
const ENTRY_FEE = 30;
const PLATFORM_FEE_SHARE = 0.2;
const CHALLENGE_WINDOW_HOURS = 72;
const DEMO_AUTO_ENROLL_MIN = 3;
const DEMO_AUTO_ENROLL_MAX = 6;
const DEMO_WAIVER_REASON = "demo_auto_enroll";
const validReasons = new Set([
  "missing code",
  "unclear measurement",
  "invalid media",
  "wrong species",
  "video has cuts",
  "fish not fully visible",
  "environment not visible"
]);
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsRoot = path.resolve(__dirname, "../uploads");

function safeParseWeather(value) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return { raw: String(value) };
  }
}

function requireStripe(res) {
  if (!stripe) {
    res.status(500).json({ error: "Stripe is not configured." });
    return false;
  }
  return true;
}

async function issueRefund(db, checkout, reason = "requested_by_customer") {
  if (!stripe) throw new Error("Stripe is not configured.");

  if (checkout.status === "refunded") {
    return {
      alreadyRefunded: true,
      refundId: checkout.refund_id
    };
  }

  const session = await stripe.checkout.sessions.retrieve(checkout.stripe_session_id, {
    expand: ["payment_intent"]
  });
  const paymentIntentId = checkout.payment_intent_id || session.payment_intent?.id || session.payment_intent;
  if (!paymentIntentId) {
    throw new Error("Payment intent missing for this checkout session.");
  }

  const refund = await stripe.refunds.create({
    payment_intent: String(paymentIntentId),
    reason
  });

  await db.run(
    `UPDATE checkout_sessions
     SET status = 'refunded',
         payment_intent_id = ?,
         refund_id = ?,
         refund_status = ?,
         refunded_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    String(paymentIntentId),
    refund.id,
    refund.status,
    checkout.id
  );

  return {
    alreadyRefunded: false,
    refundId: refund.id,
    refundStatus: refund.status
  };
}

router.use(requireAdmin);

function normalizeChallengePayload(challenge) {
  return {
    id: challenge?.id || 1,
    title: challenge?.title || "Tampa Mahi-Mahi Challenge",
    location: challenge?.location || "Tampa",
    species: challenge?.species || "Mahi-Mahi",
    entryFee: Number(challenge?.entry_fee || ENTRY_FEE),
    autoEnrollDemo: Number(challenge?.auto_enroll_demo ?? 1) !== 0,
    status: challenge?.status || "active",
    closesAt: challenge?.closes_at || null,
    cancellationReason: challenge?.cancellation_reason || "",
    cancelledAt: challenge?.cancelled_at || null,
    updatedAt: challenge?.updated_at || null
  };
}

async function getCurrentChallengeRecord(db) {
  return db.get("SELECT * FROM challenges WHERE archived_at IS NULL ORDER BY id DESC LIMIT 1");
}

async function getSelectedChallengeRecord(db, challengeId) {
  if (Number.isFinite(challengeId) && challengeId > 0) {
    return db.get("SELECT * FROM challenges WHERE id = ? LIMIT 1", challengeId);
  }
  return getCurrentChallengeRecord(db);
}

function sanitizeChallengePrefix(source) {
  const normalized = String(source || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
  return normalized || "CHALLENGE";
}

function createChallengeCode(challenge) {
  const prefix = sanitizeChallengePrefix(challenge?.location || challenge?.title || challenge?.id);
  const token = crypto
    .randomBytes(12)
    .toString("base64url")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase()
    .slice(0, 12);
  return `${prefix}-${token}`;
}

async function createUniqueChallengeCode(db, challenge) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = createChallengeCode(challenge);
    const existing = await db.get("SELECT id FROM participants WHERE challenge_code = ?", code);
    if (!existing) {
      return code;
    }
  }
  throw new Error("Could not generate unique challenge code for demo enrollment.");
}

function randomAutoEnrollCount() {
  return Math.floor(Math.random() * (DEMO_AUTO_ENROLL_MAX - DEMO_AUTO_ENROLL_MIN + 1)) + DEMO_AUTO_ENROLL_MIN;
}

function createDemoWaivedSessionId(challengeId, userId) {
  const suffix = crypto.randomBytes(8).toString("hex");
  return `demo-waived-${challengeId}-${userId}-${suffix}`;
}

function normalizeText(value) {
  const next = String(value || "").trim();
  return next || null;
}

async function getDefaultChallengeId(db) {
  const challenge = await db.get(
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
  return Number(challenge?.id || 0) || null;
}

async function countRealCatchesInRegion(db, challengeId, region) {
  const normalizedRegion = String(region || "").trim().toLowerCase();
  if (!normalizedRegion) return 0;

  const row = await db.get(
    `SELECT COUNT(*) AS count
     FROM submissions s
     JOIN participants p ON p.id = s.participant_id
     LEFT JOIN users u ON u.id = p.user_id
     JOIN challenges c ON c.id = p.challenge_id
     WHERE p.challenge_id = ?
       AND s.status = 'approved'
       AND COALESCE(u.is_demo, 0) = 0
       AND (
         lower(COALESCE(NULLIF(TRIM(u.region), ''), NULLIF(TRIM(u.location), ''), '')) LIKE '%' || ? || '%'
         OR lower(COALESCE(NULLIF(TRIM(s.catch_location), ''), '')) LIKE '%' || ? || '%'
         OR lower(COALESCE(NULLIF(TRIM(c.location), ''), '')) LIKE '%' || ? || '%'
       )`,
    challengeId,
    normalizedRegion,
    normalizedRegion,
    normalizedRegion
  );

  return Number(row?.count || 0);
}

function toEditorialPayload(row, communityCatchCount) {
  const expiresAtMs = row?.expires_at ? new Date(row.expires_at).getTime() : NaN;
  const expired = !Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now();
  const isPublished = Number(row?.is_published || 0) === 1;
  const autoHiddenByCommunity = Number(communityCatchCount || 0) >= 10;
  const visible = isPublished && !expired && !autoHiddenByCommunity;

  return {
    label: "Offshore League Editorial",
    challengeId: Number(row?.challenge_id || 0) || null,
    region: row?.region || "",
    activeSpecies: row?.active_species || "",
    conditionsNote: row?.conditions_note || "",
    expiresAt: row?.expires_at || null,
    isPublished,
    visible,
    expired,
    autoHiddenByCommunity,
    communityCatchCount: Number(communityCatchCount || 0),
    updatedAt: row?.updated_at || null
  };
}

async function autoEnrollDemoUsers(db, challenge) {
  if (!challenge?.id || Number(challenge.auto_enroll_demo ?? 1) === 0) {
    return 0;
  }

  const desiredCount = randomAutoEnrollCount();
  const demoUsers = await db.all(
    `SELECT id, name, email
     FROM users
     WHERE COALESCE(is_demo, 0) = 1
       AND id NOT IN (
         SELECT user_id
         FROM participants
         WHERE challenge_id = ?
           AND user_id IS NOT NULL
       )
     ORDER BY RANDOM()
     LIMIT ?`,
    challenge.id,
    desiredCount
  );

  let enrolledCount = 0;
  for (const demoUser of demoUsers) {
    const challengeCode = await createUniqueChallengeCode(db, challenge);
    const participant = await db.run(
      `INSERT INTO participants (user_id, challenge_id, name, email, challenge_code)
       VALUES (?, ?, ?, ?, ?)`,
      demoUser.id,
      challenge.id,
      demoUser.name,
      demoUser.email,
      challengeCode
    );

    await db.run(
      `INSERT INTO checkout_sessions
        (user_id, stripe_session_id, status, challenge_id, participant_id, is_fee_waived, waiver_reason, paid_at)
       VALUES (?, ?, 'paid', ?, ?, 1, ?, CURRENT_TIMESTAMP)`,
      demoUser.id,
      createDemoWaivedSessionId(challenge.id, demoUser.id),
      challenge.id,
      participant.lastID,
      DEMO_WAIVER_REASON
    );

    enrolledCount += 1;
  }

  return enrolledCount;
}

router.get("/challenge", async (req, res, next) => {
  try {
    const db = await getDb();
    const requestedChallengeId = Number(req.query.challengeId);
    const challenge = await getSelectedChallengeRecord(db, requestedChallengeId);

    return res.json({
      challenge: normalizeChallengePayload(challenge)
    });
  } catch (err) {
    return next(err);
  }
});

router.get("/editorial-zone-hot", async (req, res, next) => {
  try {
    const db = await getDb();
    const row = await db.get("SELECT * FROM editorial_zone_hot WHERE id = 1");
    const challengeId = Number(row?.challenge_id || 0) || await getDefaultChallengeId(db);
    const communityCatchCount = challengeId
      ? await countRealCatchesInRegion(db, challengeId, row?.region)
      : 0;

    return res.json({ editorial: toEditorialPayload(row, communityCatchCount) });
  } catch (err) {
    return next(err);
  }
});

router.put("/editorial-zone-hot", async (req, res, next) => {
  try {
    const db = await getDb();
    const isPublished = Boolean(req.body.isPublished);
    const region = normalizeText(req.body.region);
    const activeSpecies = normalizeText(req.body.activeSpecies);
    const conditionsNote = normalizeText(req.body.conditionsNote);
    const expiresAtRaw = normalizeText(req.body.expiresAt);
    const requestedChallengeId = Number(req.body.challengeId);
    const fallbackChallengeId = await getDefaultChallengeId(db);
    const challengeId = Number.isFinite(requestedChallengeId) && requestedChallengeId > 0
      ? requestedChallengeId
      : fallbackChallengeId;

    if (isPublished) {
      if (!challengeId) {
        return res.status(400).json({ error: "No active challenge found for editorial card." });
      }
      if (!region || !activeSpecies || !conditionsNote || !expiresAtRaw) {
        return res.status(400).json({ error: "Region, active species, conditions note, and expiry date are required." });
      }

      const expiresAt = new Date(expiresAtRaw);
      if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
        return res.status(400).json({ error: "Expiry date must be a valid future timestamp." });
      }

      await db.run(
        `UPDATE editorial_zone_hot
         SET challenge_id = ?,
             region = ?,
             active_species = ?,
             conditions_note = ?,
             expires_at = ?,
             is_published = 1,
             updated_by = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = 1`,
        challengeId,
        region,
        activeSpecies,
        conditionsNote,
        expiresAt.toISOString(),
        req.user.email
      );
    } else {
      await db.run(
        `UPDATE editorial_zone_hot
         SET is_published = 0,
             updated_by = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = 1`,
        req.user.email
      );
    }

    const updated = await db.get("SELECT * FROM editorial_zone_hot WHERE id = 1");
    const effectiveChallengeId = Number(updated?.challenge_id || 0) || fallbackChallengeId;
    const communityCatchCount = effectiveChallengeId
      ? await countRealCatchesInRegion(db, effectiveChallengeId, updated?.region)
      : 0;

    return res.json({ editorial: toEditorialPayload(updated, communityCatchCount) });
  } catch (err) {
    return next(err);
  }
});

router.put("/challenge/manage", async (req, res, next) => {
  try {
    const action = String(req.body.action || "edit").trim().toLowerCase();
    const title = String(req.body.title || "").trim();
    const location = String(req.body.location || "").trim();
    const species = String(req.body.species || "").trim();
    const numericEntryFee = Number(req.body.entryFee);
    const requestedChallengeId = Number(req.body.challengeId);
    const autoEnrollDemo = req.body.autoEnrollDemo === undefined
      ? null
      : Boolean(req.body.autoEnrollDemo);
    const closesAtRaw = String(req.body.closesAt || "").trim();
    const db = await getDb();
    const selectedChallenge = await getSelectedChallengeRecord(db, requestedChallengeId);
    let autoEnrolledDemoUsers = 0;

    if (["create", "edit"].includes(action)) {
      if (!title || !location || !species || !Number.isFinite(numericEntryFee) || numericEntryFee <= 0) {
        return res.status(400).json({ error: "Title, location, species, and a valid entry fee are required." });
      }

      const normalizedAutoEnrollDemo = autoEnrollDemo === null
        ? Number(selectedChallenge?.auto_enroll_demo ?? 1) !== 0
        : autoEnrollDemo;

      const closeDate = closesAtRaw ? new Date(closesAtRaw) : new Date(Date.now() + CHALLENGE_WINDOW_HOURS * 60 * 60 * 1000);
      if (!Number.isFinite(closeDate.getTime()) || closeDate.getTime() <= Date.now()) {
        return res.status(400).json({ error: "Close time must be a valid future timestamp." });
      }

      if (action === "create") {
        await db.run(
          `INSERT INTO challenges
            (title, location, species, entry_fee, auto_enroll_demo, status, closes_at, cancellation_reason, started_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'active', ?, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          title,
          location,
          species,
          numericEntryFee,
          normalizedAutoEnrollDemo ? 1 : 0,
          closeDate.toISOString()
        );

        const createdChallenge = await getCurrentChallengeRecord(db);
        autoEnrolledDemoUsers = await autoEnrollDemoUsers(db, createdChallenge);
      } else {
        if (!selectedChallenge?.id) {
          return res.status(404).json({ error: "Challenge not found for edit." });
        }
        await db.run(
          `UPDATE challenges
           SET title = ?,
               location = ?,
               species = ?,
               entry_fee = ?,
               auto_enroll_demo = ?,
               closes_at = ?,
               status = 'active',
               cancellation_reason = NULL,
               cancelled_at = NULL,
               archived_at = NULL,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          title,
          location,
          species,
          numericEntryFee,
          normalizedAutoEnrollDemo ? 1 : 0,
          closeDate.toISOString(),
          selectedChallenge.id
        );
      }
    } else if (action === "pause") {
      if (!selectedChallenge?.id) {
        return res.status(404).json({ error: "Challenge not found for pause." });
      }
      await db.run(
        `UPDATE challenges
         SET status = 'paused', updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        selectedChallenge.id
      );
    } else if (action === "resume") {
      if (!selectedChallenge?.id) {
        return res.status(404).json({ error: "Challenge not found for resume." });
      }
      await db.run(
        `UPDATE challenges
         SET status = 'active', updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        selectedChallenge.id
      );
    } else if (action === "close") {
      if (!selectedChallenge?.id) {
        return res.status(404).json({ error: "Challenge not found for close." });
      }
      await db.run(
        `UPDATE challenges
         SET status = 'closed',
             cancellation_reason = COALESCE(cancellation_reason, 'Closed by admin'),
             ended_at = COALESCE(ended_at, CURRENT_TIMESTAMP),
             archived_at = COALESCE(archived_at, CURRENT_TIMESTAMP),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        selectedChallenge.id
      );
    } else {
      return res.status(400).json({ error: "Unsupported challenge action." });
    }

    const updated = action === "create"
      ? await getCurrentChallengeRecord(db)
      : await getSelectedChallengeRecord(db, selectedChallenge?.id || requestedChallengeId);

    if (updated?.id) {
      await db.run(
        `UPDATE challenge_settings
         SET title = ?,
             location = ?,
             species = ?,
             entry_fee = ?,
           auto_enroll_demo = ?,
             status = ?,
             closes_at = ?,
             cancellation_reason = ?,
             cancelled_at = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = 1`,
        updated.title,
        updated.location,
        updated.species,
        updated.entry_fee,
        Number(updated.auto_enroll_demo ?? 1) !== 0 ? 1 : 0,
        updated.status,
        updated.closes_at,
        updated.cancellation_reason,
        updated.cancelled_at
      );
    }

    if (!challengeStatusValues.has(updated?.status)) {
      return res.status(500).json({ error: "Challenge status is invalid after update." });
    }

    return res.json({
      challenge: normalizeChallengePayload(updated),
      autoEnrolledDemoUsers
    });
  } catch (err) {
    return next(err);
  }
});

router.put("/challenge/close-time", async (req, res, next) => {
  try {
    const closesAt = (req.body.closesAt || "").trim();
    const requestedChallengeId = Number(req.body.challengeId);
    if (!closesAt) {
      return res.status(400).json({ error: "Challenge close time is required." });
    }

    const parsed = new Date(closesAt);
    const closeMs = parsed.getTime();
    if (!Number.isFinite(closeMs)) {
      return res.status(400).json({ error: "Challenge close time is invalid." });
    }

    if (closeMs <= Date.now()) {
      return res.status(400).json({ error: "Challenge close time must be in the future." });
    }

    const db = await getDb();
    const selectedChallenge = await getSelectedChallengeRecord(db, requestedChallengeId);
    if (!selectedChallenge?.id) {
      return res.status(404).json({ error: "Challenge not found for close-time update." });
    }

    await db.run(
      `UPDATE challenges
       SET closes_at = ?,
           status = 'active',
           cancellation_reason = NULL,
           cancelled_at = NULL,
           archived_at = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      parsed.toISOString(),
      selectedChallenge.id
    );

    const updated = await db.get(
      `SELECT id, title, location, species, entry_fee, auto_enroll_demo, status, closes_at, cancellation_reason, cancelled_at, updated_at
       FROM challenges
       WHERE id = ?`,
      selectedChallenge.id
    );

    await db.run(
      `UPDATE challenge_settings
       SET title = ?,
           location = ?,
           species = ?,
           entry_fee = ?,
           auto_enroll_demo = ?,
           status = ?,
           closes_at = ?,
           cancellation_reason = ?,
           cancelled_at = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = 1`,
      updated?.title,
      updated?.location,
      updated?.species,
      updated?.entry_fee,
      Number(updated?.auto_enroll_demo ?? 1) !== 0 ? 1 : 0,
      updated?.status,
      updated?.closes_at,
      updated?.cancellation_reason,
      updated?.cancelled_at
    );

    return res.json({
      challenge: normalizeChallengePayload(updated)
    });
  } catch (err) {
    return next(err);
  }
});

router.get("/metrics", async (req, res, next) => {
  try {
    const db = await getDb();
    const security = getSubmissionSecurityMetrics();

    const entriesRow = await db.get("SELECT COUNT(*) AS count FROM participants");
    const pendingSubmissionsRow = await db.get("SELECT COUNT(*) AS count FROM submissions WHERE status = 'pending'");
    const paidSessionsRow = await db.get(
      "SELECT COUNT(*) AS count FROM checkout_sessions WHERE status = 'paid' AND COALESCE(is_fee_waived, 0) = 0"
    );
    const refundedSessionsRow = await db.get(
      "SELECT COUNT(*) AS count FROM checkout_sessions WHERE status = 'refunded' AND COALESCE(is_fee_waived, 0) = 0"
    );
    const failedPaymentsRow = await db.get("SELECT COUNT(*) AS count FROM checkout_sessions WHERE status = 'failed'");
    const realUsersRow = await db.get("SELECT COUNT(*) AS count FROM users WHERE COALESCE(is_demo, 0) = 0");
    const demoUsersRow = await db.get("SELECT COUNT(*) AS count FROM users WHERE COALESCE(is_demo, 0) = 1");
    const uniqueEntrantsRow = await db.get("SELECT COUNT(DISTINCT lower(email)) AS count FROM participants");
    const repeatEntrantsRow = await db.get(
      `SELECT COUNT(*) AS count
       FROM (
         SELECT lower(email) AS email_key
         FROM participants
         GROUP BY lower(email)
         HAVING COUNT(*) > 1
       )`
    );

    const paidCount = Number(paidSessionsRow?.count || 0);
    const refundedCount = Number(refundedSessionsRow?.count || 0);
    const entriesCollected = paidCount + refundedCount;
    const grossCollected = entriesCollected * ENTRY_FEE;
    const refundedTotal = refundedCount * ENTRY_FEE;
    const netCollected = grossCollected - refundedTotal;
    const platformCut = Number((netCollected * PLATFORM_FEE_SHARE).toFixed(2));

    const participantsCount = Number(entriesRow?.count || 0);
    const successfulCheckoutCount = paidCount + refundedCount;
    const conversionRate = participantsCount > 0
      ? Number(((successfulCheckoutCount / participantsCount) * 100).toFixed(2))
      : 0;
    const uniqueEntrants = Number(uniqueEntrantsRow?.count || 0);
    const repeatEntrants = Number(repeatEntrantsRow?.count || 0);
    const repeatRate = uniqueEntrants > 0
      ? Number(((repeatEntrants / uniqueEntrants) * 100).toFixed(2))
      : 0;
    const prizeEligibleParticipantsRow = await db.get(
      `SELECT COUNT(*) AS count
       FROM participants
       LEFT JOIN users ON users.id = participants.user_id
       WHERE COALESCE(users.is_demo, 0) = 0`
    );
    const prizeEligibleParticipantsCount = Number(prizeEligibleParticipantsRow?.count || 0);
    const winnerAmount = Number((prizeEligibleParticipantsCount * ENTRY_FEE * (1 - PLATFORM_FEE_SHARE)).toFixed(2));
    const winners = await db.all(
      `SELECT
        submissions.id,
        participants.created_at AS challenge_started_at
      FROM submissions
      JOIN participants ON participants.id = submissions.participant_id
      LEFT JOIN users ON users.id = participants.user_id
      WHERE submissions.status = 'approved'
        AND submissions.verified_length IS NOT NULL
        AND COALESCE(users.is_demo, 0) = 0
        AND submissions.verified_length = (
          SELECT MAX(s2.verified_length)
          FROM submissions s2
          JOIN participants p2 ON p2.id = s2.participant_id
          LEFT JOIN users u2 ON u2.id = p2.user_id
          WHERE s2.status = 'approved'
            AND s2.verified_length IS NOT NULL
            AND COALESCE(u2.is_demo, 0) = 0
        )`
    );

    const now = Date.now();
    const challengeWindowMs = CHALLENGE_WINDOW_HOURS * 60 * 60 * 1000;
    const pendingPayoutCount = winners.filter((winner) => {
      const startedAt = new Date(winner.challenge_started_at).getTime();
      return now < startedAt + challengeWindowMs;
    }).length;
    const prizeOwed = Number((pendingPayoutCount * winnerAmount).toFixed(2));

    return res.json({
      entries: participantsCount,
      entriesCollected,
      pendingSubmissions: Number(pendingSubmissionsRow?.count || 0),
      grossCollected,
      refundedTotal,
      netCollected,
      platformCut,
      prizeOwed,
      paidSessions: paidCount,
      refundedSessions: refundedCount,
      failedPayments: Number(failedPaymentsRow?.count || 0),
      conversionRate,
      realUsers: Number(realUsersRow?.count || 0),
      demoUsers: Number(demoUsersRow?.count || 0),
      uniqueEntrants,
      repeatEntrants,
      repeatRate,
      submissionRateLimited: security.rateLimitedCount,
      submissionRateLimitWindowMs: security.rateLimitWindowMs,
      submissionRateLimitMax: security.rateLimitMax
    });
  } catch (err) {
    return next(err);
  }
});

router.get("/payments", async (req, res, next) => {
  try {
    const db = await getDb();
    const rows = await db.all(
      `SELECT
        checkout_sessions.id,
        checkout_sessions.stripe_session_id,
        checkout_sessions.status,
        checkout_sessions.is_fee_waived,
        checkout_sessions.waiver_reason,
        checkout_sessions.paid_at,
        checkout_sessions.refunded_at,
        checkout_sessions.refund_status,
        checkout_sessions.failure_reason,
        users.email,
        participants.challenge_code
      FROM checkout_sessions
      JOIN users ON users.id = checkout_sessions.user_id
      LEFT JOIN participants ON participants.id = checkout_sessions.participant_id
      ORDER BY checkout_sessions.created_at DESC`
    );

    return res.json({ payments: rows });
  } catch (err) {
    return next(err);
  }
});

router.post("/refunds/:checkoutId", async (req, res, next) => {
  try {
    if (!requireStripe(res)) return;

    const db = await getDb();
    const checkout = await db.get("SELECT * FROM checkout_sessions WHERE id = ?", req.params.checkoutId);
    if (!checkout) {
      return res.status(404).json({ error: "Checkout session not found." });
    }

    if (checkout.status !== "paid" && checkout.status !== "refunded") {
      return res.status(400).json({ error: "Only paid sessions can be refunded." });
    }

    if (Number(checkout.is_fee_waived || 0) === 1) {
      return res.status(400).json({ error: "Waived demo entries do not have chargeable payments to refund." });
    }

    const result = await issueRefund(db, checkout, "requested_by_customer");
    return res.json({
      checkoutId: Number(req.params.checkoutId),
      refunded: true,
      ...result
    });
  } catch (err) {
    return next(err);
  }
});

router.post("/challenge/cancel", async (req, res, next) => {
  try {
    if (!requireStripe(res)) return;
    const reason = (req.body.reason || "Cancelled by admin").trim();

    const db = await getDb();
    await db.run(
      `UPDATE challenge_settings
       SET status = 'cancelled', cancellation_reason = ?, cancelled_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = 1`,
      reason
    );

    await db.run(
      `UPDATE challenges
       SET status = 'cancelled',
           cancellation_reason = ?,
           ended_at = COALESCE(ended_at, CURRENT_TIMESTAMP),
           archived_at = COALESCE(archived_at, CURRENT_TIMESTAMP),
           updated_at = CURRENT_TIMESTAMP
       WHERE archived_at IS NULL`,
      reason
    );

    const paidCheckouts = await db.all(
      "SELECT * FROM checkout_sessions WHERE status = 'paid' AND COALESCE(is_fee_waived, 0) = 0"
    );
    const refunded = [];
    const failed = [];

    for (const checkout of paidCheckouts) {
      try {
        const refundResult = await issueRefund(db, checkout, "requested_by_customer");
        refunded.push({
          checkoutId: checkout.id,
          refundId: refundResult.refundId,
          alreadyRefunded: refundResult.alreadyRefunded
        });
      } catch (err) {
        failed.push({
          checkoutId: checkout.id,
          error: err.message
        });
      }
    }

    return res.json({
      status: "cancelled",
      reason,
      refundedCount: refunded.length,
      failedCount: failed.length,
      refunded,
      failed
    });
  } catch (err) {
    return next(err);
  }
});

router.get("/submissions", async (req, res, next) => {
  try {
    const db = await getDb();
    const rows = await db.all(`
      SELECT
        submissions.id,
        submissions.participant_id,
        participants.name,
        participants.email,
        participants.challenge_code,
        submissions.species,
        submissions.verified_length,
        submissions.claimed_weight,
        submissions.claimed_weight_unit,
        submissions.catch_location,
        submissions.catch_latitude,
        submissions.catch_longitude,
        submissions.catch_weather_json,
        submissions.caught_at,
        submissions.media_path,
        submissions.status,
        submissions.rejection_reason,
        submissions.created_at
      FROM submissions
      JOIN participants ON participants.id = submissions.participant_id
      ORDER BY submissions.created_at DESC
    `);

    const submissions = rows.map((submission) => ({
      ...submission,
      catch_weather: safeParseWeather(submission.catch_weather_json),
      media_url: `/api/admin/submissions/${submission.id}/media`,
      media_path: undefined
    }));

    res.json({ submissions });
  } catch (err) {
    next(err);
  }
});

router.get("/submissions/:id/media", async (req, res, next) => {
  try {
    const submissionId = Number(req.params.id);
    if (!Number.isFinite(submissionId) || submissionId <= 0) {
      return res.status(400).json({ error: "Submission ID is invalid." });
    }

    const db = await getDb();
    const row = await db.get(
      "SELECT media_path, media_mime_type FROM submissions WHERE id = ?",
      submissionId
    );

    if (!row?.media_path) {
      return res.status(404).json({ error: "Media not found." });
    }

    const relativePath = String(row.media_path).replace(/^\/+/, "");
    const absolutePath = path.resolve(__dirname, "..", relativePath);
    if (!absolutePath.startsWith(uploadsRoot)) {
      return res.status(400).json({ error: "Invalid media path." });
    }

    if (row.media_mime_type) {
      res.setHeader("Content-Type", row.media_mime_type);
    }
    res.setHeader("Cache-Control", "private, no-store");
    return res.sendFile(absolutePath);
  } catch (err) {
    return next(err);
  }
});

router.get("/review-logs", async (req, res, next) => {
  try {
    const db = await getDb();
    const logs = await db.all(
      `SELECT
        submission_status_logs.id,
        submission_status_logs.submission_id,
        submission_status_logs.previous_status,
        submission_status_logs.new_status,
        submission_status_logs.rejection_reason,
        submission_status_logs.verified_length,
        submission_status_logs.reviewed_by,
        submission_status_logs.created_at,
        participants.name,
        participants.challenge_code
      FROM submission_status_logs
      JOIN submissions ON submissions.id = submission_status_logs.submission_id
      JOIN participants ON participants.id = submissions.participant_id
      ORDER BY submission_status_logs.created_at DESC`
    );

    return res.json({ logs });
  } catch (err) {
    return next(err);
  }
});

router.get("/payout-history", async (req, res, next) => {
  try {
    const db = await getDb();
    await settleEligiblePayouts(db, { reviewedBy: req.user.email });

    const pending = await getPendingPayouts(db, null);
    const paid = await db.all(
      `SELECT
        payout_logs.id,
        payout_logs.submission_id AS submissionId,
        payout_logs.challenge_code AS challengeCode,
        payout_logs.challenge_title AS challenge,
        payout_logs.amount,
        payout_logs.payout_method_type AS payoutMethodType,
        payout_logs.payout_method_details AS payoutMethodDetails,
        payout_logs.paid_at AS paidAt,
        participants.name,
        participants.email
      FROM payout_logs
      JOIN participants ON participants.id = payout_logs.participant_id
      ORDER BY payout_logs.paid_at DESC`
    );

    return res.json({ pending, paid });
  } catch (err) {
    return next(err);
  }
});

router.get("/email-delivery", async (req, res, next) => {
  try {
    const db = await getDb();
    const emails = await db.all(
      `SELECT
        id,
        user_id,
        email_to,
        subject,
        email_type,
        related_ref,
        status,
        failure_reason,
        provider_message_id,
        created_at,
        sent_at,
        updated_at
      FROM notification_emails
      ORDER BY created_at DESC
      LIMIT 500`
    );
    return res.json({ emails });
  } catch (err) {
    return next(err);
  }
});

router.get("/leaderboard", async (req, res, next) => {
  try {
    const db = await getDb();
    const requestedChallengeId = Number(req.query.challengeId);
    const activeChallenge = await getCurrentChallengeRecord(db);
    const challengeId = Number.isFinite(requestedChallengeId) && requestedChallengeId > 0
      ? requestedChallengeId
      : (activeChallenge?.id || null);

    if (!challengeId) {
      return res.json({ entries: [], challengeId: null });
    }

    const rows = await db.all(
      `SELECT
        submissions.id,
        participants.name,
        participants.challenge_code,
        submissions.species,
        submissions.verified_length,
        submissions.status,
        submissions.created_at
      FROM submissions
      JOIN participants ON participants.id = submissions.participant_id
      WHERE submissions.status = 'approved'
        AND submissions.verified_length IS NOT NULL
        AND participants.challenge_id = ?
      ORDER BY submissions.verified_length DESC, submissions.created_at ASC`,
      challengeId
    );

    return res.json({
      challengeId,
      entries: rows.map((row, index) => ({
        rank: index + 1,
        submissionId: row.id,
        name: row.name,
        challengeCode: row.challenge_code,
        species: row.species,
        verifiedLength: Number(row.verified_length),
        status: row.status,
        createdAt: row.created_at
      }))
    });
  } catch (err) {
    return next(err);
  }
});

router.get("/leaderboard/history", async (req, res, next) => {
  try {
    const db = await getDb();
    const challenges = await db.all(
      `SELECT
        challenges.id,
        challenges.title,
        challenges.location,
        challenges.species,
        challenges.status,
        challenges.started_at,
        challenges.ended_at,
        challenges.archived_at,
        (
          SELECT COUNT(*)
          FROM participants
          WHERE participants.challenge_id = challenges.id
        ) AS entries,
        (
          SELECT COUNT(DISTINCT lower(participants.email))
          FROM participants
          WHERE participants.challenge_id = challenges.id
        ) AS uniqueEntrants,
        (
          SELECT COUNT(*)
          FROM (
            SELECT lower(participants.email) AS email_key
            FROM participants
            WHERE participants.challenge_id = challenges.id
            GROUP BY lower(participants.email)
            HAVING COUNT(*) > 1
          )
        ) AS repeatEntrants,
        (
          SELECT COUNT(*)
          FROM checkout_sessions
          JOIN participants ON participants.id = checkout_sessions.participant_id
          WHERE participants.challenge_id = challenges.id
            AND checkout_sessions.status IN ('paid', 'refunded')
            AND COALESCE(checkout_sessions.is_fee_waived, 0) = 0
        ) AS successfulCheckouts,
        (
          SELECT COUNT(*)
          FROM submissions
          JOIN participants ON participants.id = submissions.participant_id
          WHERE participants.challenge_id = challenges.id
            AND submissions.status = 'approved'
            AND submissions.verified_length IS NOT NULL
        ) AS approvedEntries
      FROM challenges
      ORDER BY COALESCE(challenges.archived_at, challenges.updated_at) DESC, challenges.id DESC`
    );

    return res.json({
      challenges: challenges.map((challenge) => {
        const entries = Number(challenge.entries || 0);
        const uniqueEntrants = Number(challenge.uniqueEntrants || 0);
        const repeatEntrants = Number(challenge.repeatEntrants || 0);
        const successfulCheckouts = Number(challenge.successfulCheckouts || 0);

        return {
          ...challenge,
          entries,
          uniqueEntrants,
          repeatEntrants,
          successfulCheckouts,
          conversionRate: entries > 0
            ? Number(((successfulCheckouts / entries) * 100).toFixed(2))
            : 0,
          repeatRate: uniqueEntrants > 0
            ? Number(((repeatEntrants / uniqueEntrants) * 100).toFixed(2))
            : 0
        };
      })
    });
  } catch (err) {
    return next(err);
  }
});

router.get("/users", async (req, res, next) => {
  try {
    const db = await getDb();
    const users = await db.all(
      `SELECT
        participants.id AS participant_id,
        participants.name,
        participants.email,
        participants.challenge_code,
        participants.created_at,
        checkout_sessions.id AS checkout_id,
        CASE
          WHEN COALESCE(checkout_sessions.is_fee_waived, 0) = 1 THEN 'waived'
          ELSE checkout_sessions.status
        END AS payment_status,
        submissions.id AS submission_id,
        submissions.status AS submission_status,
        submissions.rejection_reason,
        (
          SELECT COUNT(*)
          FROM participants p2
          WHERE lower(p2.email) = lower(participants.email)
        ) AS same_email_count,
        (
          SELECT COUNT(*)
          FROM participant_flags pf
          WHERE pf.participant_id = participants.id AND pf.status = 'open'
        ) AS open_flags
      FROM participants
      LEFT JOIN checkout_sessions ON checkout_sessions.participant_id = participants.id
      LEFT JOIN submissions ON submissions.participant_id = participants.id
      ORDER BY participants.created_at DESC`
    );

    return res.json({
      users: users.map((row) => ({
        participantId: row.participant_id,
        name: row.name,
        email: row.email,
        challengeCode: row.challenge_code,
        checkoutId: row.checkout_id,
        paymentStatus: row.payment_status || "pending",
        submissionId: row.submission_id,
        submissionStatus: row.submission_status || "not_submitted",
        rejectionReason: row.rejection_reason || "",
        potentialDuplicate: Number(row.same_email_count || 0) > 1,
        openFlags: Number(row.open_flags || 0),
        createdAt: row.created_at
      }))
    });
  } catch (err) {
    return next(err);
  }
});

router.post("/participants/:participantId/flag-duplicate", async (req, res, next) => {
  try {
    const participantId = Number(req.params.participantId);
    const notes = String(req.body.notes || "Potential duplicate entry").trim();
    if (!Number.isFinite(participantId) || participantId <= 0) {
      return res.status(400).json({ error: "Participant ID is invalid." });
    }

    const db = await getDb();
    const participant = await db.get("SELECT id FROM participants WHERE id = ?", participantId);
    if (!participant) {
      return res.status(404).json({ error: "Participant not found." });
    }

    const existingOpen = await db.get(
      "SELECT id FROM participant_flags WHERE participant_id = ? AND flag_type = 'duplicate' AND status = 'open'",
      participantId
    );
    if (existingOpen) {
      return res.status(409).json({ error: "Duplicate flag already open for this participant." });
    }

    const flagged = await db.run(
      `INSERT INTO participant_flags (participant_id, flag_type, notes, created_by, status)
       VALUES (?, 'duplicate', ?, ?, 'open')`,
      participantId,
      notes,
      req.user.email
    );

    return res.status(201).json({
      flagId: flagged.lastID,
      participantId,
      status: "open"
    });
  } catch (err) {
    return next(err);
  }
});

router.post("/participants/flags/bulk-duplicate", async (req, res, next) => {
  try {
    const participantIds = Array.isArray(req.body.participantIds) ? req.body.participantIds : [];
    const notes = String(req.body.notes || "Potential duplicate entry").trim();
    const normalizedIds = [...new Set(participantIds.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0))];

    if (normalizedIds.length === 0) {
      return res.status(400).json({ error: "At least one participant ID is required." });
    }

    const db = await getDb();
    const created = [];
    const skipped = [];

    for (const participantId of normalizedIds) {
      const participant = await db.get("SELECT id FROM participants WHERE id = ?", participantId);
      if (!participant) {
        skipped.push({ participantId, reason: "Participant not found." });
        continue;
      }

      const existingOpen = await db.get(
        "SELECT id FROM participant_flags WHERE participant_id = ? AND flag_type = 'duplicate' AND status = 'open'",
        participantId
      );
      if (existingOpen) {
        skipped.push({ participantId, reason: "Duplicate flag already open." });
        continue;
      }

      const flagged = await db.run(
        `INSERT INTO participant_flags (participant_id, flag_type, notes, created_by, status)
         VALUES (?, 'duplicate', ?, ?, 'open')`,
        participantId,
        notes,
        req.user.email
      );
      created.push({ participantId, flagId: flagged.lastID });
    }

    return res.status(201).json({
      requested: normalizedIds.length,
      createdCount: created.length,
      skippedCount: skipped.length,
      created,
      skipped
    });
  } catch (err) {
    return next(err);
  }
});

router.post("/refunds/bulk", async (req, res, next) => {
  try {
    if (!requireStripe(res)) return;

    const checkoutIds = Array.isArray(req.body.checkoutIds) ? req.body.checkoutIds : [];
    const normalizedIds = [...new Set(checkoutIds.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0))];

    if (normalizedIds.length === 0) {
      return res.status(400).json({ error: "At least one checkout ID is required." });
    }

    const db = await getDb();
    const refunded = [];
    const skipped = [];

    for (const checkoutId of normalizedIds) {
      const checkout = await db.get("SELECT * FROM checkout_sessions WHERE id = ?", checkoutId);
      if (!checkout) {
        skipped.push({ checkoutId, reason: "Checkout session not found." });
        continue;
      }

      if (checkout.status !== "paid" && checkout.status !== "refunded") {
        skipped.push({ checkoutId, reason: "Only paid sessions can be refunded." });
        continue;
      }

      try {
        const result = await issueRefund(db, checkout, "requested_by_customer");
        refunded.push({
          checkoutId,
          refundId: result.refundId,
          alreadyRefunded: Boolean(result.alreadyRefunded)
        });
      } catch (refundErr) {
        skipped.push({ checkoutId, reason: refundErr.message || "Refund failed." });
      }
    }

    return res.json({
      requested: normalizedIds.length,
      refundedCount: refunded.length,
      skippedCount: skipped.length,
      refunded,
      skipped
    });
  } catch (err) {
    return next(err);
  }
});

router.get("/flags", async (req, res, next) => {
  try {
    const db = await getDb();
    const flags = await db.all(
      `SELECT
        participant_flags.id,
        participant_flags.participant_id,
        participant_flags.flag_type,
        participant_flags.notes,
        participant_flags.created_by,
        participant_flags.status,
        participant_flags.created_at,
        participants.name,
        participants.email,
        participants.challenge_code
      FROM participant_flags
      JOIN participants ON participants.id = participant_flags.participant_id
      ORDER BY participant_flags.created_at DESC`
    );

    return res.json({ flags });
  } catch (err) {
    return next(err);
  }
});

router.put("/submissions/:id/status", async (req, res, next) => {
  try {
    const { status, rejectionReason, verifiedLength } = req.body;
    const { id } = req.params;

    if (!validStatuses.has(status)) {
      return res.status(400).json({ error: "Status must be approved or rejected." });
    }

    if (status === "rejected" && !validReasons.has(rejectionReason)) {
      return res.status(400).json({ error: "A valid rejection reason is required." });
    }

    const numericVerifiedLength = Number(verifiedLength);
    if (status === "approved" && (!Number.isFinite(numericVerifiedLength) || numericVerifiedLength <= 0)) {
      return res.status(400).json({ error: "Verified length is required before approval." });
    }

    const db = await getDb();
    const existing = await db.get("SELECT status FROM submissions WHERE id = ?", id);
    if (!existing) {
      return res.status(404).json({ error: "Submission not found." });
    }

    const participant = await db.get(
      `SELECT participants.user_id, participants.email, participants.challenge_code
       FROM submissions
       JOIN participants ON participants.id = submissions.participant_id
       WHERE submissions.id = ?`,
      id
    );

    const result = await db.run(
      "UPDATE submissions SET status = ?, rejection_reason = ?, verified_length = ? WHERE id = ?",
      status,
      status === "rejected" ? rejectionReason : null,
      status === "approved" ? numericVerifiedLength : null,
      id
    );

    await db.run(
      `INSERT INTO submission_status_logs
        (submission_id, previous_status, new_status, rejection_reason, verified_length, reviewed_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      Number(id),
      existing.status,
      status,
      status === "rejected" ? rejectionReason : null,
      status === "approved" ? numericVerifiedLength : null,
      req.user.email
    );

    if (participant?.email) {
      const outcomeText = status === "approved"
        ? `approved at ${Number(numericVerifiedLength).toFixed(1)} cm`
        : `rejected (${rejectionReason})`;

      await queueTransactionalEmail(db, {
        userId: participant.user_id || null,
        email: participant.email,
        subject: "Submission result available",
        body: `Your submission for ${participant.challenge_code} was ${outcomeText}.`,
        emailType: "submission_result",
        relatedRef: participant.challenge_code
      });
    }

    return res.json({ id: Number(id), status });
  } catch (err) {
    next(err);
  }
});

export default router;
