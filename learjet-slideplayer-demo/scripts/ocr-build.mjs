// scripts/ocr-build.mjs
import fs from "fs/promises";
import path from "path";
import sharp from "sharp";
import Tesseract from "tesseract.js";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SRC_DIR = path.join(ROOT, "slides_src");
const OUT_MANIFEST_DIR = path.join(ROOT, "manifest");
const OUT_MANIFEST = path.join(OUT_MANIFEST_DIR, "manifest.json");

// Slayt aralığı
const START = 1;
const END   = 31;

// Alt yazı bandı (slayt yüksekliğinin oranı)
const CAPTION_BAND_RATIO = 0.22;     // alt bant yüksekliği (oran)
const CAPTION_TOP_RATIO  = 1 - CAPTION_BAND_RATIO;
const CAPTION_BOTTOM_PAD_RATIO = 0.12; // alt bant içinde en alttan %12'yi hariç tut (menü/numara gürültüsü)

// Yardımcılar
function idOf(n){ return `s${String(n).padStart(2, "0")}`; }

// Daha güçlü ön işleme
async function preprocessForOCR(inputBuffer){
  const meta = await sharp(inputBuffer).metadata();
  const targetH = Math.max(300, Math.round(meta.height * 2)); // 2x büyüt
  return sharp(inputBuffer)
    .ensureAlpha()
    .resize({ height: targetH, withoutEnlargement: false })
    .greyscale()
    .normalize()
    .sharpen(1.2, 1.0, 1.2)
    .modulate({ brightness: 1.08, saturation: 1.0 })
    .median(1)
    .threshold(170, { grayscale: true }) // 165–175 arası oynatılabilir
    .toBuffer();
}

// Kuyruktaki “menü/numara/tek harf” çöplerini sil
function stripTrailingUI(s){
  const killWord = (w)=>{
    const x = w.replace(/\W+/g,'').toLowerCase();
    return (
      x === 'menu' ||
      x === 'general' ||
      x === 'information' ||
      x === 'airplane' ||
      x === 'airplanegeneral' ||
      x === 'generalinformation'
    );
  };
  let tokens = s.split(/\s+/);
  while(tokens.length){
    const t = tokens[tokens.length-1];
    if (/^\d+$/.test(t)) { tokens.pop(); continue; }               // sadece sayı
    if (/^[A-Za-z]{1,2}$/.test(t)) { tokens.pop(); continue; }     // tek/iki harf
    if (killWord(t)) { tokens.pop(); continue; }                   // bilinen UI kelimeleri
    break;
  }
  return tokens.join(' ').replace(/\s{2,}/g,' ').trim();
}

async function ocrCaptionFromBottomBand(absPath){
  const img = sharp(absPath);
  const meta = await img.metadata();
  const W = meta.width;
  const H = meta.height;

  // Alt bandı kırp (en alttaki menü/numara şeridini hariç tut)
  const bandH  = Math.round(H * CAPTION_BAND_RATIO);
  const bandTop= Math.round(H * CAPTION_TOP_RATIO);
  const bottomPad = Math.round(bandH * CAPTION_BOTTOM_PAD_RATIO);
  const bandHeight = Math.max(8, bandH - bottomPad);

  const bandBuf = await img.extract({ left: 0, top: bandTop, width: W, height: bandHeight }).toBuffer();
  const preBuf  = await preprocessForOCR(bandBuf);

  // psm=6: tek blok metin
  const { data: { text } } = await Tesseract.recognize(preBuf, 'eng', {
    tessedit_pageseg_mode: '6',
    tessedit_char_whitelist: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-–—.,:/()'\" ",
    preserve_interword_spaces: '1'
  });

  // Normalizasyon + gürültü temizliği
  let out = text
    .replace(/\r/g, ' ')
    .replace(/\n+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // EEE/RRR/--- gibi tekrarlar ve alakasız karakterler
  out = out
    .replace(/([A-Z])\1{2,}/g, '')
    .replace(/[-–—]{3,}/g, '-')
    .replace(/[^\w\s.,;:()'\"-]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // Sesli harf içermeyen uzun ALL-CAPS token'ları at
  out = out.split(/\s+/).filter(tok=>{
    const up = tok === tok.toUpperCase();
    const hasVowel = /[AEIOUaeiou]/.test(tok);
    if (tok.length >= 3 && up && !hasVowel) return false;
    return true;
  }).join(' ').trim();

  // Kuyrukta kalan menü/numara/tek harf çöplerini sil
  out = stripTrailingUI(out);

  // Baştaki saçakları kırpma: ilk büyük-küçük harf başlangıcından itibaren al
  const m = out.match(/[A-Z][a-z][\s\S]*$/);
  if (m && m.index > 0 && m[0].length > 20) {
    out = m[0].trim();
  }

  return out;
}

async function main(){
  await fs.mkdir(OUT_MANIFEST_DIR, { recursive: true });
  const items = [];

  for (let n = START; n <= END; n++){
    const id = idOf(n);
    const candidates = [
      path.join(SRC_DIR, `${id}.jpeg`),
      path.join(SRC_DIR, `${id}.jpg`),
      path.join(SRC_DIR, `${id}.png`),
    ];
    let srcPath = null;
    for (const c of candidates){
      try { await fs.access(c); srcPath = c; break; } catch {}
    }
    if(!srcPath){
      console.warn(`Skip ${id}: kaynak yok (${candidates.map(p=>path.basename(p)).join(', ')})`);
      continue;
    }

    console.log(`→ OCR: ${path.basename(srcPath)}`);

    let caption_en = '';
    try{
      caption_en = await ocrCaptionFromBottomBand(srcPath);
    }catch(e){
      console.warn(`   OCR hata: ${e.message}`);
    }

    const title = caption_en
      ? (caption_en.length > 60 ? caption_en.slice(0, 60) + '…' : caption_en)
      : `Slide ${n}`;

    items.push({
      id,
      title,
      imgSrc: `slides/${id}.png`,
      audioSrc: `audio/${id}.mp3`,
      caption_en: caption_en || "",
      caption_tr: ""
    });
  }

  await fs.writeFile(OUT_MANIFEST, JSON.stringify(items, null, 2), "utf8");
  console.log(`\n✅ manifest yazıldı: manifest/manifest.json`);
}

main().catch(e => { console.error(e); process.exit(1); });
