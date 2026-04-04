// Run from project root: node scripts/download-face-models.js
const https = require("https");
const fs = require("fs");
const path = require("path");

const BASE = "https://github.com/justadudewhohacks/face-api.js/raw/master/weights";

const FILES = [
  // tiny_face_detector (required - the main detector)
  ["tiny_face_detector/tiny_face_detector_model-weights_manifest.json", "tiny_face_detector_model-weights_manifest.json"],
  ["tiny_face_detector/tiny_face_detector_model-shard1",                "tiny_face_detector_model-shard1"],

  // face_landmark68 (required - for 68-point landmarks used in registration)
  ["face_landmark68/face_landmark_68_model-weights_manifest.json",      "face_landmark_68_model-weights_manifest.json"],
  ["face_landmark68/face_landmark_68_model-shard1",                     "face_landmark_68_model-shard1"],

  // face_recognition (optional - better matching, ~6MB)
  ["face_recognition/face_recognition_model-weights_manifest.json",     "face_recognition_model-weights_manifest.json"],
  ["face_recognition/face_recognition_model-shard1",                    "face_recognition_model-shard1"],
  ["face_recognition/face_recognition_model-shard2",                    "face_recognition_model-shard2"],

  // face_expression (optional)
  ["face_expression/face_expression_recognition_model-weights_manifest.json", "face_expression_recognition_model-weights_manifest.json"],
  ["face_expression/face_expression_recognition_model-shard1",                "face_expression_recognition_model-shard1"],
];

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(dest);
    fs.mkdirSync(dir, { recursive: true });
    const file = fs.createWriteStream(dest);
    const get = (u) => {
      https.get(u, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          get(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${u}`));
          return;
        }
        res.pipe(file);
        file.on("finish", () => { file.close(); resolve(); });
      }).on("error", reject);
    };
    get(url);
  });
}

(async () => {
  const OUT = path.join(process.cwd(), "public", "models");
  console.log(`\nDownloading face-api.js models to ${OUT}\n`);

  for (const [folder, filename] of FILES) {
    const destDir = path.join(OUT, folder.split("/")[0]);
    const dest = path.join(destDir, filename);
    const url = `${BASE}/${filename}`;
    process.stdout.write(`  ⬇  ${filename} ... `);
    try {
      await download(url, dest);
      console.log("✓");
    } catch (e) {
      console.log(`✗ (${e.message})`);
    }
  }

  console.log("\n✅ Done. Expected structure:");
  console.log("  public/models/");
  console.log("    tiny_face_detector/  ← manifest + shard1");
  console.log("    face_landmark68/     ← manifest + shard1");
  console.log("    face_recognition/    ← manifest + shard1 + shard2");
  console.log("    face_expression/     ← manifest + shard1");
  console.log("\nRestart your dev server after downloading.\n");
})();
