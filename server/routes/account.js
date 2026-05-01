import { Router } from "express";
import { getDb } from "../db/database.js";
import { requireUser } from "./auth.js";
import { getPendingPayouts, settleEligiblePayouts } from "../lib/payouts.js";

const router = Router();
const CHALLENGE_WINDOW_HOURS = 72;
const ENTRY_FEE = 30;
const PLATFORM_FEE_SHARE = 0.2;
const CHALLENGE_TITLE = "Tampa Mahi-Mahi Challenge";

function formatRemainingTime(msRemaining) {
  const totalMinutes = Math.max(0, Math.floor(msRemaining / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

router.put("/me/profile", requireUser, async (req, res, next) => {
  try {
    const name = (req.body.name || "").trim();
    const email = (req.body.email || "").trim().toLowerCase();
    const address = (req.body.address || "").trim();
    const location = (req.body.location || "").trim();

    if (!name || !email) {
      return res.status(400).json({ error: "Name and email are required." });
    }

    const db = await getDb();
    const existing = await db.get("SELECT id FROM users WHERE email = ? AND id != ?", email, req.user.id);
    if (existing) {
      return res.status(409).json({ error: "That email is already in use by another account." });
    }

    await db.run(
      "UPDATE users SET name = ?, email = ?, address = ?, location = ? WHERE id = ?",
      name,
      email,
      address,
      location,
      req.user.id
    );

    return res.json({
      user: {
        id: req.user.id,
        name,
        email,
        address,
        location
      }
    });
  } catch (err) {
    return next(err);
  }
});

router.put("/me/avatar", requireUser, async (req, res, next) => {
  try {
    const avatarUrl = typeof req.body.avatarUrl === "string" ? req.body.avatarUrl.trim() : "";

    if (!avatarUrl) {
      return res.status(400).json({ error: "Avatar is required." });
    }

    if (!avatarUrl.startsWith("data:image/")) {
      return res.status(400).json({ error: "Avatar must be an image." });
    }

    if (avatarUrl.length > 8_000_000) {
      return res.status(400).json({ error: "Avatar image is too large." });
    }

    const db = await getDb();
    await db.run("UPDATE users SET avatar_url = ? WHERE id = ?", avatarUrl, req.user.id);

    return res.json({ avatarUrl });
  } catch (err) {
    return next(err);
  }
});

router.get("/me/notification-preferences", requireUser, async (req, res, next) => {
  try {
    const db = await getDb();
    const user = await db.get(
      `SELECT
        notify_challenge_closing,
        notify_submission_reviewed,
        notify_new_regional_challenges
      FROM users
      WHERE id = ?`,
      req.user.id
    );

    return res.json({
      preferences: {
        challengeClosing: Boolean(user?.notify_challenge_closing),
        submissionReviewed: Boolean(user?.notify_submission_reviewed),
        newRegionalChallenges: Boolean(user?.notify_new_regional_challenges)
      }
    });
  } catch (err) {
    return next(err);
  }
});

router.put("/me/notification-preferences", requireUser, async (req, res, next) => {
  try {
    const challengeClosing = req.body.challengeClosing === true;
    const submissionReviewed = req.body.submissionReviewed === true;
    const newRegionalChallenges = req.body.newRegionalChallenges === true;

    const db = await getDb();
    await db.run(
      `UPDATE users
       SET notify_challenge_closing = ?,
           notify_submission_reviewed = ?,
           notify_new_regional_challenges = ?
       WHERE id = ?`,
      challengeClosing ? 1 : 0,
      submissionReviewed ? 1 : 0,
      newRegionalChallenges ? 1 : 0,
      req.user.id
    );

    return res.json({
      preferences: {
        challengeClosing,
        submissionReviewed,
        newRegionalChallenges
      }
    });
  } catch (err) {
    return next(err);
  }
});

router.get("/me/overview", requireUser, async (req, res, next) => {
  try {
    const db = await getDb();
    const participants = await db.all(
      `SELECT
        participants.id,
        participants.challenge_code,
        participants.created_at,
        latest_submission.status AS submission_status,
        latest_submission.created_at AS submission_created_at,
        latest_submission.verified_length AS submission_verified_length
      FROM participants
      LEFT JOIN submissions AS latest_submission
        ON latest_submission.id = (
          SELECT submissions.id
          FROM submissions
          WHERE submissions.participant_id = participants.id
          ORDER BY submissions.created_at DESC
          LIMIT 1
        )
      WHERE participants.user_id = ?
      ORDER BY participants.created_at DESC`,
      req.user.id
    );

    const now = Date.now();
    const challengeWindowMs = CHALLENGE_WINDOW_HOURS * 60 * 60 * 1000;
    const activeChallenges = participants
      .map((participant) => {
        const startedAt = new Date(participant.created_at).getTime();
        const endsAt = startedAt + challengeWindowMs;
        const msRemaining = Math.max(0, endsAt - now);

        return {
          participantId: participant.id,
          challengeCode: participant.challenge_code,
          startedAt: participant.created_at,
          endsAt: new Date(endsAt).toISOString(),
          msRemaining,
          remainingLabel: formatRemainingTime(msRemaining),
          submissionStatus: participant.submission_status || "not_submitted"
        };
      })
      .filter((participant) => participant.msRemaining > 0);

    const bestRanks = await db.all(
      `SELECT
        participants.user_id,
        MAX(submissions.verified_length) AS best_length
      FROM submissions
      JOIN participants ON participants.id = submissions.participant_id
      WHERE submissions.status = 'approved' AND submissions.verified_length IS NOT NULL
      GROUP BY participants.user_id
      ORDER BY best_length DESC`
    );

    const rankingIndex = bestRanks.findIndex((row) => Number(row.user_id) === Number(req.user.id));
    const ranking = rankingIndex >= 0
      ? {
          rank: rankingIndex + 1,
          totalRanked: bestRanks.length,
          bestLength: Number(bestRanks[rankingIndex].best_length)
        }
      : {
          rank: null,
          totalRanked: bestRanks.length,
          bestLength: null
        };

    const latestParticipant = participants[0] || null;

    return res.json({
      activeChallengeCount: activeChallenges.length,
      activeChallenges,
      latestSubmissionStatus: latestParticipant?.submission_status || "not_submitted",
      latestSubmissionAt: latestParticipant?.submission_created_at || null,
      latestVerifiedLength: latestParticipant?.submission_verified_length ?? null,
      ranking
    });
  } catch (err) {
    return next(err);
  }
});

router.get("/me/payouts", requireUser, async (req, res, next) => {
  try {
    const db = await getDb();
    await settleEligiblePayouts(db, { reviewedBy: "system" });

    const pendingWinnings = await getPendingPayouts(db, req.user.id);
    const paidOut = await db.all(
      `SELECT
        payout_logs.submission_id AS submissionId,
        payout_logs.challenge_title AS challenge,
        payout_logs.challenge_code AS challengeCode,
        payout_logs.amount,
        submissions.verified_length AS verifiedLength,
        payout_logs.paid_at AS paidAt,
        submissions.created_at AS createdAt
      FROM payout_logs
      JOIN submissions ON submissions.id = payout_logs.submission_id
      WHERE payout_logs.user_id = ?
      ORDER BY payout_logs.paid_at DESC`,
      req.user.id
    );

    const user = await db.get(
      "SELECT payout_method_type, payout_method_details FROM users WHERE id = ?",
      req.user.id
    );

    return res.json({
      hasWins: pendingWinnings.length > 0 || paidOut.length > 0,
      pendingWinnings,
      paidOut,
      preferredMethod: {
        type: user?.payout_method_type || "",
        details: user?.payout_method_details || ""
      }
    });
  } catch (err) {
    return next(err);
  }
});

router.put("/me/payout-method", requireUser, async (req, res, next) => {
  try {
    const methodType = (req.body.methodType || "").trim();
    const methodDetails = (req.body.methodDetails || "").trim();
    const allowed = new Set(["bank_transfer", "paypal", "other"]);

    if (!allowed.has(methodType)) {
      return res.status(400).json({ error: "Select a valid payout method." });
    }

    if (!methodDetails) {
      return res.status(400).json({ error: "Payout method details are required." });
    }

    const db = await getDb();
    await db.run(
      "UPDATE users SET payout_method_type = ?, payout_method_details = ? WHERE id = ?",
      methodType,
      methodDetails,
      req.user.id
    );

    return res.json({
      preferredMethod: {
        type: methodType,
        details: methodDetails
      }
    });
  } catch (err) {
    return next(err);
  }
});

router.get("/me/submissions", requireUser, async (req, res, next) => {
  try {
    const db = await getDb();
    const submissions = await db.all(
      `SELECT
        submissions.id,
        submissions.species,
        submissions.verified_length,
        submissions.claimed_weight,
        submissions.claimed_weight_unit,
        submissions.status,
        submissions.rejection_reason,
        submissions.created_at,
        participants.challenge_code
      FROM submissions
      JOIN participants ON participants.id = submissions.participant_id
      WHERE participants.user_id = ?
      ORDER BY submissions.created_at DESC`,
      req.user.id
    );

    return res.json({ submissions });
  } catch (err) {
    return next(err);
  }
});

router.get("/me/payments", requireUser, async (req, res, next) => {
  try {
    const db = await getDb();
    const payments = await db.all(
      `SELECT
        checkout_sessions.id,
        checkout_sessions.stripe_session_id,
        checkout_sessions.status,
        checkout_sessions.created_at,
        checkout_sessions.paid_at,
        participants.challenge_code
      FROM checkout_sessions
      LEFT JOIN participants ON participants.id = checkout_sessions.participant_id
      WHERE checkout_sessions.user_id = ?
      ORDER BY checkout_sessions.created_at DESC`,
      req.user.id
    );

    return res.json({
      payments: payments.map((payment) => ({
        ...payment,
        amount: 30,
        currency: "USD",
        challenge: "Tampa Mahi-Mahi Challenge"
      }))
    });
  } catch (err) {
    return next(err);
  }
});

export default router;
