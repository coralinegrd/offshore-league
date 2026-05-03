import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const OUTPUT_DIR = path.resolve("client/public/assets/demo");
const MANIFEST_PATH = path.join(OUTPUT_DIR, "manifest.json");
const MAX_FILE_SIZE_BYTES = 500 * 1024;
const TARGET_COUNT = 20;
const TARGETS_BY_CATEGORY = {
  center_console: 7,
  sport_fisher: 7,
  sportboat: 6
};

const SEARCH_QUERIES = {
  center_console: [
    "center console fishing boat angler",
    "offshore center console boat",
    "center console deep sea fishing"
  ],
  sport_fisher: [
    "sport fisher boat offshore",
    "sportfishing yacht angler",
    "deep sea sportfisher"
  ],
  sportboat: [
    "sport boat fishing offshore",
    "recreational offshore fishing boat",
    "sportboat ocean angler"
  ]
};

const PEXELS_API_KEY = process.env.PEXELS_API_KEY || "";
const UNSPLASH_ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY || "";

function providerName() {
  if (PEXELS_API_KEY) return "pexels";
  if (UNSPLASH_ACCESS_KEY) return "unsplash";
  return null;
}

async function fetchPexelsCandidates(query, page = 1) {
  const url = new URL("https://api.pexels.com/v1/search");
  url.searchParams.set("query", query);
  url.searchParams.set("orientation", "landscape");
  url.searchParams.set("size", "large");
  url.searchParams.set("per_page", "30");
  url.searchParams.set("page", String(page));

  const response = await fetch(url, {
    headers: {
      Authorization: PEXELS_API_KEY,
      "user-agent": "OffshoreLeagueDemoAssetBuilder/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(`Pexels API ${response.status}`);
  }

  const payload = await response.json();
  const photos = Array.isArray(payload?.photos) ? payload.photos : [];
  return photos.map((photo) => ({
    id: `pexels-${photo.id}`,
    sourceProvider: "pexels",
    sourcePageUrl: photo.url,
    sourceAuthor: photo.photographer || "",
    sourceAuthorUrl: photo.photographer_url || "",
    imageUrl: photo?.src?.large2x || photo?.src?.large || photo?.src?.original || ""
  }));
}

async function fetchUnsplashCandidates(query, page = 1) {
  const url = new URL("https://api.unsplash.com/search/photos");
  url.searchParams.set("query", query);
  url.searchParams.set("orientation", "landscape");
  url.searchParams.set("per_page", "30");
  url.searchParams.set("page", String(page));
  url.searchParams.set("content_filter", "high");

  const response = await fetch(url, {
    headers: {
      Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}`,
      "accept-version": "v1",
      "user-agent": "OffshoreLeagueDemoAssetBuilder/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(`Unsplash API ${response.status}`);
  }

  const payload = await response.json();
  const photos = Array.isArray(payload?.results) ? payload.results : [];
  return photos.map((photo) => ({
    id: `unsplash-${photo.id}`,
    sourceProvider: "unsplash",
    sourcePageUrl: photo?.links?.html || "",
    sourceAuthor: photo?.user?.name || "",
    sourceAuthorUrl: photo?.user?.links?.html || "",
    imageUrl: `${photo?.urls?.raw || ""}&fm=jpg&q=90`
  }));
}

async function fetchCandidates(query, page = 1) {
  if (PEXELS_API_KEY) {
    return fetchPexelsCandidates(query, page);
  }
  if (UNSPLASH_ACCESS_KEY) {
    return fetchUnsplashCandidates(query, page);
  }
  throw new Error("Missing API credentials.");
}

async function optimizeToBudget(buffer) {
  const widths = [1400, 1200, 1080, 960, 860, 760];
  const qualities = [82, 76, 70, 64, 58, 52];

  for (const width of widths) {
    for (const quality of qualities) {
      const output = await sharp(buffer)
        .rotate()
        .resize({ width, withoutEnlargement: true })
        .jpeg({ quality, mozjpeg: true, chromaSubsampling: "4:2:0" })
        .toBuffer();

      if (output.length <= MAX_FILE_SIZE_BYTES) {
        return { buffer: output, width, quality };
      }
    }
  }

  // Return smallest attempt even if it is slightly over cap (should be rare).
  const fallback = await sharp(buffer)
    .rotate()
    .resize({ width: 700, withoutEnlargement: true })
    .jpeg({ quality: 48, mozjpeg: true, chromaSubsampling: "4:2:0" })
    .toBuffer();
  return { buffer: fallback, width: 700, quality: 48 };
}

function sha1(data) {
  return crypto.createHash("sha1").update(data).digest("hex");
}

async function fetchImage(url) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "user-agent": "OffshoreLeagueDemoAssetBuilder/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const contentType = String(response.headers.get("content-type") || "");
  if (!contentType.includes("image")) {
    throw new Error(`Unexpected content type: ${contentType}`);
  }

  const finalUrl = response.url;
  const buffer = Buffer.from(await response.arrayBuffer());
  return { buffer, finalUrl };
}

async function main() {
  const provider = providerName();
  if (!provider) {
    throw new Error(
      "Set PEXELS_API_KEY or UNSPLASH_ACCESS_KEY before running npm run assets:demo."
    );
  }

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const existing = await fs.readdir(OUTPUT_DIR).catch(() => []);
  await Promise.all(
    existing
      .filter((entry) => entry.endsWith(".jpg") || entry.endsWith(".json"))
      .map((entry) => fs.unlink(path.join(OUTPUT_DIR, entry)))
  );

  const seenHashes = new Set();
  const seenPhotoIds = new Set();
  const assets = [];

  for (const [category, minimum] of Object.entries(TARGETS_BY_CATEGORY)) {
    const queries = SEARCH_QUERIES[category];
    let page = 1;

    while (assets.filter((asset) => asset.category === category).length < minimum && page <= 6) {
      for (const query of queries) {
        const candidates = await fetchCandidates(query, page);

        for (const candidate of candidates) {
          if (!candidate.imageUrl || seenPhotoIds.has(candidate.id)) {
            continue;
          }

          try {
            const downloaded = await fetchImage(candidate.imageUrl);
            const optimized = await optimizeToBudget(downloaded.buffer);
            const digest = sha1(optimized.buffer);

            if (seenHashes.has(digest)) {
              continue;
            }

            const categoryCount = assets.filter((asset) => asset.category === category).length + 1;
            const fileName = `${category}-${String(categoryCount).padStart(2, "0")}.jpg`;
            await fs.writeFile(path.join(OUTPUT_DIR, fileName), optimized.buffer);
            seenHashes.add(digest);
            seenPhotoIds.add(candidate.id);

            assets.push({
              file: `/assets/demo/${fileName}`,
              category,
              sourceProvider: candidate.sourceProvider,
              sourcePageUrl: candidate.sourcePageUrl,
              sourceAuthor: candidate.sourceAuthor,
              sourceAuthorUrl: candidate.sourceAuthorUrl,
              sourceImageUrl: downloaded.finalUrl,
              searchQuery: query,
              sizeBytes: optimized.buffer.length,
              width: optimized.width,
              quality: optimized.quality,
              generatedAt: new Date().toISOString()
            });

            console.log(`ADDED=${fileName} SIZE=${optimized.buffer.length}`);
          } catch (error) {
            console.log(`SKIP=${category} ID=${candidate.id} REASON=${error.message}`);
          }

          if (assets.filter((asset) => asset.category === category).length >= minimum) {
            break;
          }
        }

        if (assets.filter((asset) => asset.category === category).length >= minimum) {
          break;
        }
      }

      page += 1;
    }
  }

  if (assets.length < TARGET_COUNT) {
    throw new Error(`Only generated ${assets.length}/${TARGET_COUNT} assets. Try broader search queries.`);
  }

  const categoryCoverage = {
    center_console: assets.filter((asset) => asset.category === "center_console").length,
    sport_fisher: assets.filter((asset) => asset.category === "sport_fisher").length,
    sportboat: assets.filter((asset) => asset.category === "sportboat").length
  };

  await fs.writeFile(
    MANIFEST_PATH,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: provider,
        targetPath: "/assets/demo/",
        maxFileSizeBytes: MAX_FILE_SIZE_BYTES,
        totalAssets: assets.length,
        licenseNote:
          provider === "pexels"
            ? "Pexels license applies. Keep attribution metadata from this manifest."
            : "Unsplash license applies. Keep attribution metadata from this manifest.",
        categoryCoverage,
        assets
      },
      null,
      2
    )
  );

  console.log(`TOTAL_ASSETS=${assets.length}`);
  console.log(`CENTER_CONSOLE=${categoryCoverage.center_console}`);
  console.log(`SPORT_FISHER=${categoryCoverage.sport_fisher}`);
  console.log(`SPORTBOAT=${categoryCoverage.sportboat}`);
  console.log(`MANIFEST=${MANIFEST_PATH}`);
}

main().catch((error) => {
  console.error("DEMO_ASSET_BUILD_FAILED=1");
  console.error(error.message);
  process.exit(1);
});
