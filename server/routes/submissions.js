import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import multer from "multer";
import { Router } from "express";
import { getDb } from "../db/database.js";
import { queueTransactionalEmail } from "../lib/notifications.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDir = path.resolve(__dirname, "../uploads");
fs.mkdirSync(uploadDir, { recursive: true });
const MAX_VIDEO_FILE_SIZE_BYTES = Number(process.env.SUBMISSION_MAX_VIDEO_BYTES || 512 * 1024 * 1024);
const MEDIA_RETENTION_DAYS = Number(process.env.SUBMISSION_MEDIA_RETENTION_DAYS || 120);
const parsedRateWindowMs = Number(process.env.SUBMISSION_RATE_LIMIT_WINDOW_MS);
const SUBMISSION_RATE_LIMIT_WINDOW_MS = Number.isFinite(parsedRateWindowMs) && parsedRateWindowMs > 0
  ? parsedRateWindowMs
  : 10 * 60 * 1000;
const parsedRateMax = Number(process.env.SUBMISSION_RATE_LIMIT_MAX);
const SUBMISSION_RATE_LIMIT_MAX = Number.isFinite(parsedRateMax) && parsedRateMax > 0
  ? Math.floor(parsedRateMax)
  : 5;
const submissionRateBuckets = new Map();
let submissionRateLimitedCount = 0;
const CHALLENGE_CODE_PATTERN = /^TAMPA-(?:[A-Z0-9]{16}|UPL\d{8})$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function getSubmissionSecurityMetrics() {
  return {
    rateLimitedCount: submissionRateLimitedCount,
    rateLimitWindowMs: SUBMISSION_RATE_LIMIT_WINDOW_MS,
    rateLimitMax: SUBMISSION_RATE_LIMIT_MAX
  };
}

function takeSubmissionToken(key) {
  const now = Date.now();
  const bucket = submissionRateBuckets.get(key) || { count: 0, windowStart: now };
  if (now - bucket.windowStart > SUBMISSION_RATE_LIMIT_WINDOW_MS) {
    bucket.count = 0;
    bucket.windowStart = now;
  }

  bucket.count += 1;
  submissionRateBuckets.set(key, bucket);
  return bucket.count <= SUBMISSION_RATE_LIMIT_MAX;
}

function cleanupRateBuckets() {
  const now = Date.now();
  for (const [key, bucket] of submissionRateBuckets.entries()) {
    if (now - bucket.windowStart > SUBMISSION_RATE_LIMIT_WINDOW_MS * 2) {
      submissionRateBuckets.delete(key);
    }
  }
}

function detectDeviceType(userAgent) {
  const source = String(userAgent || "").toLowerCase();
  if (!source) return "unknown";
  if (source.includes("ipad") || source.includes("tablet")) return "tablet";
  if (source.includes("mobi") || source.includes("android") || source.includes("iphone")) return "mobile";
  return "desktop";
}

function createReceiptCode() {
  const token = crypto.randomBytes(6).toString("hex").toUpperCase();
  return `SUB-${Date.now().toString(36).toUpperCase()}-${token}`;
}

function normalizeOptionalText(value, maxLength) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return null;
  }
  if (normalized.length > maxLength) {
    throw new Error(`Text value exceeds maximum length (${maxLength}).`);
  }
  return normalized;
}

function parseOptionalCoordinate(value, min, max, label) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`${label} is invalid.`);
  }

  return Number(parsed.toFixed(6));
}

function parseOptionalCaughtAt(value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return null;
  }

  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Caught-at date is invalid.");
  }

  return parsed.toISOString();
}

function parseOptionalWeatherJson(value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return null;
  }

  const raw = String(value).trim();
  if (raw.length > 4000) {
    throw new Error("Weather payload is too large.");
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = { summary: raw };
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    payload = { value: payload };
  }

  return JSON.stringify(payload);
}

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

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "-");
    cb(null, `${Date.now()}-${safeName}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_VIDEO_FILE_SIZE_BYTES
  },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("video/")) {
      return cb(new Error("Only continuous video uploads are allowed."));
    }

    return cb(null, true);
  }
});

const router = Router();

function runUpload(req, res) {
  return new Promise((resolve, reject) => {
    upload.single("media")(req, res, (err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

router.post("/submissions", async (req, res, next) => {
  try {
    cleanupRateBuckets();

    const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim()
      || req.ip
      || req.socket?.remoteAddress
      || "unknown";
    const rateKey = `ip:${ip}`;
    if (!takeSubmissionToken(rateKey)) {
      submissionRateLimitedCount += 1;
      const retryAfterSeconds = Math.ceil(SUBMISSION_RATE_LIMIT_WINDOW_MS / 1000);
      res.setHeader("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({ error: "Too many submission attempts. Please wait before trying again." });
    }

    await runUpload(req, res);

    const {
      name,
      email,
      paymentId,
      challengeCode,
      species,
      catchLocation,
      catchLatitude,
      catchLongitude,
      catchWeather,
      caughtAt,
      claimedWeight,
      claimedWeightUnit,
      codeVisible,
      measurementClear,
      correctSpecies,
      continuousVideo,
      fullFishInFrame,
      environmentVisible
    } = req.body;
    const numericClaimedWeight = Number(claimedWeight);
    const normalizedWeightUnit = claimedWeightUnit?.trim().toLowerCase();
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const normalizedChallengeCode = String(challengeCode || "").trim().toUpperCase();
    const normalizedName = String(name || "").trim();
    const normalizedSpecies = String(species || "").trim();
    const normalizedCatchLocation = normalizeOptionalText(catchLocation, 140);
    const numericCatchLatitude = parseOptionalCoordinate(catchLatitude, -90, 90, "Catch latitude");
    const numericCatchLongitude = parseOptionalCoordinate(catchLongitude, -180, 180, "Catch longitude");
    const normalizedCatchWeatherJson = parseOptionalWeatherJson(catchWeather);
    const normalizedCaughtAt = parseOptionalCaughtAt(caughtAt);

    if ((numericCatchLatitude === null) !== (numericCatchLongitude === null)) {
      return res.status(400).json({ error: "Catch latitude and longitude must both be provided." });
    }

    if (!normalizedName || !normalizedEmail || !paymentId?.trim() || !normalizedChallengeCode || !normalizedSpecies) {
      return res.status(400).json({ error: "All fields are required." });
    }

    if (normalizedName.length < 2 || normalizedName.length > 80) {
      return res.status(400).json({ error: "Name must be between 2 and 80 characters." });
    }

    if (!EMAIL_PATTERN.test(normalizedEmail) || normalizedEmail.length > 120) {
      return res.status(400).json({ error: "Email is invalid." });
    }

    if (!CHALLENGE_CODE_PATTERN.test(normalizedChallengeCode)) {
      return res.status(400).json({ error: "Challenge code format is invalid." });
    }

    if (normalizedSpecies.length < 2 || normalizedSpecies.length > 60) {
      return res.status(400).json({ error: "Species must be between 2 and 60 characters." });
    }

    if (!Number.isFinite(numericClaimedWeight) || numericClaimedWeight <= 0) {
      return res.status(400).json({ error: "Claimed weight must be a positive number." });
    }

    if (!["lb", "kg"].includes(normalizedWeightUnit)) {
      return res.status(400).json({ error: "Claimed weight unit must be lb or kg." });
    }

    if (!req.file) {
      return res.status(400).json({ error: "Continuous video upload is required." });
    }

    const attestations = [
      codeVisible,
      measurementClear,
      correctSpecies,
      continuousVideo,
      fullFishInFrame,
      environmentVisible
    ];

    if (!attestations.every((value) => value === "on" || value === "true")) {
      return res.status(400).json({ error: "All video verification requirements must be confirmed." });
    }

    const db = await getDb();
    const challenge = await db.get("SELECT status, closes_at FROM challenge_settings WHERE id = 1");
    const now = Date.now();
    const closesAtMs = challenge?.closes_at ? new Date(challenge.closes_at).getTime() : null;
    const challengeClosed =
      challenge?.status !== "active" || (Number.isFinite(closesAtMs) && closesAtMs > 0 && now > closesAtMs);
    if (challengeClosed) {
      return res.status(409).json({ error: "Challenge is closed. Submission codes are no longer valid." });
    }

    const participant = await db.get(
      `SELECT
        participants.id,
        participants.user_id,
        participants.challenge_code,
        participants.email,
        users.email_verified_at,
        checkout_sessions.id AS checkout_id,
        checkout_sessions.stripe_session_id,
        checkout_sessions.status AS checkout_status
      FROM participants
      JOIN checkout_sessions ON checkout_sessions.participant_id = participants.id
      LEFT JOIN users ON users.id = participants.user_id
      WHERE participants.challenge_code = ?
        AND lower(participants.email) = lower(?)
        AND checkout_sessions.status = 'paid'
        AND (checkout_sessions.stripe_session_id = ? OR CAST(checkout_sessions.id AS TEXT) = ?)
      ORDER BY checkout_sessions.created_at DESC
      LIMIT 1`,
      normalizedChallengeCode,
      normalizedEmail,
      paymentId.trim(),
      paymentId.trim()
    );

    if (!participant) {
      return res.status(400).json({ error: "Payment ID, email, and challenge code must all match a paid entry." });
    }

    if (participant.user_id && !participant.email_verified_at) {
      return res.status(403).json({ error: "Verify your email before submitting your catch." });
    }

    const existingSubmission = await db.get(
      "SELECT id FROM submissions WHERE participant_id = ? LIMIT 1",
      participant.id
    );
    if (existingSubmission) {
      return res.status(409).json({ error: "This challenge code has already been used for a submission." });
    }

    const mediaPath = `/uploads/${req.file.filename}`;
    const userAgent = String(req.headers["user-agent"] || "");
    const forwardedFor = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    const uploaderIp = forwardedFor || req.ip || req.socket?.remoteAddress || "";
    const deviceType = detectDeviceType(userAgent);
    const mediaExpiresAt = new Date(Date.now() + MEDIA_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const receiptCode = createReceiptCode();

    const result = await db.run(
      `INSERT INTO submissions
        (participant_id, species, length, claimed_length, claimed_weight, claimed_weight_unit,
         catch_location, catch_latitude, catch_longitude, catch_weather_json, caught_at, media_path,
         media_file_size_bytes, media_mime_type, media_original_name, uploader_user_agent, uploader_device_type,
         uploader_ip, media_expires_at, receipt_code)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      participant.id,
      normalizedSpecies,
      0,
      null,
      numericClaimedWeight,
      normalizedWeightUnit,
      normalizedCatchLocation,
      numericCatchLatitude,
      numericCatchLongitude,
      normalizedCatchWeatherJson,
      normalizedCaughtAt,
      mediaPath,
      req.file.size,
      req.file.mimetype,
      req.file.originalname,
      userAgent,
      deviceType,
      uploaderIp,
      mediaExpiresAt,
      receiptCode
    );

    const savedSubmission = await db.get(
      `SELECT id, status, created_at, receipt_code, media_file_size_bytes, uploader_device_type, media_expires_at,
              catch_location, catch_latitude, catch_longitude, catch_weather_json, caught_at
       FROM submissions
       WHERE id = ?`,
      result.lastID
    );

    await db.run("UPDATE participants SET name = ?, email = ? WHERE id = ?", normalizedName, normalizedEmail, participant.id);

    await queueTransactionalEmail(db, {
      userId: null,
      email: normalizedEmail,
      subject: "Submission received",
      body: `We received your submission for ${normalizedChallengeCode}. Receipt: ${receiptCode}.`,
      emailType: "submission_received",
      relatedRef: receiptCode
    });

    return res.status(201).json({
      submissionId: savedSubmission.id,
      status: savedSubmission.status,
      receiptCode: savedSubmission.receipt_code,
      receivedAt: savedSubmission.created_at,
      metadata: {
        fileSizeBytes: Number(savedSubmission.media_file_size_bytes || 0),
        uploaderDeviceType: savedSubmission.uploader_device_type || "unknown"
      },
      catchContext: {
        location: savedSubmission.catch_location || null,
        latitude: savedSubmission.catch_latitude ?? null,
        longitude: savedSubmission.catch_longitude ?? null,
        weather: safeParseWeather(savedSubmission.catch_weather_json),
        caughtAt: savedSubmission.caught_at || savedSubmission.created_at
      },
      storage: {
        location: "private",
        mediaPath: "private",
        retainedUntil: savedSubmission.media_expires_at,
        retentionDays: MEDIA_RETENTION_DAYS
      }
    });
  } catch (err) {
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({
        error: `Video file is too large. Maximum allowed size is ${Math.floor(MAX_VIDEO_FILE_SIZE_BYTES / (1024 * 1024))}MB.`
      });
    }

    if (String(err?.message || "").includes("Only continuous video uploads are allowed.")) {
      return res.status(400).json({ error: "Only continuous video uploads are allowed." });
    }

    if (
      String(err?.message || "").includes("Text value exceeds maximum length")
      || String(err?.message || "").includes("latitude")
      || String(err?.message || "").includes("longitude")
      || String(err?.message || "").includes("Caught-at date is invalid")
      || String(err?.message || "").includes("Weather payload is too large")
    ) {
      return res.status(400).json({ error: err.message });
    }

    next(err);
  }
});

export default router;
