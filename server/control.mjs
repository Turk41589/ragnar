/**
 * Bilgisayar kontrolu — fare ve klavye kullanmadan.
 *
 * Ses, medya, pencere ve guc islemleri. Hepsi Windows'un kendi
 * arayuzleri uzerinden; ek program kurulmuyor.
 *
 * TASARIM KARARI — SERBEST KOMUT CALISTIRILMIYOR.
 * "Bilgisayardaki her seye erisebilsin" demek, DRA'nin duydugu her
 * kelimeyi komut satirina yazmasi demek DEGIL. Yanlis duyulan tek bir
 * kelime geri alinamaz bir sey yapabilir. Onun yerine ISIMLI islemler
 * var: her biri burada yaziyor, ne yaptigi belli ve sinanabilir.
 * Yeni bir yetenek eklemek buraya bir kayit eklemek demek.
 *
 * Ses ve medya icin sanal tuslar kullaniliyor. Bunun sebebi: Windows
 * bu tuslari o an sesi calan uygulamaya yonlendiriyor — Spotify,
 * tarayici, oyun, hangisiyse. Uygulamaya ozel kod yazmak gerekmiyor.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Testler gercek PowerShell calistirmaz; kosucu disaridan verilebilir. */
let runner = null;

export function _setRunnerForTests(fn) {
  runner = fn;
}

/** Sanal tus kodlari (Windows). */
const VK = {
  sesArtir: 0xAF,
  sesAzalt: 0xAE,
  sustur: 0xAD,
  oynatDurdur: 0xB3,
  sonraki: 0xB0,
  onceki: 0xB1,
  durdur: 0xB2,
};

export function available() {
  return process.platform === "win32";
}

async function powershell(script, { timeout = 20_000 } = {}) {
  if (runner) return runner(script);

  if (!available()) {
    throw Object.assign(
      new Error("Bilgisayar kontrolu su an yalnizca Windows'ta calisiyor."),
      { code: "NO_PLATFORM" },
    );
  }

  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { timeout, maxBuffer: 2 * 1024 * 1024 },
  );
  return stdout.trim();
}

/**
 * Sanal tusa basar.
 *
 * SendKeys sanal tuslari gonderemiyor (yalnizca metin), bu yuzden
 * dogrudan user32.dll'deki keybd_event cagriliyor. Tus ASAGI ve YUKARI
 * ayri ayri gonderilmeli; yalnizca asagi gonderirse tus basili kaliyor.
 */
async function pressVirtualKey(code, times = 1) {
  const script = `
    $ErrorActionPreference = 'Stop'
    Add-Type -Name K -Namespace W -MemberDefinition @'
[DllImport("user32.dll")]
public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);
'@
    for ($i = 0; $i -lt ${Math.max(1, Math.min(50, times))}; $i++) {
      [W.K]::keybd_event(${code}, 0, 0, 0)
      [W.K]::keybd_event(${code}, 0, 2, 0)
      Start-Sleep -Milliseconds 30
    }
  `;
  await powershell(script);
}

/* ------------------------------------------------------------------ ses */

/** Ses seviyesini adim adim degistirir. Her adim yaklasik %2. */
export async function volume(direction, steps = 5) {
  const yon = String(direction || "").toLowerCase();
  if (yon !== "up" && yon !== "down") {
    throw new Error("Ses yonu 'up' ya da 'down' olmali.");
  }
  await pressVirtualKey(yon === "up" ? VK.sesArtir : VK.sesAzalt, steps);
  return { action: "volume", direction: yon, steps };
}

export async function mute() {
  await pressVirtualKey(VK.sustur);
  return { action: "mute" };
}

/* ---------------------------------------------------------------- medya */

const MEDYA = {
  oynat: VK.oynatDurdur,
  duraklat: VK.oynatDurdur,
  sonraki: VK.sonraki,
  onceki: VK.onceki,
  durdur: VK.durdur,
};

export async function media(action) {
  const kod = MEDYA[action];
  if (!kod) {
    throw new Error(`Bilinmeyen medya islemi: ${action}`);
  }
  await pressVirtualKey(kod);
  return { action: "media", what: action };
}

/* -------------------------------------------------------------- pencere */

/** Metni kacisli tek tirnakli PowerShell dizesine cevirir. */
function psString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * Basligi verilen kelimeyi iceren pencereyi one getirip tus gonderir.
 *
 * Bu, "ileri sar" gibi islemler icin gerekli: sanal medya tuslarinda
 * ileri/geri sarma YOK. YouTube'un kendi kisayollari var (l = 10 saniye
 * ileri, j = 10 saniye geri) ama bunlar ancak sayfa odaktayken calisir.
 */
/**
 * SendKeys'te ZARARSIZ sayilan tuslar.
 *
 * `SendKeys.SendWait` sade bir metin gondericisi DEGIL: `+ ^ % ~ ( ) { }
 * [ ]` isaretleri Shift/Ctrl/Alt ve ozel tus anlamina geliyor. Yani
 * serbest birakilan bir `keys` alani, "%{F4}" (pencereyi kapat) ya da
 * "^{ESC}" (baslat menusu) gonderebilen genel bir klavye kanali demek —
 * bu modulun en basinda yazan "serbest komut calistirilmaz" kuralinin
 * tam tersi. Onun icin yalnizca harf, rakam ve bosluk geciyor.
 *
 * Su an ihtiyac duyulan tuslar zaten bunlar: YouTube'un l/j kisayollari.
 * Baska bir tus gerekirse dogru yol, buraya IZIN vermek degil, yukaridaki
 * gibi ISIMLI yeni bir islem eklemek.
 */
const GUVENLI_TUSLAR = /^[A-Za-z0-9 ]{1,32}$/;

export async function sendKeysTo(titlePart, keys) {
  const tuslar = String(keys ?? "");
  if (!GUVENLI_TUSLAR.test(tuslar)) {
    throw Object.assign(
      new Error(
        "Bu tus dizisi gonderilemez. Yalnizca harf, rakam ve bosluk " +
          "gonderilebiliyor; degistirici tuslar (Ctrl, Alt, Shift) icin " +
          "isimli bir islem gerekir.",
      ),
      { code: "UNSAFE_KEYS" },
    );
  }

  const script = `
    $ErrorActionPreference = 'Stop'
    Add-Type -AssemblyName Microsoft.VisualBasic
    Add-Type -AssemblyName System.Windows.Forms
    $hedef = Get-Process | Where-Object {
      $_.MainWindowTitle -like ${psString(`*${titlePart}*`)}
    } | Select-Object -First 1
    if (-not $hedef) { Write-Output 'YOK'; exit 0 }
    [Microsoft.VisualBasic.Interaction]::AppActivate($hedef.Id)
    Start-Sleep -Milliseconds 220
    [System.Windows.Forms.SendKeys]::SendWait(${psString(tuslar)})
    Write-Output 'TAMAM'
  `;
  const sonuc = await powershell(script);
  if (String(sonuc).includes("YOK")) {
    throw Object.assign(
      new Error(`"${titlePart}" penceresi bulunamadi. Acik mi?`),
      { code: "NO_WINDOW" },
    );
  }
  return { action: "keys", target: titlePart, keys: tuslar };
}

/**
 * On plandaki pencere bilgisi.
 *
 * Oyun oynarken DRA'nin ekrana gelmesi oyunu kucultur ve oyunu bozar.
 * Bunu anlamanin yolu: on plandaki pencere ekranin tamamini kapliyor mu?
 */
export async function foreground() {
  const script = `
    $ErrorActionPreference = 'Stop'
    Add-Type -Name U -Namespace W -MemberDefinition @'
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
[DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out W.U+RECT r);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
[DllImport("user32.dll")] public static extern bool GetWindowPlacement(IntPtr h, ref W.U+WINDOWPLACEMENT p);
[DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr h, uint f);
[DllImport("user32.dll")] public static extern bool GetMonitorInfo(IntPtr m, ref W.U+MONITORINFO i);
public struct RECT { public int Left, Top, Right, Bottom; }
public struct POINT { public int X, Y; }
public struct WINDOWPLACEMENT { public int length, flags, showCmd; public POINT min, max; public RECT normal; }
public struct MONITORINFO { public int cbSize; public RECT monitor, work; public uint flags; }
'@
    $h = [W.U]::GetForegroundWindow()
    $n = [W.U]::GetWindowTextLength($h)
    $sb = New-Object System.Text.StringBuilder ($n + 1)
    [void][W.U]::GetWindowText($h, $sb, $sb.Capacity)

    $r = New-Object W.U+RECT
    [void][W.U]::GetWindowRect($h, [ref]$r)

    $wp = New-Object W.U+WINDOWPLACEMENT
    $wp.length = [System.Runtime.InteropServices.Marshal]::SizeOf($wp)
    [void][W.U]::GetWindowPlacement($h, [ref]$wp)

    # Pencerenin BULUNDUGU ekran; birincil ekran degil.
    $mon = [W.U]::MonitorFromWindow($h, 2)
    $mi = New-Object W.U+MONITORINFO
    $mi.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($mi)
    [void][W.U]::GetMonitorInfo($mon, [ref]$mi)

    $pid2 = 0
    [void][W.U]::GetWindowThreadProcessId($h, [ref]$pid2)
    $p = Get-Process -Id $pid2 -ErrorAction SilentlyContinue

    [pscustomobject]@{
      title = $sb.ToString()
      process = $(if ($p) { $p.ProcessName } else { '' })
      width = $r.Right - $r.Left
      height = $r.Bottom - $r.Top
      screenWidth = $mi.monitor.Right - $mi.monitor.Left
      screenHeight = $mi.monitor.Bottom - $mi.monitor.Top
      workHeight = $mi.work.Bottom - $mi.work.Top
      maximized = ($wp.showCmd -eq 3)
    } | ConvertTo-Json -Compress
  `;

  const ham = await powershell(script, { timeout: 12_000 });
  let d;
  try {
    d = JSON.parse(ham || "null");
  } catch {
    return null;
  }
  if (!d) return null;

  /*
   * TAM EKRAN ile BUYUTULMUS (maximize) ayni sey degil.
   *
   * GetWindowRect buyutulmus pencerelerde gorunmez yeniden boyutlandirma
   * kenarligini de sayiyor; olculer ekrani asiyor. Yalnizca boyuta
   * bakinca her buyutulmus pencere "oyun" sayiliyor ve DRA hic
   * gorunmuyordu. Iki ek olcut:
   *   - Windows pencereyi BUYUTULMUS olarak isaretlemisse tam ekran degil.
   *   - Tam ekran uygulama gorev cubugunu da kapatir; yani yuksekligi
   *     calisma alanindan (work) buyuk olmali.
   */
  const gorevCubuguKapali = d.workHeight > 0 && d.height > d.workHeight;
  const ekraniKapliyor =
    d.height >= d.screenHeight - 2 && d.width >= d.screenWidth - 2;

  const tamEkran = !d.maximized && ekraniKapliyor && gorevCubuguKapali;

  return {
    title: d.title || "",
    process: d.process || "",
    maximized: Boolean(d.maximized),
    fullscreen: Boolean(tamEkran),
  };
}

/* ----------------------------------------------------------------- guc */

/** Isimli guc islemleri. Serbest komut yok. */
const GUC = {
  kilitle: "rundll32.exe user32.dll,LockWorkStation",
  uyut: "rundll32.exe powrprof.dll,SetSuspendState 0,1,0",
};

export async function power(action) {
  const komut = GUC[action];
  if (!komut) throw new Error(`Bilinmeyen guc islemi: ${action}`);
  await powershell(`Start-Process -NoNewWindow -FilePath cmd -ArgumentList '/c ${komut}'`);
  return { action: "power", what: action };
}

/* ------------------------------------------------------------- parlaklik */

/** Ekran parlakligi (dizustunde calisir; harici ekranlarda cogu zaman calismaz). */
export async function brightness(percent) {
  const p = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
  const script = `
    $ErrorActionPreference = 'Stop'
    $m = Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods -ErrorAction SilentlyContinue
    if (-not $m) { Write-Output 'YOK'; exit 0 }
    $m.WmiSetBrightness(1, ${p})
    Write-Output 'TAMAM'
  `;
  const sonuc = await powershell(script);
  if (String(sonuc).includes("YOK")) {
    throw new Error(
      "Bu ekranin parlakligi yazilimdan degistirilemiyor (cogu masaustu " +
        "monitorunde boyle; monitorun kendi dugmelerini kullanin).",
    );
  }
  return { action: "brightness", percent: p };
}

/* ------------------------------------------------------------- baglanti */

/** Adresi varsayilan tarayicida acar. */
export async function openUrl(url) {
  const u = String(url || "");
  // Yalnizca http(s): "file:" ya da baska bir sema ile dosya acilmasin.
  if (!/^https?:\/\//i.test(u)) {
    throw new Error("Yalnizca http ve https adresleri acilabilir.");
  }
  await powershell(`Start-Process ${psString(u)}`);
  return { action: "open", url: u };
}

export const ACTIONS = {
  volume: "Sesi acar ya da kisar",
  mute: "Sesi susturur / acar",
  media: "Oynat, duraklat, sonraki, onceki",
  seek: "Ileri/geri sarar (pencereyi one getirip harf tusu gonderir)",
  power: "Kilitler ya da uyutur",
  brightness: "Ekran parlakligini ayarlar",
  open: "Adres acar",
};
