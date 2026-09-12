/**
 * Bilgisayar raporu — "DRA rapor ver" komutunun sistem bolumu.
 *
 * Hepsi OKUMA. Hicbir sey degistirilmez, calistirilmaz, silinmez.
 * Yetki denetimi cagiran tarafta yapilir (permissions.require("sistem")).
 *
 * Windows'ta guncelleme bilgisi PowerShell uzerinden aliniyor:
 *  - son kurulan yama: Get-HotFix
 *  - bekleyen guncelleme: Microsoft.Update.Session COM arayuzu
 * Ikisi de yonetici yetkisi gerektirmiyor; arama biraz yavas olabildigi
 * icin ayri zaman asimi var ve basarisiz olursa rapor yine doner.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";

const execFileAsync = promisify(execFile);

/** Baytlari okunur hale getirir. */
function humanBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  const birim = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < birim.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${birim[i]}`;
}

/** Saniyeyi "3 gun 4 saat" gibi yazar. */
function humanUptime(seconds) {
  const gun = Math.floor(seconds / 86400);
  const saat = Math.floor((seconds % 86400) / 3600);
  const dakika = Math.floor((seconds % 3600) / 60);
  if (gun) return `${gun} gun ${saat} saat`;
  if (saat) return `${saat} saat ${dakika} dakika`;
  return `${dakika} dakika`;
}

async function powershell(script, timeout = 25_000) {
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { maxBuffer: 4 * 1024 * 1024, timeout },
  );
  return stdout.trim();
}

/** Windows guncelleme durumu. Basarisiz olursa null doner — rapor yine gelir. */
async function windowsUpdates() {
  if (process.platform !== "win32") return null;

  const sonuc = { lastInstalled: null, lastId: null, pending: null, pendingList: [] };

  // --- Son kurulan yama ----------------------------------------------
  try {
    const out = await powershell(`
      $ErrorActionPreference = 'SilentlyContinue'
      Get-HotFix | Sort-Object InstalledOn -Descending |
        Select-Object -First 1 HotFixID, InstalledOn |
        ConvertTo-Json -Compress
    `);
    const data = JSON.parse(out || "null");
    if (data) {
      sonuc.lastId = data.HotFixID || null;
      // PowerShell tarihi "/Date(1700000000000)/" bicimiyle verebiliyor.
      const ham = typeof data.InstalledOn === "string" ? data.InstalledOn : data.InstalledOn?.value;
      const damga = /\/Date\((\d+)\)\//.exec(ham || "")?.[1];
      const tarih = damga ? Number(damga) : Date.parse(ham || "");
      if (Number.isFinite(tarih)) sonuc.lastInstalled = tarih;
    }
  } catch (err) {
    console.warn("[dra] son guncelleme okunamadi:", err.message);
  }

  // --- Bekleyen guncellemeler ----------------------------------------
  // Windows Update araması ag'a cikar ve yavas olabilir; ayri, uzun
  // bir zaman asimi veriyoruz ve basarisizligi rapor icin olumcul saymiyoruz.
  try {
    const out = await powershell(
      `
      $ErrorActionPreference = 'Stop'
      $oturum = New-Object -ComObject Microsoft.Update.Session
      $arayici = $oturum.CreateUpdateSearcher()
      $sonuc = $arayici.Search("IsInstalled=0 and Type='Software' and IsHidden=0")
      $basliklar = @($sonuc.Updates | Select-Object -First 8 -ExpandProperty Title)
      [pscustomobject]@{ count = $sonuc.Updates.Count; titles = $basliklar } | ConvertTo-Json -Compress
      `,
      70_000,
    );
    const data = JSON.parse(out || "null");
    if (data && Number.isFinite(Number(data.count))) {
      sonuc.pending = Number(data.count);
      sonuc.pendingList = [].concat(data.titles || []).filter(Boolean);
    }
  } catch (err) {
    console.warn("[dra] bekleyen guncellemeler okunamadi:", err.message);
  }

  return sonuc;
}

/** Disk doluluk orani (Windows'ta sistem surucusu). */
async function diskInfo() {
  if (process.platform !== "win32") return null;
  try {
    const out = await powershell(`
      $ErrorActionPreference = 'SilentlyContinue'
      $s = $env:SystemDrive.TrimEnd(':')
      Get-PSDrive -Name $s |
        Select-Object @{n='free';e={[int64]$_.Free}}, @{n='used';e={[int64]$_.Used}} |
        ConvertTo-Json -Compress
    `);
    const data = JSON.parse(out || "null");
    if (!data) return null;
    const free = Number(data.free);
    const used = Number(data.used);
    if (!Number.isFinite(free) || !Number.isFinite(used) || free + used <= 0) return null;
    return {
      free,
      used,
      total: free + used,
      freeText: humanBytes(free),
      totalText: humanBytes(free + used),
      percentUsed: Math.round((used / (free + used)) * 100),
    };
  } catch (err) {
    console.warn("[dra] disk bilgisi okunamadi:", err.message);
    return null;
  }
}

/**
 * Sistem raporu. Her parca kendi basina basarisiz olabilir; rapor
 * eksik alanlarla da doner ki kullanici hic rapor alamamis olmasin.
 */
export async function system() {
  const [updates, disk] = await Promise.all([windowsUpdates(), diskInfo()]);

  const bellekToplam = os.totalmem();
  const bellekBos = os.freemem();

  return {
    at: Date.now(),
    os: {
      platform: process.platform,
      // "Windows 10 Pro" gibi bir ad yerine cekirdek surumu; ek bir
      // PowerShell cagrisina deger bulmadim, rapor icin yeterli.
      release: os.release(),
      arch: os.arch(),
      host: os.hostname(),
    },
    uptime: { seconds: Math.round(os.uptime()), text: humanUptime(os.uptime()) },
    memory: {
      total: bellekToplam,
      free: bellekBos,
      totalText: humanBytes(bellekToplam),
      percentUsed: Math.round(((bellekToplam - bellekBos) / bellekToplam) * 100),
    },
    cpu: { model: os.cpus()[0]?.model?.trim() || "—", cores: os.cpus().length },
    disk,
    updates,
  };
}

export const _internal = { humanBytes, humanUptime };
