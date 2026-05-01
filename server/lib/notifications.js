export async function queueTransactionalEmail(db, {
  userId = null,
  email,
  subject,
  body,
  emailType,
  relatedRef = ""
}) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail || !subject || !body || !emailType) {
    throw new Error("Email, subject, body, and emailType are required.");
  }

  const inserted = await db.run(
    `INSERT INTO notification_emails
      (user_id, email_to, subject, body, email_type, related_ref, status, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'queued', CURRENT_TIMESTAMP)`,
    userId,
    normalizedEmail,
    String(subject),
    String(body),
    String(emailType),
    String(relatedRef || "")
  );

  // Local mode: store delivery history without external provider dependency.
  await db.run(
    `UPDATE notification_emails
     SET status = 'sent',
         sent_at = CURRENT_TIMESTAMP,
         failure_reason = NULL,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    inserted.lastID
  );

  return {
    id: inserted.lastID,
    status: "sent"
  };
}

export async function markEmailDeliveryStatus(db, {
  status,
  providerMessageId = "",
  email = "",
  emailType = "",
  relatedRef = "",
  failureReason = ""
}) {
  const normalizedStatus = String(status || "").trim().toLowerCase();
  if (!["sent", "failed"].includes(normalizedStatus)) {
    throw new Error("Status must be sent or failed.");
  }

  const providerId = String(providerMessageId || "").trim();
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const type = String(emailType || "").trim();
  const ref = String(relatedRef || "").trim();

  let row = null;
  if (providerId) {
    row = await db.get("SELECT id FROM notification_emails WHERE provider_message_id = ? ORDER BY id DESC LIMIT 1", providerId);
  }

  if (!row && normalizedEmail && type) {
    row = await db.get(
      `SELECT id
       FROM notification_emails
       WHERE lower(email_to) = lower(?)
         AND email_type = ?
         AND (? = '' OR related_ref = ?)
       ORDER BY id DESC
       LIMIT 1`,
      normalizedEmail,
      type,
      ref,
      ref
    );
  }

  if (!row) {
    return { updated: false };
  }

  await db.run(
    `UPDATE notification_emails
     SET status = ?,
         provider_message_id = COALESCE(NULLIF(?, ''), provider_message_id),
         failure_reason = ?,
         sent_at = CASE WHEN ? = 'sent' THEN COALESCE(sent_at, CURRENT_TIMESTAMP) ELSE sent_at END,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    normalizedStatus,
    providerId,
    normalizedStatus === "failed" ? String(failureReason || "Delivery failed") : null,
    normalizedStatus,
    row.id
  );

  return { updated: true, id: row.id };
}
