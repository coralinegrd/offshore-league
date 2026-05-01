import { Router } from "express";
import { getDb } from "../db/database.js";

const router = Router();

router.get("/challenge", async (req, res, next) => {
  try {
    const db = await getDb();
    const row = await db.get("SELECT COUNT(*) as count FROM participants");
    const participants = row?.count || 0;
    const settings = await db.get("SELECT * FROM challenge_settings WHERE id = 1");
    const closesAtMs = settings?.closes_at ? new Date(settings.closes_at).getTime() : null;
    const now = Date.now();
    const msRemaining = Number.isFinite(closesAtMs) && closesAtMs > now ? closesAtMs - now : 0;
    const hours = Math.floor(msRemaining / (60 * 60 * 1000));
    const minutes = Math.floor((msRemaining % (60 * 60 * 1000)) / (60 * 1000));
    const countdown = `${hours}h ${String(minutes).padStart(2, "0")}m`;

    res.json({
      title: settings?.title || "Tampa Mahi-Mahi Challenge",
      location: settings?.location || "Tampa",
      species: settings?.species || "Mahi-Mahi",
      entryFee: settings?.entry_fee || 30,
      status: settings?.status || "active",
      closesAt: settings?.closes_at || null,
      cancellationReason: settings?.cancellation_reason || "",
      cancelledAt: settings?.cancelled_at || null,
      prizePool: participants * Number(settings?.entry_fee || 30),
      participants,
      countdown
    });
  } catch (err) {
    next(err);
  }
});

export default router;
