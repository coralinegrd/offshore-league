import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = process.env.OFFSHORE_DB_PATH || path.join(__dirname, "offshore-league.sqlite");

let db;

export async function getDb() {
  if (!db) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const sqlite = new Database(dbPath);
    sqlite.pragma("foreign_keys = ON");

    db = {
      exec(sql) {
        return sqlite.exec(sql);
      },
      get(sql, ...params) {
        return sqlite.prepare(sql).get(...params);
      },
      all(sql, ...params) {
        return sqlite.prepare(sql).all(...params);
      },
      run(sql, ...params) {
        const result = sqlite.prepare(sql).run(...params);
        return {
          lastID: Number(result.lastInsertRowid),
          changes: result.changes
        };
      }
    };
  }

  return db;
}

export async function initializeDatabase() {
  const database = await getDb();

  const challengeSettingsTableSql = await database.get(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'challenge_settings'"
  );
  const needsChallengeSettingsMigration =
    challengeSettingsTableSql?.sql &&
    challengeSettingsTableSql.sql.includes("CHECK(status IN ('active', 'cancelled'))");

  if (needsChallengeSettingsMigration) {
    await database.exec(`
      ALTER TABLE challenge_settings RENAME TO challenge_settings_legacy;

      CREATE TABLE challenge_settings (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        title TEXT NOT NULL,
        location TEXT NOT NULL,
        species TEXT NOT NULL,
        entry_fee INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('draft', 'active', 'paused', 'closed', 'cancelled')),
        closes_at TEXT,
        cancellation_reason TEXT,
        cancelled_at TEXT,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO challenge_settings (id, title, location, species, entry_fee, status, closes_at, cancellation_reason, cancelled_at, updated_at)
      SELECT id, title, location, species, entry_fee, status, closes_at, cancellation_reason, cancelled_at, updated_at
      FROM challenge_settings_legacy;

      DROP TABLE challenge_settings_legacy;
    `);
  }

  const checkoutTableSql = await database.get(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'checkout_sessions'"
  );
  const needsCheckoutMigration =
    checkoutTableSql?.sql &&
    checkoutTableSql.sql.includes("CHECK(status IN ('pending', 'paid'))");

  if (needsCheckoutMigration) {
    await database.exec(`
      ALTER TABLE checkout_sessions RENAME TO checkout_sessions_legacy;

      CREATE TABLE checkout_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        stripe_session_id TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'paid', 'failed', 'refunded')),
        participant_id INTEGER,
        payment_intent_id TEXT,
        failure_reason TEXT,
        refund_id TEXT,
        refund_status TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        paid_at TEXT,
        refunded_at TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (participant_id) REFERENCES participants(id)
      );

      INSERT INTO checkout_sessions (id, user_id, stripe_session_id, status, participant_id, created_at, paid_at)
      SELECT id, user_id, stripe_session_id, status, participant_id, created_at, paid_at
      FROM checkout_sessions_legacy;

      DROP TABLE checkout_sessions_legacy;
    `);
  }

  await database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supabase_user_id TEXT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      email_verified_at TEXT,
      avatar_url TEXT,
      address TEXT,
      location TEXT,
      payout_method_type TEXT,
      payout_method_details TEXT,
      notify_challenge_closing INTEGER NOT NULL DEFAULT 1,
      notify_submission_reviewed INTEGER NOT NULL DEFAULT 1,
      notify_new_regional_challenges INTEGER NOT NULL DEFAULT 1,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS terms_acceptances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      terms_version TEXT NOT NULL,
      accepted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      request_ip TEXT,
      user_agent TEXT,
      source TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS login_magic_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      requested_ip TEXT,
      user_agent TEXT,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS participants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      challenge_id INTEGER,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      challenge_code TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (challenge_id) REFERENCES challenges(id)
    );

    CREATE TABLE IF NOT EXISTS checkout_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      stripe_session_id TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'paid', 'failed', 'refunded')),
      challenge_id INTEGER,
      participant_id INTEGER,
      payment_intent_id TEXT,
      failure_reason TEXT,
      refund_id TEXT,
      refund_status TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      paid_at TEXT,
      refunded_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (challenge_id) REFERENCES challenges(id),
      FOREIGN KEY (participant_id) REFERENCES participants(id)
    );

    CREATE TABLE IF NOT EXISTS notification_emails (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      email_to TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      email_type TEXT NOT NULL,
      related_ref TEXT,
      status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued', 'sent', 'failed')),
      failure_reason TEXT,
      provider_message_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      sent_at TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS payout_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      submission_id INTEGER NOT NULL UNIQUE,
      participant_id INTEGER NOT NULL,
      user_id INTEGER,
      challenge_code TEXT NOT NULL,
      challenge_title TEXT NOT NULL,
      amount REAL NOT NULL,
      payout_method_type TEXT,
      payout_method_details TEXT,
      status TEXT NOT NULL DEFAULT 'paid' CHECK(status IN ('paid', 'failed')),
      paid_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (submission_id) REFERENCES submissions(id),
      FOREIGN KEY (participant_id) REFERENCES participants(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS challenge_settings (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      title TEXT NOT NULL,
      location TEXT NOT NULL,
      species TEXT NOT NULL,
      entry_fee INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('draft', 'active', 'paused', 'closed', 'cancelled')),
      closes_at TEXT,
      cancellation_reason TEXT,
      cancelled_at TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS challenges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      location TEXT NOT NULL,
      species TEXT NOT NULL,
      entry_fee INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('draft', 'active', 'paused', 'closed', 'cancelled')),
      closes_at TEXT,
      cancellation_reason TEXT,
      started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      ended_at TEXT,
      archived_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS participant_flags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      participant_id INTEGER NOT NULL,
      flag_type TEXT NOT NULL,
      notes TEXT,
      created_by TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'resolved')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      resolved_at TEXT,
      FOREIGN KEY (participant_id) REFERENCES participants(id)
    );

    CREATE TABLE IF NOT EXISTS submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      participant_id INTEGER NOT NULL,
      species TEXT NOT NULL,
      length REAL DEFAULT 0,
      claimed_length REAL,
      verified_length REAL,
      claimed_weight REAL,
      claimed_weight_unit TEXT,
      catch_location TEXT,
      catch_latitude REAL,
      catch_longitude REAL,
      catch_weather_json TEXT,
      caught_at TEXT,
      media_path TEXT NOT NULL,
      media_file_size_bytes INTEGER,
      media_mime_type TEXT,
      media_original_name TEXT,
      uploader_user_agent TEXT,
      uploader_device_type TEXT,
      uploader_ip TEXT,
      media_expires_at TEXT,
      receipt_code TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
      rejection_reason TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (participant_id) REFERENCES participants(id)
    );

    CREATE TABLE IF NOT EXISTS submission_status_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      submission_id INTEGER NOT NULL,
      previous_status TEXT,
      new_status TEXT NOT NULL,
      rejection_reason TEXT,
      verified_length REAL,
      reviewed_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (submission_id) REFERENCES submissions(id)
    );
  `);

  await database.run(
    `INSERT OR IGNORE INTO challenge_settings
      (id, title, location, species, entry_fee, status)
     VALUES (1, 'Tampa Mahi-Mahi Challenge', 'Tampa', 'Mahi-Mahi', 30, 'active')`
  );

  const challengeSettingColumns = await database.all("PRAGMA table_info(challenge_settings)");
  const hasClosesAt = challengeSettingColumns.some((column) => column.name === "closes_at");
  if (!hasClosesAt) {
    await database.run("ALTER TABLE challenge_settings ADD COLUMN closes_at TEXT");
  }
  await database.run(
    "UPDATE challenge_settings SET closes_at = COALESCE(closes_at, datetime('now', '+72 hours')) WHERE id = 1"
  );

  const participantColumns = await database.all("PRAGMA table_info(participants)");
  const hasUserId = participantColumns.some((column) => column.name === "user_id");
  const hasChallengeId = participantColumns.some((column) => column.name === "challenge_id");
  if (!hasUserId) {
    await database.run("ALTER TABLE participants ADD COLUMN user_id INTEGER");
  }

  if (!hasChallengeId) {
    await database.run("ALTER TABLE participants ADD COLUMN challenge_id INTEGER");
  }

  const currentChallengeSettings = await database.get(
    "SELECT title, location, species, entry_fee, status, closes_at, cancellation_reason FROM challenge_settings WHERE id = 1"
  );
  const currentChallengeRecord = await database.get(
    "SELECT id FROM challenges WHERE archived_at IS NULL ORDER BY id DESC LIMIT 1"
  );

  if (!currentChallengeRecord && currentChallengeSettings) {
    await database.run(
      `INSERT INTO challenges
        (title, location, species, entry_fee, status, closes_at, cancellation_reason, started_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      currentChallengeSettings.title,
      currentChallengeSettings.location,
      currentChallengeSettings.species,
      currentChallengeSettings.entry_fee,
      currentChallengeSettings.status,
      currentChallengeSettings.closes_at,
      currentChallengeSettings.cancellation_reason
    );
  }

  const activeChallenge = await database.get(
    "SELECT id FROM challenges WHERE archived_at IS NULL ORDER BY id DESC LIMIT 1"
  );
  if (activeChallenge?.id) {
    await database.run("UPDATE participants SET challenge_id = ? WHERE challenge_id IS NULL", activeChallenge.id);
  }

  const userColumns = await database.all("PRAGMA table_info(users)");
  const hasSupabaseUserId = userColumns.some((column) => column.name === "supabase_user_id");
  const hasAvatarUrl = userColumns.some((column) => column.name === "avatar_url");
  const hasEmailVerifiedAt = userColumns.some((column) => column.name === "email_verified_at");
  const hasAddress = userColumns.some((column) => column.name === "address");
  const hasLocation = userColumns.some((column) => column.name === "location");
  const hasPayoutMethodType = userColumns.some((column) => column.name === "payout_method_type");
  const hasPayoutMethodDetails = userColumns.some((column) => column.name === "payout_method_details");
  const hasNotifyChallengeClosing = userColumns.some((column) => column.name === "notify_challenge_closing");
  const hasNotifySubmissionReviewed = userColumns.some((column) => column.name === "notify_submission_reviewed");
  const hasNotifyNewRegionalChallenges = userColumns.some((column) => column.name === "notify_new_regional_challenges");
  if (!hasSupabaseUserId) {
    await database.run("ALTER TABLE users ADD COLUMN supabase_user_id TEXT");
  }

  if (!hasAvatarUrl) {
    await database.run("ALTER TABLE users ADD COLUMN avatar_url TEXT");
  }

  if (!hasEmailVerifiedAt) {
    await database.run("ALTER TABLE users ADD COLUMN email_verified_at TEXT");
  }

  await database.run("UPDATE users SET email_verified_at = COALESCE(email_verified_at, created_at)");

  if (!hasAddress) {
    await database.run("ALTER TABLE users ADD COLUMN address TEXT");
  }

  if (!hasLocation) {
    await database.run("ALTER TABLE users ADD COLUMN location TEXT");
  }

  if (!hasPayoutMethodType) {
    await database.run("ALTER TABLE users ADD COLUMN payout_method_type TEXT");
  }

  if (!hasPayoutMethodDetails) {
    await database.run("ALTER TABLE users ADD COLUMN payout_method_details TEXT");
  }

  if (!hasNotifyChallengeClosing) {
    await database.run("ALTER TABLE users ADD COLUMN notify_challenge_closing INTEGER NOT NULL DEFAULT 1");
  }

  if (!hasNotifySubmissionReviewed) {
    await database.run("ALTER TABLE users ADD COLUMN notify_submission_reviewed INTEGER NOT NULL DEFAULT 1");
  }

  if (!hasNotifyNewRegionalChallenges) {
    await database.run("ALTER TABLE users ADD COLUMN notify_new_regional_challenges INTEGER NOT NULL DEFAULT 1");
  }

  const notificationColumns = await database.all("PRAGMA table_info(notification_emails)");
  const hasEmailFailureReason = notificationColumns.some((column) => column.name === "failure_reason");
  const hasEmailProviderMessageId = notificationColumns.some((column) => column.name === "provider_message_id");
  const hasEmailUpdatedAt = notificationColumns.some((column) => column.name === "updated_at");

  if (!hasEmailFailureReason) {
    await database.run("ALTER TABLE notification_emails ADD COLUMN failure_reason TEXT");
  }

  if (!hasEmailProviderMessageId) {
    await database.run("ALTER TABLE notification_emails ADD COLUMN provider_message_id TEXT");
  }

  if (!hasEmailUpdatedAt) {
    await database.run("ALTER TABLE notification_emails ADD COLUMN updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP");
  }

  const submissionColumns = await database.all("PRAGMA table_info(submissions)");
  const hasClaimedLength = submissionColumns.some((column) => column.name === "claimed_length");
  const hasVerifiedLength = submissionColumns.some((column) => column.name === "verified_length");
  const hasClaimedWeight = submissionColumns.some((column) => column.name === "claimed_weight");
  const hasClaimedWeightUnit = submissionColumns.some((column) => column.name === "claimed_weight_unit");
  const hasMediaFileSizeBytes = submissionColumns.some((column) => column.name === "media_file_size_bytes");
  const hasMediaMimeType = submissionColumns.some((column) => column.name === "media_mime_type");
  const hasMediaOriginalName = submissionColumns.some((column) => column.name === "media_original_name");
  const hasUploaderUserAgent = submissionColumns.some((column) => column.name === "uploader_user_agent");
  const hasUploaderDeviceType = submissionColumns.some((column) => column.name === "uploader_device_type");
  const hasUploaderIp = submissionColumns.some((column) => column.name === "uploader_ip");
  const hasMediaExpiresAt = submissionColumns.some((column) => column.name === "media_expires_at");
  const hasReceiptCode = submissionColumns.some((column) => column.name === "receipt_code");
  const hasCatchLocation = submissionColumns.some((column) => column.name === "catch_location");
  const hasCatchLatitude = submissionColumns.some((column) => column.name === "catch_latitude");
  const hasCatchLongitude = submissionColumns.some((column) => column.name === "catch_longitude");
  const hasCatchWeatherJson = submissionColumns.some((column) => column.name === "catch_weather_json");
  const hasCaughtAt = submissionColumns.some((column) => column.name === "caught_at");

  if (!hasClaimedLength) {
    await database.run("ALTER TABLE submissions ADD COLUMN claimed_length REAL");
    await database.run("UPDATE submissions SET claimed_length = length WHERE claimed_length IS NULL");
  }

  if (!hasVerifiedLength) {
    await database.run("ALTER TABLE submissions ADD COLUMN verified_length REAL");
  }

  if (!hasClaimedWeight) {
    await database.run("ALTER TABLE submissions ADD COLUMN claimed_weight REAL");
  }

  if (!hasClaimedWeightUnit) {
    await database.run("ALTER TABLE submissions ADD COLUMN claimed_weight_unit TEXT");
  }

  if (!hasMediaFileSizeBytes) {
    await database.run("ALTER TABLE submissions ADD COLUMN media_file_size_bytes INTEGER");
  }

  if (!hasMediaMimeType) {
    await database.run("ALTER TABLE submissions ADD COLUMN media_mime_type TEXT");
  }

  if (!hasMediaOriginalName) {
    await database.run("ALTER TABLE submissions ADD COLUMN media_original_name TEXT");
  }

  if (!hasUploaderUserAgent) {
    await database.run("ALTER TABLE submissions ADD COLUMN uploader_user_agent TEXT");
  }

  if (!hasUploaderDeviceType) {
    await database.run("ALTER TABLE submissions ADD COLUMN uploader_device_type TEXT");
  }

  if (!hasUploaderIp) {
    await database.run("ALTER TABLE submissions ADD COLUMN uploader_ip TEXT");
  }

  if (!hasMediaExpiresAt) {
    await database.run("ALTER TABLE submissions ADD COLUMN media_expires_at TEXT");
  }

  if (!hasReceiptCode) {
    await database.run("ALTER TABLE submissions ADD COLUMN receipt_code TEXT");
  }

  if (!hasCatchLocation) {
    await database.run("ALTER TABLE submissions ADD COLUMN catch_location TEXT");
  }

  if (!hasCatchLatitude) {
    await database.run("ALTER TABLE submissions ADD COLUMN catch_latitude REAL");
  }

  if (!hasCatchLongitude) {
    await database.run("ALTER TABLE submissions ADD COLUMN catch_longitude REAL");
  }

  if (!hasCatchWeatherJson) {
    await database.run("ALTER TABLE submissions ADD COLUMN catch_weather_json TEXT");
  }

  if (!hasCaughtAt) {
    await database.run("ALTER TABLE submissions ADD COLUMN caught_at TEXT");
    await database.run("UPDATE submissions SET caught_at = created_at WHERE caught_at IS NULL");
  }

  const checkoutColumns = await database.all("PRAGMA table_info(checkout_sessions)");
  const hasPaymentIntentId = checkoutColumns.some((column) => column.name === "payment_intent_id");
  const hasCheckoutChallengeId = checkoutColumns.some((column) => column.name === "challenge_id");
  const hasFailureReason = checkoutColumns.some((column) => column.name === "failure_reason");
  const hasRefundId = checkoutColumns.some((column) => column.name === "refund_id");
  const hasRefundStatus = checkoutColumns.some((column) => column.name === "refund_status");
  const hasRefundedAt = checkoutColumns.some((column) => column.name === "refunded_at");

  if (!hasPaymentIntentId) {
    await database.run("ALTER TABLE checkout_sessions ADD COLUMN payment_intent_id TEXT");
  }
  if (!hasCheckoutChallengeId) {
    await database.run("ALTER TABLE checkout_sessions ADD COLUMN challenge_id INTEGER");
  }
  if (!hasFailureReason) {
    await database.run("ALTER TABLE checkout_sessions ADD COLUMN failure_reason TEXT");
  }
  if (!hasRefundId) {
    await database.run("ALTER TABLE checkout_sessions ADD COLUMN refund_id TEXT");
  }
  if (!hasRefundStatus) {
    await database.run("ALTER TABLE checkout_sessions ADD COLUMN refund_status TEXT");
  }
  if (!hasRefundedAt) {
    await database.run("ALTER TABLE checkout_sessions ADD COLUMN refunded_at TEXT");
  }

  await database.run(
    `UPDATE checkout_sessions
     SET challenge_id = (
       SELECT participants.challenge_id
       FROM participants
       WHERE participants.id = checkout_sessions.participant_id
     )
     WHERE challenge_id IS NULL
       AND participant_id IS NOT NULL`
  );

  // Normalize legacy duplicates before creating strict uniqueness indexes.
  await database.exec(
    `WITH ranked AS (
       SELECT
         id,
         ROW_NUMBER() OVER (
           PARTITION BY user_id, challenge_id
           ORDER BY datetime(created_at) DESC, id DESC
         ) AS rn
       FROM participants
       WHERE user_id IS NOT NULL AND challenge_id IS NOT NULL
     )
     UPDATE participants
     SET user_id = NULL
     WHERE id IN (SELECT id FROM ranked WHERE rn > 1)`
  );

  await database.exec(
    `WITH ranked AS (
       SELECT
         id,
         status,
         ROW_NUMBER() OVER (
           PARTITION BY user_id, challenge_id
           ORDER BY
             CASE status
               WHEN 'paid' THEN 0
               WHEN 'refunded' THEN 1
               WHEN 'pending' THEN 2
               ELSE 3
             END,
             datetime(COALESCE(paid_at, refunded_at, created_at)) DESC,
             id DESC
         ) AS rn
       FROM checkout_sessions
       WHERE user_id IS NOT NULL
         AND challenge_id IS NOT NULL
         AND status IN ('pending', 'paid', 'refunded')
     )
     UPDATE checkout_sessions
     SET status = 'failed',
         failure_reason = COALESCE(failure_reason, 'Superseded by uniqueness migration')
     WHERE id IN (SELECT id FROM ranked WHERE rn > 1)`
  );

  await database.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_participants_unique_user_challenge
     ON participants(user_id, challenge_id)
     WHERE user_id IS NOT NULL AND challenge_id IS NOT NULL`
  );

  await database.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_checkout_unique_user_challenge_open
     ON checkout_sessions(user_id, challenge_id)
     WHERE challenge_id IS NOT NULL AND status IN ('pending', 'paid', 'refunded')`
  );

  await database.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_terms_acceptances_user_version
     ON terms_acceptances(user_id, terms_version)`
  );

  await database.exec(
    `CREATE INDEX IF NOT EXISTS idx_login_magic_links_user_expires
     ON login_magic_links(user_id, expires_at)`
  );
}
