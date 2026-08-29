#!/usr/bin/env node
/**
 * DRA test kosucusu.
 *
 *   npm test          hizli testler (~30 sn)
 *   npm run test:tam  alarm testi dahil (~2.5 dk)
 *
 * Sunucuyu kendi baslatir, tarayiciyi acar, sonuclari ozetler.
 */

import { startServer, launchBrowser, createTester } from "./helpers.mjs";

const RUN_SLOW = process.argv.includes("--tam");

/** `--sadece alarm` gibi: yalnizca adi eslesen paketi calistirir. */
const onlyArg = process.argv.indexOf("--sadece");
const ONLY = onlyArg !== -1 ? (process.argv[onlyArg + 1] || "").toLowerCase() : null;

const SUITES = [
  await import("./suites/komutlar.mjs"),
  await import("./suites/yonlendirme.mjs"),
  await import("./suites/arayuz.mjs"),
  await import("./suites/alarm.mjs"),
];

const gray = (s) => `\x1b[90m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

let server;
let browser;
let exitCode = 0;

try {
  console.log(gray("sunucu baslatiliyor…"));
  server = await startServer();

  console.log(gray("tarayici aciliyor…"));
  browser = await launchBrowser();

  const summaries = [];

  for (const suite of SUITES) {
    if (ONLY && !suite.name.toLowerCase().includes(ONLY)) continue;
    if (suite.slow && !RUN_SLOW && !ONLY) {
      console.log(`\n${bold(suite.name)} ${gray("— atlandi (npm run test:tam ile calisir)")}`);
      continue;
    }

    console.log(`\n${bold(suite.name)}`);

    const context = await browser.newContext({ viewport: { width: 1600, height: 950 } });
    const page = await context.newPage();

    // Sayfa hatalarini ve localhost disina cikan istekleri topla.
    const pageErrors = [];
    const external = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    page.on("console", (m) => m.type() === "error" && pageErrors.push(m.text()));
    page.on("request", (r) => {
      const host = new URL(r.url()).hostname;
      if (!["127.0.0.1", "localhost"].includes(host)) external.push(r.url());
    });

    const t = createTester(suite.name);
    try {
      await suite.run(page, server.base, t, { external, pageErrors });
    } catch (err) {
      t.ok(false, `paket cokti: ${err.message}`);
    }

    t.ok(pageErrors.length === 0, "sayfada konsol hatasi yok");
    if (pageErrors.length) console.log(gray(`      ${pageErrors.join("\n      ")}`));

    summaries.push(t.summary);
    await context.close();
  }

  /* ------------------------------------------------------------ ozet -- */
  console.log(`\n${"─".repeat(52)}`);
  let totalPassed = 0;
  let totalFailed = 0;

  for (const s of summaries) {
    totalPassed += s.passed;
    totalFailed += s.failures.length;
    const mark = s.failures.length ? "\x1b[31mBASARISIZ\x1b[0m" : "\x1b[32mGECTI\x1b[0m";
    console.log(`${mark}  ${s.suiteName} — ${s.passed} gecti, ${s.failures.length} kaldi`);
  }

  if (totalFailed) {
    console.log("\nBasarisiz olanlar:");
    for (const s of summaries) {
      for (const f of s.failures) console.log(`  • [${s.suiteName}] ${f}`);
    }
    exitCode = 1;
  }

  console.log(`\nToplam: ${totalPassed} gecti, ${totalFailed} kaldi`);
  if (!RUN_SLOW) console.log(gray("Alarm testi icin: npm run test:tam"));
} catch (err) {
  console.error(`\n\x1b[31mTest kosucusu hata verdi:\x1b[0m ${err.message}`);
  exitCode = 1;
} finally {
  await browser?.close();
  server?.proc.kill();
}

process.exit(exitCode);
