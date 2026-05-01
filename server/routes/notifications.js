import { Router } from "express";
import { getDb } from "../db/database.js";
import { markEmailDeliveryStatus } from "../lib/notifications.js";

const router = Router();

router.post("/email/events", async (req, res, next) => {
  try {
    const expectedSecret = String(process.env.EMAIL_EVENTS_SECRET || "").trim();
    if (!expectedSecret) {
      return res.status(501).json({ error: "Email events secret is not configured." });
    }

    const providedSecret = String(req.headers["x-email-events-secret"] || "").trim();
    if (!providedSecret || providedSecret !== expectedSecret) {
      return res.status(401).json({ error: "Unauthorized email event." });
    }

    const db = await getDb();
    const result = await markEmailDeliveryStatus(db, {
      status: req.body.status,
      providerMessageId: req.body.providerMessageId,
      email: req.body.email,
      emailType: req.body.emailType,
      relatedRef: req.body.relatedRef,
      failureReason: req.body.failureReason
    });

    if (!result.updated) {
      return res.status(404).json({ error: "Email record not found for event." });
    }

    return res.json({ updated: true, id: result.id });
  } catch (err) {
    return next(err);
  }
});

export default router;
