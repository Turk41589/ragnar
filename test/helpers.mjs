/**
 * Test altyapisi: sunucuyu baslatir, tarayiciyi acar, kucuk bir
 * dogrulama yardimcisi sunar. Harici test cercevesi yok.
 */

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, "..");

/** Testler icin sunucuyu ayri bir portta baslatir. */
export async function startServer(port = 4199) {
  const proc = spawn(process.execPath, [join(ROOT, "server", "index.mjs")], {
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15000;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return { proc, base };
    } catch {
      /* henuz ayakta degil */
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  proc.kill();
  throw new Error(`Sunucu ${port} portunda baslamadi.`);
}

/**
 * Tarayiciyi acar.
 * PLAYWRIGHT_CHROMIUM_PATH tanimliysa o ikili kullanilir; degilse
 * Playwright'in kendi indirdigi tarayici.
 */
export async function launchBrowser() {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    throw new Error(
      "Playwright kurulu degil.\n" +
        "  npm install\n" +
        "  npx playwright install chromium\n" +
        "komutlariyla kurup tekrar deneyin.",
    );
  }

  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;
  return chromium.launch({ executablePath });
}

/* ------------------------------------------------------------ dogrulama */

export function createTester(suiteName) {
  const failures = [];
  let passed = 0;

  const record = (ok, label, detail) => {
    if (ok) {
      passed += 1;
      console.log(`  \x1b[32m✓\x1b[0m ${label}`);
    } else {
      failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
      console.log(`  \x1b[31m✗\x1b[0m ${label}${detail ? `\n      ${detail}` : ""}`);
    }
  };

  return {
    /** Kosul dogru mu? */
    ok(condition, label) {
      record(Boolean(condition), label);
    },
    /** Iki deger esit mi? */
    eq(actual, expected, label) {
      const ok = JSON.stringify(actual) === JSON.stringify(expected);
      record(ok, label, ok ? "" : `bekleniyor: ${JSON.stringify(expected)}  cikan: ${JSON.stringify(actual)}`);
    },
    /** Metin bir kalibi karsiliyor mu? (birden fazla gecerli yanit varsa) */
    match(value, regex, label) {
      const ok = regex.test(String(value));
      record(ok, label, ok ? "" : `${regex} eslesmedi. Gelen: ${String(value).slice(0, 120)}`);
    },
    /** Metin bir parcayi iceriyor mu? */
    has(haystack, needle, label) {
      const ok = String(haystack).includes(needle);
      record(ok, label, ok ? "" : `"${needle}" bulunamadi. Gelen: ${String(haystack).slice(0, 120)}`);
    },
    get summary() {
      return { suiteName, passed, failures };
    },
  };
}

/* ---------------------------------------------------- sayfa yardimcilari */

/** Temiz bir baslangicla sayfayi acar (kayitli veri silinir, ses kapatilir). */
export async function openApp(page, base, { voice = false } = {}) {
  await page.goto(base, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  if (!voice) {
    // Sesli yanit acikken testler konusmanin bitmesini bekler.
    await page.evaluate(async () => {
      const { store, saveStore } = await import("/js/store.js");
      store.voiceEnabled = false;
      saveStore();
    });
  }
}

/** DRA'ya yazar ve yanitin gelmesini bekler. */
export async function tell(page, text, wait = 550) {
  await page.fill("#composer-input", text);
  await page.press("#composer-input", "Enter");
  await page.waitForTimeout(wait);
}

/** Sohbetteki tum mesajlari dondurur. */
export function readChat(page) {
  return page.$$eval("#log li", (els) =>
    els.map((el) => ({
      who: el.dataset.who,
      text: el.querySelector(".chat__bubble").textContent.trim(),
    })),
  );
}

/** Ses tanimadan gelen bir sonucu taklit eder. */
export function hear(page, text, final = true) {
  return page.evaluate(
    async ({ text, final }) => {
      const st = await import("/js/state.js");
      st.emit("heard", { text, alternatives: [text], final, confidence: 0.9 });
    },
    { text, final },
  );
}
