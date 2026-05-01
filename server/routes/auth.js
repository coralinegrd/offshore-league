import crypto from "node:crypto";
import { Router } from "express";
import { getDb } from "../db/database.js";
import { isSupabaseConfigured, supabaseAdmin, supabaseAuth } from "../lib/supabase.js";
import { queueTransactionalEmail } from "../lib/notifications.js";

const router = Router();
const TERMS_VERSION = process.env.TERMS_VERSION || "2026-05-01";
const MAGIC_LINK_TTL_MINUTES = Number(process.env.MAGIC_LINK_TTL_MINUTES || 20);

function getAdminEmailSet() {
  const raw = process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || "";
  return new Set(
    raw
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean)
  );
}

function isAdminEmail(email) {
  if (!email) return false;
  const adminEmails = getAdminEmailSet();
  if (adminEmails.size === 0) return false;
  return adminEmails.has(String(email).trim().toLowerCase());
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [salt, hash] = storedHash.split(":");
  const candidate = hashPassword(password, salt).split(":")[1];
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(candidate, "hex"));
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function getRequesterIp(req) {
  return String(req.headers["x-forwarded-for"] || "").split(",")[0].trim()
    || req.ip
    || req.socket?.remoteAddress
    || "";
}

async function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString("hex");
  await db.run("INSERT INTO sessions (user_id, token) VALUES (?, ?)", userId, token);
  return token;
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: Boolean(user.email_verified_at),
    avatarUrl: user.avatar_url || "",
    address: user.address || "",
    location: user.location || "",
    payoutMethodType: user.payout_method_type || "",
    payoutMethodDetails: user.payout_method_details || "",
    isAdmin: isAdminEmail(user.email),
    notifications: {
      challengeClosing: Boolean(user.notify_challenge_closing),
      submissionReviewed: Boolean(user.notify_submission_reviewed),
      newRegionalChallenges: Boolean(user.notify_new_regional_challenges)
    }
  };
}

async function createLocalUser({ name, email, password, supabaseUserId = null, emailVerifiedAt = null }) {
  const db = await getDb();
  const result = await db.run(
    "INSERT INTO users (supabase_user_id, name, email, password_hash, email_verified_at) VALUES (?, ?, ?, ?, ?)",
    supabaseUserId,
    name.trim(),
    email.trim().toLowerCase(),
    hashPassword(password),
    emailVerifiedAt
  );

  return {
    id: result.lastID,
    supabase_user_id: supabaseUserId,
    name: name.trim(),
    email: email.trim().toLowerCase(),
    email_verified_at: emailVerifiedAt,
    avatar_url: "",
    address: "",
    location: "",
    payout_method_type: "",
    payout_method_details: "",
    notify_challenge_closing: 1,
    notify_submission_reviewed: 1,
    notify_new_regional_challenges: 1
  };
}

export async function getUserFromRequest(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (!token) return null;

  const db = await getDb();
  return db.get(
    `SELECT users.id, users.name, users.email, users.email_verified_at, users.avatar_url, users.address, users.location, users.payout_method_type, users.payout_method_details,
            users.notify_challenge_closing, users.notify_submission_reviewed, users.notify_new_regional_challenges
     FROM sessions
     JOIN users ON users.id = sessions.user_id
     WHERE sessions.token = ?`,
    token
  );
}

export async function requireUser(req, res, next) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: "Create an account or log in before checkout." });
    req.user = user;
    return next();
  } catch (err) {
    return next(err);
  }
}

export async function requireAdmin(req, res, next) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: "Log in required." });

    if (!isAdminEmail(user.email)) {
      return res.status(403).json({ error: "Admin access only." });
    }

    req.user = user;
    return next();
  } catch (err) {
    return next(err);
  }
}

router.post("/auth/register", async (req, res, next) => {
  try {
    const { name, email, password, confirmPassword } = req.body;

    if (!name?.trim() || !email?.trim() || !password || password.length < 8) {
      return res.status(400).json({ error: "Name, email, and an 8+ character password are required." });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ error: "Passwords do not match." });
    }

    const db = await getDb();
    const normalizedEmail = email.trim().toLowerCase();
    const existing = await db.get("SELECT id FROM users WHERE email = ?", normalizedEmail);

    if (existing) {
      return res.status(409).json({ error: "An account already exists for this email." });
    }

    let user;

    if (isSupabaseConfigured) {
      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email: normalizedEmail,
        password,
        email_confirm: true,
        user_metadata: {
          name: name.trim()
        }
      });

      if (error) {
        return res.status(400).json({ error: error.message });
      }

      user = await createLocalUser({
        name,
        email: normalizedEmail,
        password,
        supabaseUserId: data.user.id,
        emailVerifiedAt: data.user.email_confirmed_at || new Date().toISOString()
      });
    } else {
      user = await createLocalUser({
        name,
        email: normalizedEmail,
        password,
        emailVerifiedAt: new Date().toISOString()
      });
    }

    const token = await createSession(db, user.id);

    return res.status(201).json({
      token,
      user: publicUser(user)
    });
  } catch (err) {
    return next(err);
  }
});

router.post("/auth/login", async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email?.trim() || !password) {
      return res.status(400).json({ error: "Email and password are required." });
    }

    const db = await getDb();
    const user = await db.get("SELECT * FROM users WHERE email = ?", email.trim().toLowerCase());

    if (isSupabaseConfigured) {
      const { data, error } = await supabaseAuth.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password
      });

      if (error) {
        return res.status(401).json({ error: "Invalid email or password." });
      }

      await db.run(
        "UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?",
        data.user?.email_confirmed_at || new Date().toISOString(),
        user?.id || null
      );
    } else if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    if (!user) {
      return res.status(401).json({ error: "Account record not found." });
    }

    const token = await createSession(db, user.id);
    return res.json({ token, user: publicUser(user) });
  } catch (err) {
    return next(err);
  }
});

router.post("/auth/magic-link/request", async (req, res, next) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!email) {
      return res.status(400).json({ error: "Email is required." });
    }

    const db = await getDb();
    const user = await db.get("SELECT id, email, name FROM users WHERE email = ?", email);

    // Avoid account enumeration: always return success payload.
    if (!user) {
      return res.json({ ok: true, message: "If an account exists, a login link has been sent." });
    }

    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = sha256(token);
    const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_MINUTES * 60 * 1000).toISOString();

    await db.run(
      `INSERT INTO login_magic_links
        (user_id, token_hash, expires_at, requested_ip, user_agent)
       VALUES (?, ?, ?, ?, ?)`,
      user.id,
      tokenHash,
      expiresAt,
      getRequesterIp(req),
      String(req.headers["user-agent"] || "")
    );

    const clientUrl = process.env.CLIENT_URL || "http://localhost:5173";
    const loginUrl = `${clientUrl}/auth?magicToken=${encodeURIComponent(token)}`;
    await queueTransactionalEmail(db, {
      userId: user.id,
      email: user.email,
      subject: "Your Offshore League login link",
      body: `Use this secure login link within ${MAGIC_LINK_TTL_MINUTES} minutes: ${loginUrl}`,
      emailType: "magic_link_login",
      relatedRef: tokenHash.slice(0, 12)
    });

    return res.json({ ok: true, message: "If an account exists, a login link has been sent." });
  } catch (err) {
    return next(err);
  }
});

router.post("/auth/magic-link/verify", async (req, res, next) => {
  try {
    const token = String(req.body?.token || "").trim();
    if (!token) {
      return res.status(400).json({ error: "Magic link token is required." });
    }

    const db = await getDb();
    const tokenHash = sha256(token);
    const nowIso = new Date().toISOString();
    const record = await db.get(
      `SELECT login_magic_links.id, login_magic_links.user_id
       FROM login_magic_links
       WHERE login_magic_links.token_hash = ?
         AND login_magic_links.used_at IS NULL
         AND login_magic_links.expires_at > ?
       LIMIT 1`,
      tokenHash,
      nowIso
    );

    if (!record) {
      return res.status(400).json({ error: "Magic link is invalid or expired." });
    }

    const user = await db.get("SELECT * FROM users WHERE id = ?", record.user_id);
    if (!user) {
      return res.status(404).json({ error: "Account not found." });
    }

    await db.run("UPDATE login_magic_links SET used_at = CURRENT_TIMESTAMP WHERE id = ?", record.id);
    await db.run(
      "UPDATE users SET email_verified_at = COALESCE(email_verified_at, CURRENT_TIMESTAMP) WHERE id = ?",
      user.id
    );

    const sessionToken = await createSession(db, user.id);
    return res.json({ token: sessionToken, user: publicUser({ ...user, email_verified_at: user.email_verified_at || nowIso }) });
  } catch (err) {
    return next(err);
  }
});

router.get("/terms/current", (req, res) => {
  return res.json({ termsVersion: TERMS_VERSION });
});

router.get("/terms/status", requireUser, async (req, res, next) => {
  try {
    const db = await getDb();
    const accepted = await db.get(
      "SELECT id, accepted_at, terms_version FROM terms_acceptances WHERE user_id = ? AND terms_version = ?",
      req.user.id,
      TERMS_VERSION
    );

    return res.json({
      termsVersion: TERMS_VERSION,
      accepted: Boolean(accepted),
      acceptedAt: accepted?.accepted_at || null
    });
  } catch (err) {
    return next(err);
  }
});

router.post("/terms/accept", requireUser, async (req, res, next) => {
  try {
    const db = await getDb();
    const requestVersion = String(req.body?.termsVersion || TERMS_VERSION).trim() || TERMS_VERSION;
    if (requestVersion !== TERMS_VERSION) {
      return res.status(400).json({ error: "Terms version is out of date. Refresh and accept current terms." });
    }

    await db.run(
      `INSERT OR IGNORE INTO terms_acceptances
        (user_id, terms_version, request_ip, user_agent, source)
       VALUES (?, ?, ?, ?, ?)`,
      req.user.id,
      TERMS_VERSION,
      getRequesterIp(req),
      String(req.headers["user-agent"] || ""),
      String(req.body?.source || "checkout")
    );

    const accepted = await db.get(
      "SELECT accepted_at FROM terms_acceptances WHERE user_id = ? AND terms_version = ?",
      req.user.id,
      TERMS_VERSION
    );

    return res.json({ accepted: true, termsVersion: TERMS_VERSION, acceptedAt: accepted?.accepted_at || null });
  } catch (err) {
    return next(err);
  }
});

router.get("/auth/me", requireUser, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

export default router;
