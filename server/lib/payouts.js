import { queueTransactionalEmail } from "./notifications.js";

const ENTRY_FEE = 30;
const PLATFORM_FEE_SHARE = 0.2;
const CHALLENGE_WINDOW_HOURS = 72;

export async function settleEligiblePayouts(db, { reviewedBy = "system" } = {}) {
  const challenge = await db.get("SELECT title FROM challenge_settings WHERE id = 1");
  const challengeTitle = challenge?.title || "Tampa Mahi-Mahi Challenge";

  const participantsRow = await db.get("SELECT COUNT(*) AS count FROM participants");
  const participantsCount = Number(participantsRow?.count || 0);
  const winnerAmount = Number((participantsCount * ENTRY_FEE * (1 - PLATFORM_FEE_SHARE)).toFixed(2));

  const winners = await db.all(
    `SELECT
      submissions.id AS submission_id,
      submissions.verified_length,
      submissions.created_at AS submission_created_at,
      participants.id AS participant_id,
      participants.user_id,
      participants.challenge_code,
      participants.created_at AS challenge_started_at,
      participants.email,
      users.name,
      users.payout_method_type,
      users.payout_method_details
    FROM submissions
    JOIN participants ON participants.id = submissions.participant_id
    LEFT JOIN users ON users.id = participants.user_id
    WHERE submissions.status = 'approved'
      AND submissions.verified_length IS NOT NULL
      AND submissions.verified_length = (
        SELECT MAX(s2.verified_length)
        FROM submissions s2
        WHERE s2.status = 'approved' AND s2.verified_length IS NOT NULL
      )
    ORDER BY submissions.created_at DESC`
  );

  const now = Date.now();
  const challengeWindowMs = CHALLENGE_WINDOW_HOURS * 60 * 60 * 1000;
  const created = [];

  for (const winner of winners) {
    const startedAt = new Date(winner.challenge_started_at).getTime();
    const verificationEndsAt = startedAt + challengeWindowMs;
    if (!Number.isFinite(verificationEndsAt) || now < verificationEndsAt) {
      continue;
    }

    const existing = await db.get("SELECT id FROM payout_logs WHERE submission_id = ?", winner.submission_id);
    if (existing) {
      continue;
    }

    await db.run(
      `INSERT INTO payout_logs
        (submission_id, participant_id, user_id, challenge_code, challenge_title, amount,
         payout_method_type, payout_method_details, status, paid_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'paid', CURRENT_TIMESTAMP, ?)`,
      winner.submission_id,
      winner.participant_id,
      winner.user_id || null,
      winner.challenge_code,
      challengeTitle,
      winnerAmount,
      winner.payout_method_type || "",
      winner.payout_method_details || "",
      reviewedBy
    );

    if (winner.email) {
      await queueTransactionalEmail(db, {
        userId: winner.user_id || null,
        email: winner.email,
        subject: "Payout confirmed",
        body: `Your payout of $${winnerAmount.toFixed(2)} for ${winner.challenge_code} has been recorded as paid.`,
        emailType: "payout_confirmed",
        relatedRef: winner.challenge_code
      });
    }

    created.push({ submissionId: winner.submission_id, challengeCode: winner.challenge_code, amount: winnerAmount });
  }

  return { created, winnerAmount };
}

export async function getPendingPayouts(db, userId = null) {
  const participantsRow = await db.get("SELECT COUNT(*) AS count FROM participants");
  const participantsCount = Number(participantsRow?.count || 0);
  const winnerAmount = Number((participantsCount * ENTRY_FEE * (1 - PLATFORM_FEE_SHARE)).toFixed(2));

  const winners = await db.all(
    `SELECT
      submissions.id AS submission_id,
      submissions.verified_length,
      submissions.created_at AS submission_created_at,
      participants.user_id,
      participants.challenge_code,
      participants.created_at AS challenge_started_at
    FROM submissions
    JOIN participants ON participants.id = submissions.participant_id
    WHERE submissions.status = 'approved'
      AND submissions.verified_length IS NOT NULL
      AND submissions.verified_length = (
        SELECT MAX(s2.verified_length)
        FROM submissions s2
        WHERE s2.status = 'approved' AND s2.verified_length IS NOT NULL
      )
      AND (? IS NULL OR participants.user_id = ?)
    ORDER BY submissions.created_at DESC`,
    userId,
    userId
  );

  const now = Date.now();
  const challengeWindowMs = CHALLENGE_WINDOW_HOURS * 60 * 60 * 1000;

  const pending = [];
  for (const winner of winners) {
    const startedAt = new Date(winner.challenge_started_at).getTime();
    const verificationEndsAt = startedAt + challengeWindowMs;
    if (!Number.isFinite(verificationEndsAt) || now >= verificationEndsAt) {
      continue;
    }

    pending.push({
      submissionId: winner.submission_id,
      challengeCode: winner.challenge_code,
      amount: winnerAmount,
      verifiedLength: Number(winner.verified_length),
      verificationEndsAt: new Date(verificationEndsAt).toISOString(),
      createdAt: winner.submission_created_at
    });
  }

  return pending;
}
