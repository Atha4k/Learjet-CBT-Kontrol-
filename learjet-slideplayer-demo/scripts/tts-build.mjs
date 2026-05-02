import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";

const ROOT = process.cwd();
const INPUT_PATH = process.env.CAPTIONS_FILE
  ? path.resolve(ROOT, process.env.CAPTIONS_FILE)
  : path.resolve(ROOT, "captions_in", "captions copy.json");
const OUTPUT_DIR = process.env.OUTPUT_DIR
  ? path.resolve(ROOT, process.env.OUTPUT_DIR)
  : path.resolve(ROOT, "generated_audio");
const TMP_DIR = path.resolve(ROOT, "_tmp_audio");
const LANG = (process.env.TTS_LANG || "en").toLowerCase();
const VOICE = process.env.TTS_VOICE || (LANG === "tr" ? "Yelda" : "Samantha");
const RATE = String(process.env.TTS_RATE || (LANG === "tr" ? "170" : "175"));

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${code}`));
    });
  });
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\u2019/g, "'")
    .trim();
}

function sortSlideKeys(keys) {
  return [...keys].sort((a, b) => {
    const an = Number(String(a).replace(/\D+/g, "")) || 0;
    const bn = Number(String(b).replace(/\D+/g, "")) || 0;
    return an - bn || String(a).localeCompare(String(b));
  });
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function main() {
  const raw = await fs.readFile(INPUT_PATH, "utf8");
  const data = JSON.parse(raw);
  const entries = Array.isArray(data)
    ? data.map((item, idx) => [item.id || `s${String(idx + 1).padStart(2, "0")}`, item])
    : Object.entries(data);

  await ensureDir(OUTPUT_DIR);
  await ensureDir(TMP_DIR);

  let created = 0;
  for (const key of sortSlideKeys(entries.map(([id]) => id))) {
    const row = Array.isArray(data)
      ? entries.find(([id]) => id === key)?.[1]
      : data[key];
    if (!row) continue;

    const text = normalizeText(
      LANG === "tr"
        ? row.tr ?? row.caption_tr ?? row.text_tr
        : row.en ?? row.caption_en ?? row.text_en
    );

    if (!text) {
      console.log(`Skipping ${key}: no ${LANG.toUpperCase()} caption text`);
      continue;
    }

    const aiffPath = path.join(TMP_DIR, `${key}.aiff`);
    const mp3Path = path.join(OUTPUT_DIR, `${key}.mp3`);

    await run("say", ["-v", VOICE, "-r", RATE, "-o", aiffPath, text]);
    await run("ffmpeg", ["-y", "-i", aiffPath, "-codec:a", "libmp3lame", "-q:a", "2", mp3Path]);

    created += 1;
    console.log(`Created ${path.basename(mp3Path)}`);
  }

  console.log(`\nDone. ${created} MP3 files written to: ${OUTPUT_DIR}`);
}

main().catch((error) => {
  console.error("\nTTS build failed:", error.message);
  process.exit(1);
});
