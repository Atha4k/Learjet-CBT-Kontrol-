// scripts/ai-fill.mjs
import fs from "fs/promises";
import path from "path";
import OpenAI from "openai";
import "dotenv/config.js";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MANIFEST_PATH = path.resolve("manifest/manifest.json");

async function main() {
  const raw = await fs.readFile(MANIFEST_PATH, "utf8");
  const data = JSON.parse(raw);

  console.log(`🧠 ${data.length} slayt işlenecek...`);

  let changed = 0;
  for (const s of data) {
    // Boş başlık veya çeviri varsa OpenAI'den üret
    if (!s.title || s.title.startsWith("Slide")) {
      const prompt = `Create a short clear English title (max 8 words) for this sentence:\n${s.caption_en}`;
      const resp = await client.responses.create({
        model: "gpt-4.1-mini",
        input: prompt,
      });
      s.title = resp.output[0].content[0].text.trim();
      changed++;
    }

    if (!s.caption_tr || s.caption_tr === "") {
      const prompt = `Translate this English text to natural Turkish:\n${s.caption_en}`;
      const resp = await client.responses.create({
        model: "gpt-4.1-mini",
        input: prompt,
      });
      s.caption_tr = resp.output[0].content[0].text.trim();
      changed++;
    }

    console.log(`✅ ${s.id} işlendi`);
    await new Promise((r) => setTimeout(r, 500)); // çok hızlı gitmesin
  }

  await fs.writeFile(MANIFEST_PATH, JSON.stringify(data, null, 2));
  console.log(`\n✅ Manifest güncellendi: manifest/manifest.json`);
  console.log(`   Değişen alan sayısı: ${changed}`);
}

main().catch((e) => console.error("❌ Hata:", e.message));
