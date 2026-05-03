import crypto from "node:crypto";
import Stripe from "stripe";
import { Router } from "express";
import { getDb } from "../db/database.js";
import { requireUser } from "./auth.js";
import { queueTransactionalEmail } from "../lib/notifications.js";

const router = Router();
const CURRENCY = "usd";
const TERMS_VERSION = process.env.TERMS_VERSION || "2026-05-01";
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

function getRequesterIp(req) {
  return String(req.headers["x-forwarded-for"] || "").split(",")[0].trim()
    || req.ip
    || req.socket?.remoteAddress
    || "";
}

function getClientUrl() {
  return process.env.CLIENT_URL || "http://localhost:5173";
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

async function queueWinnerEmail(db, { userId, email, challengeCode }) {
  await queueTransactionalEmail(db, {
    userId,
    email,
    subject: "Entry confirmed",
    body: "Payment confirmed. Your Offshore League challenge entry is active.",
    emailType: "entry_confirmed",
    relatedRef: challengeCode
  });

  await queueTransactionalEmail(db, {
    userId,
    email,
    subject: "Your Offshore League challenge code is ready",
    body: `Payment confirmed. Your challenge code is ${challengeCode}. Include it in your catch video.`,
    emailType: "challenge_code_issued",
    relatedRef: challengeCode
  });
}

async function getChallengeById(db, challengeId) {
  return db.get(
    `SELECT id, title, location, species, entry_fee, status, closes_at, archived_at
     FROM challenges
     WHERE id = ?
     LIMIT 1`,
    challengeId
  );
}

async function createUniqueChallengeCode(db, challenge) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = createChallengeCode(challenge);
    const existing = await db.get("SELECT id FROM participants WHERE challenge_code = ?", code);
    if (!existing) return code;
  }

  throw new Error("Could not generate unique challenge code");
}

async function fulfillPaidCheckout(session) {
  if (session.payment_status !== "paid") {
    return null;
  }

  const db = await getDb();
  const checkout = await db.get(
    "SELECT * FROM checkout_sessions WHERE stripe_session_id = ?",
    session.id
  );

  if (!checkout) {
    throw new Error("Checkout session not found for fulfillment.");
  }

  if (checkout.status === "paid" && checkout.participant_id) {
    return db.get("SELECT * FROM participants WHERE id = ?", checkout.participant_id);
  }

  if (checkout.status === "refunded") {
    return null;
  }

  const user = await db.get("SELECT id, name, email FROM users WHERE id = ?", checkout.user_id);
  if (!user) {
    throw new Error("Checkout user not found.");
  }

  const challengeId = Number(checkout.challenge_id);
  if (!Number.isFinite(challengeId) || challengeId <= 0) {
    throw new Error("Checkout session is missing challenge context.");
  }

  const challenge = await getChallengeById(db, challengeId);
  if (!challenge) {
    throw new Error("Challenge not found for checkout fulfillment.");
  }

  const existingParticipant = await db.get(
    "SELECT id, challenge_code FROM participants WHERE user_id = ? AND challenge_id = ?",
    user.id,
    challengeId
  );

  if (existingParticipant) {
    await db.run(
      `UPDATE checkout_sessions
       SET status = 'paid',
           participant_id = ?,
           challenge_id = COALESCE(challenge_id, ?),
           payment_intent_id = ?,
           failure_reason = NULL,
           paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP)
       WHERE id = ?`,
      existingParticipant.id,
      challengeId,
      String(session.payment_intent || ""),
      checkout.id
    );

    return {
      id: existingParticipant.id,
      user_id: user.id,
      name: user.name,
      email: user.email,
      challenge_code: existingParticipant.challenge_code
    };
  }

  const challengeCode = await createUniqueChallengeCode(db, challenge);
  const participant = await db.run(
    "INSERT INTO participants (user_id, challenge_id, name, email, challenge_code) VALUES (?, ?, ?, ?, ?)",
    user.id,
    challengeId,
    user.name,
    user.email,
    challengeCode
  );

  await db.run(
    `UPDATE checkout_sessions
     SET status = 'paid',
         participant_id = ?,
         challenge_id = COALESCE(challenge_id, ?),
         payment_intent_id = ?,
         failure_reason = NULL,
         paid_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    participant.lastID,
    challengeId,
    String(session.payment_intent || ""),
    checkout.id
  );

  await queueWinnerEmail(db, {
    userId: user.id,
    email: user.email,
    challengeCode
  });

  return {
    id: participant.lastID,
    user_id: user.id,
    name: user.name,
    email: user.email,
    challenge_code: challengeCode
  };
}

async function markCheckoutFailedBySessionId(sessionId, reason, paymentIntentId = "") {
  const db = await getDb();
  await db.run(
    `UPDATE checkout_sessions
     SET status = 'failed',
         failure_reason = ?,
         payment_intent_id = COALESCE(NULLIF(?, ''), payment_intent_id)
     WHERE stripe_session_id = ? AND status = 'pending'`,
    reason,
    paymentIntentId,
    sessionId
  );
}

async function markCheckoutFailedByPaymentIntent(paymentIntentId, reason) {
  if (!paymentIntentId) return;
  const db = await getDb();
  await db.run(
    `UPDATE checkout_sessions
     SET status = 'failed',
         failure_reason = ?
     WHERE payment_intent_id = ? AND status = 'pending'`,
    reason,
    paymentIntentId
  );
}

function requireStripe(res) {
  if (!stripe) {
    res.status(500).json({
      error: "Stripe is not configured. Set STRIPE_SECRET_KEY in your environment."
    });
    return false;
  }

  return true;
}

router.post("/create-checkout-session", requireUser, async (req, res, next) => {
  try {
    if (!requireStripe(res)) return;

    const db = await getDb();
    const requestedChallengeId = Number(req.body?.challengeId);
    const challenge = Number.isFinite(requestedChallengeId) && requestedChallengeId > 0
      ? await getChallengeById(db, requestedChallengeId)
      : await db.get(
        `SELECT id, title, location, species, entry_fee, status, closes_at, archived_at
         FROM challenges
         WHERE archived_at IS NULL
         ORDER BY
           CASE status WHEN 'active' THEN 0 ELSE 1 END,
           datetime(closes_at) ASC,
           id DESC
         LIMIT 1`
      );

    if (!challenge?.id) {
      return res.status(404).json({ error: "Challenge was not found." });
    }

    const closesAtMs = challenge?.closes_at ? new Date(challenge.closes_at).getTime() : null;
    const challengeClosedByTime = Number.isFinite(closesAtMs) && closesAtMs > 0 && Date.now() > closesAtMs;
    if (challenge?.archived_at || challenge?.status !== "active" || challengeClosedByTime) {
      return res.status(409).json({ error: "Challenge is not accepting entries right now." });
    }

    const entryFee = Number(challenge.entry_fee || 0);
    if (!Number.isFinite(entryFee) || entryFee <= 0) {
      return res.status(409).json({ error: "Challenge entry fee is invalid." });
    }

    const entryFeeCents = Math.round(entryFee * 100);

    const existingParticipant = await db.get(
      "SELECT id FROM participants WHERE user_id = ? AND challenge_id = ?",
      req.user.id,
      challenge.id
    );
    if (existingParticipant) {
      return res.status(409).json({ error: "You already entered this challenge. One entry per account is allowed." });
    }

    const existingCheckout = await db.get(
      `SELECT status
       FROM checkout_sessions
       WHERE user_id = ?
         AND challenge_id = ?
         AND status IN ('pending', 'paid', 'refunded')
       LIMIT 1`,
      req.user.id,
      challenge.id
    );
    if (existingCheckout) {
      const message = existingCheckout.status === "pending"
        ? "You already have an in-progress entry checkout for this challenge."
        : "You already entered this challenge. One entry per account is allowed.";
      return res.status(409).json({ error: message });
    }

    const acceptedTerms = req.body?.acceptedTerms === true || req.body?.acceptedTerms === "true";
    const termsVersion = String(req.body?.termsVersion || TERMS_VERSION).trim() || TERMS_VERSION;
    if (termsVersion !== TERMS_VERSION) {
      return res.status(400).json({ error: "Terms version is outdated. Refresh and accept current terms." });
    }

    const existingAcceptance = await db.get(
      "SELECT id FROM terms_acceptances WHERE user_id = ? AND terms_version = ?",
      req.user.id,
      TERMS_VERSION
    );

    if (!existingAcceptance && !acceptedTerms) {
      return res.status(400).json({ error: "Accept current Terms and Privacy before checkout." });
    }

    if (!existingAcceptance && acceptedTerms) {
      await db.run(
        `INSERT OR IGNORE INTO terms_acceptances
          (user_id, terms_version, request_ip, user_agent, source)
         VALUES (?, ?, ?, ?, 'checkout')`,
        req.user.id,
        TERMS_VERSION,
        getRequesterIp(req),
        String(req.headers["user-agent"] || "")
      );
    }

    const clientUrl = getClientUrl();
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: req.user.email,
      client_reference_id: String(req.user.id),
      line_items: [
        {
          price_data: {
            currency: CURRENCY,
            product_data: {
              name: "Tampa Mahi-Mahi Challenge Entry",
              description: `${challenge.title} entry`
            },
            unit_amount: entryFeeCents
          },
          quantity: 1
        }
      ],
      metadata: {
        userId: String(req.user.id),
        challenge: challenge.title,
        challengeId: String(challenge.id)
      },
      payment_intent_data: {
        metadata: {
          userId: String(req.user.id),
          challenge: challenge.title,
          challengeId: String(challenge.id)
        }
      },
      success_url: `${clientUrl}/success?session_id={CHECKOUT_SESSION_ID}&challenge_id=${encodeURIComponent(String(challenge.id))}`,
      cancel_url: `${clientUrl}/challenges/${challenge.id}`
    });

    await db.run(
      "INSERT INTO checkout_sessions (user_id, stripe_session_id, status, challenge_id, payment_intent_id) VALUES (?, ?, 'pending', ?, ?)",
      req.user.id,
      session.id,
      challenge.id,
      String(session.payment_intent || "")
    );

    return res.json({
      checkoutStatus: "pending",
      checkoutUrl: session.url,
      stripeSessionId: session.id,
      challengeId: challenge.id,
      termsVersion: TERMS_VERSION
    });
  } catch (err) {
    next(err);
  }
});

router.get("/checkout-session/:sessionId", requireUser, async (req, res, next) => {
  try {
    if (!requireStripe(res)) return;

    const session = await stripe.checkout.sessions.retrieve(req.params.sessionId, {
      expand: ["payment_intent"]
    });

    if (String(session.client_reference_id) !== String(req.user.id)) {
      return res.status(403).json({ error: "Checkout session does not belong to this account." });
    }

    const db = await getDb();
    const checkout = await db.get("SELECT * FROM checkout_sessions WHERE stripe_session_id = ?", req.params.sessionId);
    if (checkout?.status === "refunded") {
      return res.json({
        checkoutStatus: "refunded",
        paid: false,
        refunded: true,
        error: "Payment was refunded."
      });
    }

    if (checkout?.status === "failed") {
      return res.json({
        checkoutStatus: "failed",
        paid: false,
        failed: true,
        error: checkout.failure_reason || "Payment failed."
      });
    }

    const participant = await fulfillPaidCheckout(session);

    if (!participant) {
      const paymentIntent = session.payment_intent;
      const declineMessage = paymentIntent?.last_payment_error?.message || "";
      if (declineMessage) {
        await markCheckoutFailedBySessionId(session.id, declineMessage, paymentIntent.id);
        return res.json({
          checkoutStatus: "failed",
          paid: false,
          failed: true,
          error: declineMessage
        });
      }

      if (session.status === "expired") {
        await markCheckoutFailedBySessionId(session.id, "Checkout expired before payment.", String(paymentIntent?.id || ""));
        return res.json({
          checkoutStatus: "failed",
          paid: false,
          failed: true,
          error: "Checkout session expired before payment."
        });
      }

      return res.json({
        checkoutStatus: session.payment_status,
        paid: false
      });
    }

    return res.json({
      checkoutStatus: "paid",
      paid: true,
      challengeCode: participant.challenge_code,
      paymentId: session.id,
      challengeId: checkout?.challenge_id || null
    });
  } catch (err) {
    next(err);
  }
});

export async function stripeWebhook(req, res) {
  if (!stripe) {
    return res.status(500).send("Stripe is not configured.");
  }

  const signature = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  let event;

  try {
    event = webhookSecret
      ? stripe.webhooks.constructEvent(req.body, signature, webhookSecret)
      : JSON.parse(req.body.toString("utf8"));
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    await fulfillPaidCheckout(event.data.object);
  }

  if (event.type === "checkout.session.async_payment_failed" || event.type === "checkout.session.expired") {
    const session = event.data.object;
    await markCheckoutFailedBySessionId(
      session.id,
      session.payment_status === "unpaid" ? "Card was declined or payment failed." : "Checkout did not complete.",
      String(session.payment_intent || "")
    );
  }

  if (event.type === "payment_intent.payment_failed") {
    const paymentIntent = event.data.object;
    const reason = paymentIntent?.last_payment_error?.message || "Card was declined or payment failed.";
    await markCheckoutFailedByPaymentIntent(paymentIntent.id, reason);
  }

  return res.json({ received: true });
}

export default router;
