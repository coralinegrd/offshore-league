import crypto from "node:crypto";
import Stripe from "stripe";
import { Router } from "express";
import { getDb } from "../db/database.js";
import { requireUser } from "./auth.js";
import { queueTransactionalEmail } from "../lib/notifications.js";

const router = Router();
const ENTRY_FEE_CENTS = 3000;
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

function createChallengeCode() {
  const token = crypto
    .randomBytes(12)
    .toString("base64url")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase()
    .slice(0, 16);
  return `TAMPA-${token}`;
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

async function getChallengeSettings(db) {
  return db.get("SELECT * FROM challenge_settings WHERE id = 1");
}

async function getCurrentChallengeRecord(db) {
  return db.get(
    "SELECT id, title FROM challenges WHERE archived_at IS NULL ORDER BY id DESC LIMIT 1"
  );
}

async function createUniqueChallengeCode(db) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = createChallengeCode();
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

  const currentChallenge = await getCurrentChallengeRecord(db);
  const challengeId = checkout.challenge_id || currentChallenge?.id;
  if (!challengeId) {
    throw new Error("No active challenge found.");
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

  const challengeCode = await createUniqueChallengeCode(db);
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
    const challenge = await getChallengeSettings(db);
    const currentChallenge = await getCurrentChallengeRecord(db);
    const closesAtMs = challenge?.closes_at ? new Date(challenge.closes_at).getTime() : null;
    const challengeClosedByTime = Number.isFinite(closesAtMs) && closesAtMs > 0 && Date.now() > closesAtMs;
    if (challenge?.status !== "active" || challengeClosedByTime || !currentChallenge?.id) {
      return res.status(409).json({ error: "Challenge is not accepting entries right now." });
    }

    const existingParticipant = await db.get(
      "SELECT id FROM participants WHERE user_id = ? AND challenge_id = ?",
      req.user.id,
      currentChallenge.id
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
      currentChallenge.id
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
              description: "Offshore League skill-based fishing challenge entry"
            },
            unit_amount: ENTRY_FEE_CENTS
          },
          quantity: 1
        }
      ],
      metadata: {
        userId: String(req.user.id),
        challenge: currentChallenge.title || "tampa-mahi-mahi",
        challengeId: String(currentChallenge.id)
      },
      payment_intent_data: {
        metadata: {
          userId: String(req.user.id),
          challenge: currentChallenge.title || "tampa-mahi-mahi",
          challengeId: String(currentChallenge.id)
        }
      },
      success_url: `${clientUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${clientUrl}/`
    });

    await db.run(
      "INSERT INTO checkout_sessions (user_id, stripe_session_id, status, challenge_id, payment_intent_id) VALUES (?, ?, 'pending', ?, ?)",
      req.user.id,
      session.id,
      currentChallenge.id,
      String(session.payment_intent || "")
    );

    return res.json({
      checkoutStatus: "pending",
      checkoutUrl: session.url,
      stripeSessionId: session.id,
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
      paymentId: session.id
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
