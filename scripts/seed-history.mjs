import crypto from "node:crypto";
import { getDb, initializeDatabase } from "../server/db/database.js";

const HISTORY_PASSWORD = process.env.HISTORY_DEMO_PASSWORD || "DemoPass123!";

const DEMO_IDENTITIES = [
  "Capt. Mike T.",
  "Jake R.",
  "Carlos V.",
  "David M.",
  "Marco D.",
  "Sarah M.",
  "Tom B.",
  "Ethan Cole",
  "Nico Alvarez",
  "Mateo Cruz",
  "Luca Marin",
  "Sofia Almeida",
  "Aisha Khan",
  "Noah Bennett",
  "Isla Morgan",
  "Rafael Cruz",
  "Logan Price",
  "Mason Holt",
  "Owen Reyes",
  "Liam Carter",
  "Aiden Scott",
  "Wyatt Brooks",
  "Henry Knox",
  "Levi Ward",
  "Milo James",
  "Caleb Stone"
];

const HISTORY_CHALLENGES = [
  {
    title: "Gulf Coast Weekly #1",
    location: "Tampa",
    species: "Mahi-Mahi",
    startAt: "2024-10-04T12:00:00.000Z",
    endAt: "2024-10-06T22:00:00.000Z",
    participants: 8,
    prizePool: 240,
    winner: "Capt. Mike T."
  },
  {
    title: "Halloween Mahi Challenge",
    location: "Tampa",
    species: "Mahi-Mahi",
    startAt: "2024-10-26T11:00:00.000Z",
    endAt: "2024-10-27T21:00:00.000Z",
    participants: 12,
    prizePool: 360,
    winner: "Jake R."
  },
  {
    title: "Winter Wahoo Series #1",
    location: "Tampa",
    species: "Wahoo",
    startAt: "2024-12-07T12:00:00.000Z",
    endAt: "2024-12-08T22:00:00.000Z",
    participants: 15,
    prizePool: 450,
    winner: "Carlos V."
  },
  {
    title: "Winter Wahoo Series #2",
    location: "Tampa",
    species: "Wahoo",
    startAt: "2025-01-11T12:00:00.000Z",
    endAt: "2025-01-12T22:00:00.000Z",
    participants: 14,
    prizePool: 420,
    winner: "David M."
  },
  {
    title: "Spring Sailfish Open",
    location: "Tampa",
    species: "Sailfish",
    startAt: "2025-03-15T12:00:00.000Z",
    endAt: "2025-03-16T23:00:00.000Z",
    participants: 18,
    prizePool: 1000,
    winner: "Capt. Mike T."
  },
  {
    title: "Mahi Season Opener",
    location: "Tampa",
    species: "Mahi-Mahi",
    startAt: "2025-04-26T12:00:00.000Z",
    endAt: "2025-04-27T23:00:00.000Z",
    participants: 22,
    prizePool: 1600,
    winner: "Tom B."
  },
  {
    title: "Gulf Coast Weekly #2",
    location: "Tampa",
    species: "Mahi-Mahi",
    startAt: "2025-05-03T12:00:00.000Z",
    endAt: "2025-05-04T23:00:00.000Z",
    participants: 19,
    prizePool: 1200,
    winner: "Carlos V."
  },
  {
    title: "November Sailfish Classic",
    location: "Atlantic FL",
    species: "Sailfish",
    startAt: "2025-11-01T12:00:00.000Z",
    endAt: "2025-11-02T23:00:00.000Z",
    participants: 28,
    prizePool: 1960,
    winner: "Marco D."
  },
  {
    title: "Veterans Day Wahoo Chase",
    location: "Gulf of Mexico",
    species: "Wahoo",
    startAt: "2025-11-08T12:00:00.000Z",
    endAt: "2025-11-09T23:00:00.000Z",
    participants: 26,
    prizePool: 910,
    winner: "Capt. Mike T."
  },
  {
    title: "November Offshore Open",
    location: "Atlantic FL",
    species: "Sailfish",
    startAt: "2025-11-15T12:00:00.000Z",
    endAt: "2025-11-16T23:00:00.000Z",
    participants: 29,
    prizePool: 2100,
    winner: "Jake R."
  },
  {
    title: "Thanksgiving Wahoo Sprint",
    location: "Gulf of Mexico",
    species: "Wahoo",
    startAt: "2025-11-22T12:00:00.000Z",
    endAt: "2025-11-23T23:00:00.000Z",
    participants: 27,
    prizePool: 1900,
    winner: "Sarah M."
  },
  {
    title: "Late November Slam",
    location: "Atlantic FL",
    species: "Sailfish",
    startAt: "2025-11-29T12:00:00.000Z",
    endAt: "2025-11-30T23:00:00.000Z",
    participants: 28,
    prizePool: 2000,
    winner: "Tom B."
  },
  {
    title: "December Wahoo Series #1",
    location: "Gulf of Mexico",
    species: "Wahoo",
    startAt: "2025-12-06T12:00:00.000Z",
    endAt: "2025-12-07T23:00:00.000Z",
    participants: 28,
    prizePool: 840,
    winner: "Carlos V."
  },
  {
    title: "Mid-December Sailfish Run",
    location: "Atlantic FL",
    species: "Sailfish",
    startAt: "2025-12-13T12:00:00.000Z",
    endAt: "2025-12-14T23:00:00.000Z",
    participants: 27,
    prizePool: 810,
    winner: "Marco D."
  },
  {
    title: "Christmas Wahoo Dash",
    location: "Gulf of Mexico",
    species: "Wahoo",
    startAt: "2025-12-20T12:00:00.000Z",
    endAt: "2025-12-21T23:00:00.000Z",
    participants: 26,
    prizePool: 2180,
    winner: "Capt. Mike T."
  },
  {
    title: "New Year's Offshore Finale",
    location: "Atlantic FL",
    species: "Sailfish",
    startAt: "2025-12-27T12:00:00.000Z",
    endAt: "2025-12-28T23:00:00.000Z",
    participants: 30,
    prizePool: 2500,
    winner: "Jake R."
  },
  {
    title: "January 2026 Opener",
    location: "Gulf of Mexico",
    species: "Wahoo",
    startAt: "2026-01-03T12:00:00.000Z",
    endAt: "2026-01-04T23:00:00.000Z",
    participants: 16,
    prizePool: 1200,
    winner: "Sarah M."
  },
  {
    title: "Amberjack & Wahoo Classic",
    location: "Tampa Bay, FL",
    species: "Amberjack",
    startAt: "2026-01-10T12:00:00.000Z",
    endAt: "2026-01-11T23:00:00.000Z",
    participants: 28,
    prizePool: 1200,
    winner: "Tom B."
  },
  {
    title: "Winter Offshore Open #4",
    location: "Gulf of Mexico",
    species: "Wahoo",
    startAt: "2026-01-17T12:00:00.000Z",
    endAt: "2026-01-18T23:00:00.000Z",
    participants: 31,
    prizePool: 1600,
    winner: "Carlos V."
  },
  {
    title: "January Sailfish Series",
    location: "Atlantic FL",
    species: "Sailfish",
    startAt: "2026-01-24T12:00:00.000Z",
    endAt: "2026-01-25T23:00:00.000Z",
    participants: 30,
    prizePool: 1650,
    winner: "Marco D."
  },
  {
    title: "February Wahoo Blitz",
    location: "Gulf of Mexico",
    species: "Wahoo",
    startAt: "2026-01-31T12:00:00.000Z",
    endAt: "2026-02-01T23:00:00.000Z",
    participants: 29,
    prizePool: 1550,
    winner: "Capt. Mike T."
  },
  {
    title: "Valentine's Sailfish Sprint",
    location: "Atlantic FL",
    species: "Sailfish",
    startAt: "2026-02-07T12:00:00.000Z",
    endAt: "2026-02-08T23:00:00.000Z",
    participants: 31,
    prizePool: 1085,
    winner: "Jake R."
  },
  {
    title: "Mid-February Wahoo Open",
    location: "Gulf of Mexico",
    species: "Wahoo",
    startAt: "2026-02-14T12:00:00.000Z",
    endAt: "2026-02-15T23:00:00.000Z",
    participants: 30,
    prizePool: 1200,
    winner: "Sarah M."
  },
  {
    title: "Late February Slam",
    location: "Atlantic FL",
    species: "Sailfish",
    startAt: "2026-02-21T12:00:00.000Z",
    endAt: "2026-02-22T23:00:00.000Z",
    participants: 32,
    prizePool: 1470,
    winner: "Tom B."
  },
  {
    title: "February Offshore Final",
    location: "Gulf of Mexico",
    species: "Wahoo",
    startAt: "2026-02-28T12:00:00.000Z",
    endAt: "2026-03-01T23:00:00.000Z",
    participants: 31,
    prizePool: 1290,
    winner: "Carlos V."
  },
  {
    title: "Spring 2026 Opener",
    location: "Atlantic FL",
    species: "Sailfish",
    startAt: "2026-03-07T12:00:00.000Z",
    endAt: "2026-03-08T23:00:00.000Z",
    participants: 33,
    prizePool: 3460,
    winner: "Marco D."
  },
  {
    title: "Mahi Season Preview",
    location: "Gulf of Mexico",
    species: "Mahi-Mahi",
    startAt: "2026-03-14T12:00:00.000Z",
    endAt: "2026-03-15T23:00:00.000Z",
    participants: 34,
    prizePool: 1020,
    winner: "Capt. Mike T."
  },
  {
    title: "March Offshore Classic",
    location: "Atlantic FL",
    species: "Sailfish",
    startAt: "2026-03-21T12:00:00.000Z",
    endAt: "2026-03-22T23:00:00.000Z",
    participants: 32,
    prizePool: 2400,
    winner: "Jake R."
  },
  {
    title: "Late March Mahi Charge",
    location: "Gulf of Mexico",
    species: "Mahi-Mahi",
    startAt: "2026-03-28T12:00:00.000Z",
    endAt: "2026-03-29T23:00:00.000Z",
    participants: 35,
    prizePool: 2350,
    winner: "Sarah M."
  },
  {
    title: "April Mahi Classic 2026",
    location: "Gulf of Mexico",
    species: "Mahi-Mahi",
    startAt: "2026-04-04T12:00:00.000Z",
    endAt: "2026-04-05T23:00:00.000Z",
    participants: 36,
    prizePool: 2080,
    winner: "Tom B."
  },
  {
    title: "Spring Tuna & Mahi Open",
    location: "Gulf of Mexico",
    species: "Yellowfin Tuna",
    startAt: "2026-04-11T12:00:00.000Z",
    endAt: "2026-04-12T23:00:00.000Z",
    participants: 35,
    prizePool: 1050,
    winner: "Carlos V."
  },
  {
    title: "April Offshore Slam",
    location: "Atlantic FL",
    species: "Mahi-Mahi",
    startAt: "2026-04-18T12:00:00.000Z",
    endAt: "2026-04-19T23:00:00.000Z",
    participants: 37,
    prizePool: 3500,
    winner: "Marco D."
  },
  {
    title: "Late April Mahi Blitz",
    location: "Gulf of Mexico",
    species: "Mahi-Mahi",
    startAt: "2026-04-25T12:00:00.000Z",
    endAt: "2026-04-26T23:00:00.000Z",
    participants: 38,
    prizePool: 2925,
    winner: "Capt. Mike T."
  }
];

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function slugify(input) {
  return String(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function buildParticipantList(challenge, challengeIndex) {
  const names = DEMO_IDENTITIES.filter((name) => name !== challenge.winner);
  const rotated = [];
  for (let i = 0; i < names.length; i += 1) {
    rotated.push(names[(i + challengeIndex) % names.length]);
  }

  const list = [challenge.winner, ...rotated].slice(0, challenge.participants);
  while (list.length < challenge.participants) {
    list.push(`Guest Angler ${challengeIndex + 1}-${list.length + 1}`);
  }
  return list;
}

async function upsertDemoUsers(db) {
  const passwordHash = hashPassword(HISTORY_PASSWORD);
  const userIds = new Map();

  for (const [index, name] of DEMO_IDENTITIES.entries()) {
    const emailSlug = slugify(name).replace(/\./g, "");
    const email = `history.${emailSlug}@seed.offshoreleague.test`;

    await db.run(
      `INSERT INTO users (
        name,
        email,
        password_hash,
        email_verified_at,
        is_demo,
        location,
        region,
        species_preferences
      ) VALUES (?, ?, ?, CURRENT_TIMESTAMP, 1, ?, ?, ?)
      ON CONFLICT(email) DO UPDATE SET
        name = excluded.name,
        password_hash = excluded.password_hash,
        is_demo = 1,
        location = excluded.location,
        region = excluded.region,
        species_preferences = excluded.species_preferences`,
      name,
      email,
      passwordHash,
      "Tampa",
      "Tampa",
      JSON.stringify(["Mahi-Mahi", "Wahoo", "Sailfish"])
    );

    const user = await db.get("SELECT id FROM users WHERE email = ? LIMIT 1", email);
    if (user?.id) userIds.set(name, Number(user.id));
    if (index === DEMO_IDENTITIES.length - 1) {
      // no-op to keep deterministic loop shape
    }
  }

  return userIds;
}

async function seedHistoricalChallenges() {
  await initializeDatabase();
  const db = await getDb();
  const userIds = await upsertDemoUsers(db);

  for (const [challengeIndex, challenge] of HISTORY_CHALLENGES.entries()) {
    const entryFee = Number((challenge.prizePool / challenge.participants).toFixed(2));
    const archiveAt = new Date(new Date(challenge.endAt).getTime() + 12 * 60 * 60 * 1000).toISOString();

    const existingChallenge = await db.get(
      "SELECT id FROM challenges WHERE title = ? LIMIT 1",
      challenge.title
    );

    let challengeId = Number(existingChallenge?.id || 0);
    if (!challengeId) {
      const inserted = await db.run(
        `INSERT INTO challenges (
          title,
          location,
          species,
          entry_fee,
          auto_enroll_demo,
          status,
          closes_at,
          started_at,
          ended_at,
          archived_at,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, 1, 'closed', ?, ?, ?, ?, ?, ?)`,
        challenge.title,
        challenge.location,
        challenge.species,
        entryFee,
        challenge.endAt,
        challenge.startAt,
        challenge.endAt,
        archiveAt,
        challenge.startAt,
        archiveAt
      );
      challengeId = Number(inserted.lastID);
    } else {
      await db.run(
        `UPDATE challenges
         SET location = ?,
             species = ?,
             entry_fee = ?,
             auto_enroll_demo = 1,
             status = 'closed',
             closes_at = ?,
             started_at = ?,
             ended_at = ?,
             archived_at = ?,
             updated_at = ?
         WHERE id = ?`,
        challenge.location,
        challenge.species,
        entryFee,
        challenge.endAt,
        challenge.startAt,
        challenge.endAt,
        archiveAt,
        archiveAt,
        challengeId
      );
    }

    const seededParticipants = await db.all(
      "SELECT id FROM participants WHERE challenge_id = ? AND challenge_code LIKE 'HIST-%'",
      challengeId
    );
    for (const row of seededParticipants) {
      await db.run("DELETE FROM submissions WHERE participant_id = ?", row.id);
    }
    await db.run(
      "DELETE FROM participants WHERE challenge_id = ? AND challenge_code LIKE 'HIST-%'",
      challengeId
    );

    const participantNames = buildParticipantList(challenge, challengeIndex);
    const challengeSlug = slugify(challenge.title);
    const winnerLength = 113 + challengeIndex * 1.4;

    for (const [index, participantName] of participantNames.entries()) {
      const userId = userIds.get(participantName) || null;
      const code = `HIST-${String(challengeIndex + 1).padStart(2, "0")}-${String(index + 1).padStart(2, "0")}-${String(challengeId).padStart(4, "0")}`;
      const emailSlug = slugify(participantName) || `angler-${index + 1}`;
      const participantEmail = `${challengeSlug}.${emailSlug}.${index + 1}@seed.offshoreleague.test`;

      const participantCreatedAt = new Date(
        new Date(challenge.startAt).getTime() + (index + 1) * 23 * 60 * 1000
      ).toISOString();

      const insertedParticipant = await db.run(
        `INSERT INTO participants (
          user_id,
          challenge_id,
          name,
          email,
          challenge_code,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        userId,
        challengeId,
        participantName,
        participantEmail,
        code,
        participantCreatedAt
      );

      const participantId = Number(insertedParticipant.lastID);
      const isWinner = participantName === challenge.winner;
      const verifiedLength = isWinner
        ? winnerLength
        : Number((74 + ((index * 5 + challengeIndex * 4) % 17) + index * 0.08).toFixed(2));
      const submissionCreatedAt = new Date(
        new Date(challenge.startAt).getTime() + (index + 2) * 41 * 60 * 1000
      ).toISOString();

      await db.run(
        `INSERT INTO submissions (
          participant_id,
          species,
          length,
          claimed_length,
          verified_length,
          catch_location,
          caught_at,
          media_path,
          status,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?)`,
        participantId,
        challenge.species,
        verifiedLength,
        verifiedLength,
        verifiedLength,
        challenge.location,
        submissionCreatedAt,
        `/uploads/history/${challengeSlug}-${index + 1}.jpg`,
        submissionCreatedAt
      );
    }
  }

  const seededChallengeCount = await db.get(
    "SELECT COUNT(*) AS count FROM challenges WHERE title IN (" + HISTORY_CHALLENGES.map(() => "?").join(",") + ")",
    ...HISTORY_CHALLENGES.map((item) => item.title)
  );
  const seededSubmissionCount = await db.get(
    "SELECT COUNT(*) AS count FROM submissions WHERE media_path LIKE '/uploads/history/%'"
  );

  console.log(`SEEDED_HISTORY_CHALLENGES=${Number(seededChallengeCount?.count || 0)}`);
  console.log(`SEEDED_HISTORY_SUBMISSIONS=${Number(seededSubmissionCount?.count || 0)}`);
  console.log("HISTORY_SEED_DONE=1");
}

seedHistoricalChallenges().catch((error) => {
  console.error("HISTORY_SEED_DONE=0");
  console.error(error);
  process.exit(1);
});
