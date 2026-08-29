/**
 * Bilgisayardaki uygulama ve oyunlari bulur, baslatir, kapatir.
 *
 * Onemli tasarim karari: DRA rastgele komut CALISTIRMAZ.
 * Once sistemi tarayip kurulu uygulamalarin listesini cikarir; sonra
 * yalnizca BU LISTEDEKI bir kaydi baslatabilir. Boylece yanlis duyulan
 * bir kelime beklenmedik bir sey calistiramaz.
 */

import { exec, execFile } from "node:child_process";
import { readFile, readdir, writeFile, mkdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, basename, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(HERE, "..", "data");
const CACHE_FILE = join(DATA_DIR, "apps.json");

/** Listeye girmemesi gereken kurulum/kaldirma kisayollari. */
const NOISE = /uninstall|kaldir|readme|lisans|licence|license|yardim|help|belgeler|documentation|website|web sitesi|guncelle|updater|crash|report/i;

let cache = null;

/* ------------------------------------------------------------- tarama */

/** Windows: Baslat menusu kisayollari + Steam kutuphanesi. */
async function scanWindows() {
  const apps = [];

  // --- Baslat menusu -------------------------------------------------
  // PowerShell hem kisayollari buluyor hem de hedef .exe yolunu cozuyor.
  // Hedef yolu bilmek kapatma icin sart: taskkill goruntu adiyla calisiyor.
  const ps = `
    $ErrorActionPreference = 'SilentlyContinue'
    $shell = New-Object -ComObject WScript.Shell
    $roots = @(
      "$env:ProgramData\\Microsoft\\Windows\\Start Menu\\Programs",
      "$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs",
      "$env:USERPROFILE\\Desktop"
    )
    $out = @()
    foreach ($root in $roots) {
      if (-not (Test-Path $root)) { continue }
      Get-ChildItem -Path $root -Filter *.lnk -Recurse -ErrorAction SilentlyContinue |
        ForEach-Object {
          $link = $shell.CreateShortcut($_.FullName)
          $out += [PSCustomObject]@{
            name   = [System.IO.Path]::GetFileNameWithoutExtension($_.Name)
            path   = $_.FullName
            target = $link.TargetPath
          }
        }
    }
    $out | ConvertTo-Json -Compress -Depth 3
  `;

  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", ps],
      { maxBuffer: 12 * 1024 * 1024, timeout: 90_000 },
    );
    const parsed = JSON.parse(stdout.trim() || "[]");
    for (const item of [].concat(parsed)) {
      if (!item?.name || NOISE.test(item.name)) continue;
      apps.push({
        name: item.name,
        kind: "kisayol",
        launch: { type: "shell", path: item.path },
        // Kapatma icin hedef .exe adi
        process: item.target ? basename(item.target) : null,
      });
    }
  } catch (err) {
    console.warn("[dra] Baslat menusu taranamadi:", err.message);
  }

  // --- Steam oyunlari -------------------------------------------------
  apps.push(...(await scanSteam()));
  return apps;
}

/** Steam kutuphanesindeki kurulu oyunlar. */
async function scanSteam() {
  const roots = [
    "C:\\Program Files (x86)\\Steam",
    "C:\\Program Files\\Steam",
    join(process.env.HOME || "", ".steam", "steam"),
    join(process.env.HOME || "", ".local", "share", "Steam"),
  ].filter(Boolean);

  const steamRoot = roots.find((r) => existsSync(join(r, "steamapps")));
  if (!steamRoot) return [];

  // libraryfolders.vdf birden fazla disk yolunu listeler.
  const libraries = [join(steamRoot, "steamapps")];
  try {
    const vdf = await readFile(join(steamRoot, "steamapps", "libraryfolders.vdf"), "utf8");
    for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) {
      const p = join(m[1].replace(/\\\\/g, "\\"), "steamapps");
      if (!libraries.includes(p)) libraries.push(p);
    }
  } catch {
    /* tek kutuphane ile devam */
  }

  const games = [];
  for (const lib of libraries) {
    let files;
    try {
      files = await readdir(lib);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!/^appmanifest_\d+\.acf$/.test(file)) continue;
      try {
        const text = await readFile(join(lib, file), "utf8");
        const id = text.match(/"appid"\s+"(\d+)"/i)?.[1];
        const name = text.match(/"name"\s+"([^"]+)"/i)?.[1];
        if (!id || !name) continue;
        games.push({
          name,
          kind: "steam oyunu",
          launch: { type: "uri", uri: `steam://rungameid/${id}` },
          process: null,
          steamAppId: id,
        });
      } catch {
        /* bozuk dosyayi atla */
      }
    }
  }
  return games;
}

/** macOS: /Applications altindaki uygulamalar. */
async function scanMac() {
  const apps = [];
  for (const root of ["/Applications", "/System/Applications", join(process.env.HOME || "", "Applications")]) {
    let entries;
    try {
      entries = await readdir(root);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (extname(entry) !== ".app") continue;
      const name = basename(entry, ".app");
      if (NOISE.test(name)) continue;
      apps.push({
        name,
        kind: "uygulama",
        launch: { type: "mac", path: join(root, entry) },
        process: name,
      });
    }
  }
  return apps;
}

/** Linux: .desktop tanimlari. */
async function scanLinux() {
  const apps = [];
  const roots = [
    "/usr/share/applications",
    "/usr/local/share/applications",
    join(process.env.HOME || "", ".local", "share", "applications"),
  ];

  for (const root of roots) {
    let entries;
    try {
      entries = await readdir(root);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (extname(entry) !== ".desktop") continue;
      try {
        const text = await readFile(join(root, entry), "utf8");
        if (/^NoDisplay\s*=\s*true/mi.test(text)) continue;
        const name = text.match(/^Name(?:\[tr\])?\s*=\s*(.+)$/mi)?.[1]?.trim();
        const execLine = text.match(/^Exec\s*=\s*(.+)$/mi)?.[1]?.trim();
        if (!name || !execLine || NOISE.test(name)) continue;
        // %U, %f gibi yer tutuculari at
        const command = execLine.replace(/%[a-zA-Z]/g, "").trim();
        apps.push({
          name,
          kind: "uygulama",
          launch: { type: "command", command },
          process: basename(command.split(/\s+/)[0]),
        });
      } catch {
        /* bozuk dosyayi atla */
      }
    }
  }
  apps.push(...(await scanSteam()));
  return apps;
}

/** Ayni isimli kayitlari teke indirir. */
function dedupe(apps) {
  const seen = new Map();
  for (const app of apps) {
    const key = app.name.toLocaleLowerCase("tr");
    // Steam oyunlari kisayollara tercih edilir (daha guvenilir baslatma)
    if (!seen.has(key) || app.kind === "steam oyunu") seen.set(key, app);
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, "tr"));
}

/** Sistemi tarar ve sonucu diske yazar. */
export async function scanApps() {
  const platform = process.platform;
  let apps = [];

  if (platform === "win32") apps = await scanWindows();
  else if (platform === "darwin") apps = await scanMac();
  else apps = await scanLinux();

  cache = dedupe(apps).map((app, i) => ({ id: `app-${i}`, ...app }));

  try {
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(CACHE_FILE, JSON.stringify({ scannedAt: Date.now(), apps: cache }, null, 2));
  } catch (err) {
    console.warn("[dra] uygulama listesi kaydedilemedi:", err.message);
  }
  return cache;
}

/** Onbellekteki listeyi dondurur; yoksa diskten okur. */
export async function listApps() {
  if (cache) return cache;
  try {
    const saved = JSON.parse(await readFile(CACHE_FILE, "utf8"));
    if (Array.isArray(saved.apps)) cache = saved.apps;
  } catch {
    cache = null;
  }
  return cache || [];
}

/** Listenin ne zaman tarandigi. */
export async function scanInfo() {
  try {
    const saved = JSON.parse(await readFile(CACHE_FILE, "utf8"));
    return { scannedAt: saved.scannedAt || null, count: saved.apps?.length || 0 };
  } catch {
    return { scannedAt: null, count: 0 };
  }
}

/* ---------------------------------------------------------- baslatma */

/**
 * Kaydi baslatir.
 * Yalnizca taranmis listeden gelen bir kayit kabul edilir; disaridan
 * gelen serbest metin asla kabuk komutuna donusmez.
 */
export async function launchApp(app) {
  const { launch } = app;

  if (launch.type === "shell") {
    // Windows kisayolu: start, kisayolu isletim sistemine cozdurur.
    await execFileAsync("cmd.exe", ["/c", "start", "", launch.path], { windowsHide: true });
    return;
  }
  if (launch.type === "uri") {
    if (process.platform === "win32") {
      await execFileAsync("cmd.exe", ["/c", "start", "", launch.uri], { windowsHide: true });
    } else {
      await execFileAsync("xdg-open", [launch.uri]);
    }
    return;
  }
  if (launch.type === "mac") {
    await execFileAsync("open", ["-a", launch.path]);
    return;
  }
  if (launch.type === "command") {
    // Kabuk kullanilir cunku .desktop Exec satiri argumanlar icerebilir.
    // Deger yalnizca sistemin kendi tanim dosyalarindan gelir.
    await execAsync(`${launch.command} >/dev/null 2>&1 &`);
    return;
  }
  throw new Error("Bilinmeyen baslatma turu.");
}

/** Kaydi kapatir. Surec adi bilinmiyorsa kapatilamaz. */
export async function closeApp(app) {
  if (!app.process) {
    throw Object.assign(new Error("Bu uygulamanin surec adi bilinmiyor."), { code: "NO_PROCESS" });
  }
  if (process.platform === "win32") {
    await execFileAsync("taskkill.exe", ["/IM", app.process, "/F"], { windowsHide: true });
  } else if (process.platform === "darwin") {
    await execFileAsync("pkill", ["-f", app.process]);
  } else {
    await execFileAsync("pkill", ["-f", app.process]);
  }
}
