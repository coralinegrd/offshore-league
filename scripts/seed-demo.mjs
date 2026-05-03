import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { getDb, initializeDatabase } from "../server/db/database.js";

const DEMO_PASSWORD = process.env.DEMO_USER_PASSWORD || "DemoPass123!";

const DEMO_PERSONAS = [
  {
    name: "Captain Maya Torres",
    email: "demo.maya@offshoreleague.test",
    avatarUrl: "https://api.dicebear.com/9.x/adventurer/svg?seed=Maya",
    bio: "Tournament captain focused on consistent mahi patterns and fast drift decisions.",
    region: "Tampa Bay, Florida",
    speciesPreferences: ["Mahi-Mahi", "Blackfin Tuna", "Kingfish"]
  },
  {
    name: "Ethan Brooks",
    email: "demo.ethan@offshoreleague.test",
    avatarUrl: "https://api.dicebear.com/9.x/adventurer/svg?seed=Ethan",
    bio: "Weekend angler who documents every trip and optimizes tackle by season.",
    region: "St. Petersburg, Florida",
    speciesPreferences: ["Mahi-Mahi", "Cobia", "Amberjack"]
  },
  {
    name: "Sofia Almeida",
    email: "demo.sofia@offshoreleague.test",
    avatarUrl: "https://api.dicebear.com/9.x/adventurer/svg?seed=Sofia",
    bio: "Bluewater enthusiast with a data-first approach to weather and bait windows.",
    region: "Nassau, Bahamas",
    speciesPreferences: ["Mahi-Mahi", "Wahoo", "Yellowfin Tuna"]
  },
  {
    name: "Luca Romano",
    email: "demo.luca@offshoreleague.test",
    avatarUrl: "https://api.dicebear.com/9.x/adventurer/svg?seed=Luca",
    bio: "Crew lead known for clean submissions and disciplined release practices.",
    region: "Los Suenos, Costa Rica",
    speciesPreferences: ["Dorado", "Sailfish", "Blue Marlin"]
  },
  {
    name: "Aisha Khan",
    email: "demo.aisha@offshoreleague.test",
    avatarUrl: "https://api.dicebear.com/9.x/adventurer/svg?seed=Aisha",
    bio: "Offshore guide balancing family charters with competitive challenge weekends.",
    region: "Key West, Florida",
    speciesPreferences: ["Mahi-Mahi", "Sailfish", "Wahoo"]
  },
  {
    name: "Noah Bennett",
    email: "demo.noah@offshoreleague.test",
    avatarUrl: "https://api.dicebear.com/9.x/adventurer/svg?seed=Noah",
    bio: "Technical angler tracking moon phase impact on bite intensity and timing.",
    region: "Cabo San Lucas, Mexico",
    speciesPreferences: ["Dorado", "Yellowfin Tuna", "Blue Marlin"]
  }
];

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

async function seedDemoUsers() {
  await initializeDatabase();
  const db = await getDb();
  const passwordHash = hashPassword(DEMO_PASSWORD);
  const assetAvatars = await loadDemoAssetAvatars();

  for (const [index, persona] of DEMO_PERSONAS.entries()) {
    const seededAvatar = assetAvatars[index % assetAvatars.length] || persona.avatarUrl;

    await db.run(
      `INSERT INTO users (
        name,
        email,
        password_hash,
        email_verified_at,
        avatar_url,
        location,
        bio,
        region,
        species_preferences,
        is_demo,
        notify_challenge_closing,
        notify_submission_reviewed,
        notify_new_regional_challenges
      ) VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, 1, 1, 1, 1)
      ON CONFLICT(email) DO UPDATE SET
        name = excluded.name,
        password_hash = excluded.password_hash,
        email_verified_at = COALESCE(users.email_verified_at, excluded.email_verified_at),
        avatar_url = excluded.avatar_url,
        location = excluded.location,
        bio = excluded.bio,
        region = excluded.region,
        species_preferences = excluded.species_preferences,
        is_demo = 1,
        notify_challenge_closing = 1,
        notify_submission_reviewed = 1,
        notify_new_regional_challenges = 1`,
      persona.name,
      persona.email,
      passwordHash,
      seededAvatar,
      persona.region,
      persona.bio,
      persona.region,
      JSON.stringify(persona.speciesPreferences)
    );
  }

  const summary = await db.get(
    "SELECT COUNT(*) AS demoCount FROM users WHERE COALESCE(is_demo, 0) = 1"
  );

  console.log(`SEEDED_DEMO_PERSONAS=${DEMO_PERSONAS.length}`);
  console.log(`TOTAL_DEMO_USERS=${summary?.demoCount || 0}`);
  console.log(`DEMO_ASSET_AVATARS=${assetAvatars.length}`);
  console.log("DEMO_SEED_DONE=1");
}

async function loadDemoAssetAvatars() {
  const manifestPath = path.resolve("client/public/assets/demo/manifest.json");

  try {
    const raw = await fs.readFile(manifestPath, "utf8");
    const parsed = JSON.parse(raw);
    const assets = Array.isArray(parsed?.assets) ? parsed.assets : [];

    const avatarPaths = assets
      .map((asset) => String(asset?.file || "").trim())
      .filter((file) => file.startsWith("/assets/demo/") && file.endsWith(".jpg"));

    if (avatarPaths.length === 0) {
      return [];
    }

    // Interleave categories so seeded profiles are visually varied.
    const byCategory = new Map();
    for (const file of avatarPaths) {
      const category = String(file.split("/").pop() || "").split("-")[0] || "misc";
      if (!byCategory.has(category)) {
        byCategory.set(category, []);
      }
      byCategory.get(category).push(file);
    }

    const categoryLists = [...byCategory.values()];
    const interleaved = [];
    let hasMore = true;
    let offset = 0;
    while (hasMore) {
      hasMore = false;
      for (const list of categoryLists) {
        if (offset < list.length) {
          interleaved.push(list[offset]);
          hasMore = true;
        }
      }
      offset += 1;
    }

    return interleaved;
  } catch {
    return [];
  }
}

seedDemoUsers().catch((error) => {
  console.error("DEMO_SEED_DONE=0");
  console.error(error);
  process.exit(1);
});
