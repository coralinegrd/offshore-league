import express from "express";
import cors from "cors";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import multer from "multer";
import challengeRoutes from "./routes/challenge.js";
import authRoutes from "./routes/auth.js";
import accountRoutes from "./routes/account.js";
import paymentRoutes, { stripeWebhook } from "./routes/payments.js";
import submissionRoutes from "./routes/submissions.js";
import adminRoutes from "./routes/admin.js";
import leaderboardRoutes from "./routes/leaderboard.js";
import notificationsRoutes from "./routes/notifications.js";
import { initializeDatabase } from "./db/database.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = process.env.PORT || 4000;
const execFileAsync = promisify(execFile);

async function runHistorySeedOnBoot() {
  const shouldSeedInProduction = process.env.NODE_ENV === "production";
  const seedDisabled = String(process.env.HISTORY_SEED_ON_BOOT || "true").toLowerCase() === "false";
  if (!shouldSeedInProduction || seedDisabled) return;

  const seedScriptPath = path.resolve(__dirname, "../scripts/seed-history.mjs");
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [seedScriptPath], {
      cwd: path.resolve(__dirname, "..")
    });
    if (stdout) console.log(stdout.trim());
    if (stderr) console.error(stderr.trim());
  } catch (error) {
    console.error("HISTORY_SEED_BOOT_FAILED", error?.message || error);
  }
}

await initializeDatabase();
await runHistorySeedOnBoot();

app.use(cors());
app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), stripeWebhook);
app.use(express.urlencoded({ extended: false, limit: "10mb" }));
app.use(express.json({ limit: "10mb" }));

app.use("/api", authRoutes);
app.use("/api", accountRoutes);
app.use("/api", challengeRoutes);
app.use("/api", paymentRoutes);
app.use("/api", submissionRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api", leaderboardRoutes);
app.use("/api", notificationsRoutes);

const uploadsPath = path.resolve(__dirname, "uploads");
app.use("/uploads", express.static(uploadsPath));

const clientDistPath = path.resolve(__dirname, "../client/dist");
if (process.env.NODE_ENV === "production") {
  app.use(express.static(clientDistPath));
  app.get(/^\/(?!api|uploads).*/, (req, res) => {
    res.sendFile(path.join(clientDistPath, "index.html"));
  });
}

app.use((err, req, res, next) => {
  console.error(err);

  if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "Upload exceeded the allowed file size limit." });
  }

  if (req.aborted) {
    return res.status(408).json({ error: "Upload was interrupted before completion. Please retry." });
  }

  if (err?.type === "entity.too.large") {
    return res.status(413).json({ error: "Profile image is too large. Choose a smaller image and try again." });
  }

  res.status(500).json({ error: "Server error" });
});

app.listen(port, () => {
  console.log(`Offshore League API running on http://localhost:${port}`);
});
