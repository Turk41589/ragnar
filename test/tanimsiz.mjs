/**
 * Tanimsiz degisken tarayicisi.
 *
 * Neden var: mikrofon uzun sure acilmadi, cunku ses motorunda `HERE` diye
 * hicbir yerde tanimlanmamis bir degisken kullaniliyordu. Hata bir async
 * yurutucunun icinde oldugu icin sessizce kayboldu; ne ekranda bir uyari
 * cikti ne de testler yakaladi. Boyle bir seyin bir daha sessizce
 * gecmemesi icin her dosya ayristiriliyor, kapsam agaci kuruluyor ve
 * hicbir kapsamda tanimlanmamis kullanimlar bildiriliyor.
 */
import { readFileSync } from "node:fs";

const GLOBALS = new Set([
  // dil
  "undefined","NaN","Infinity","globalThis","Object","Array","String","Number","Boolean",
  "Symbol","BigInt","Math","JSON","Date","RegExp","Error","TypeError","RangeError",
  "SyntaxError","ReferenceError","EvalError","URIError","AggregateError","Promise","Proxy",
  "Reflect","Map","Set","WeakMap","WeakSet","WeakRef","ArrayBuffer","SharedArrayBuffer",
  "DataView","Int8Array","Uint8Array","Uint8ClampedArray","Int16Array","Uint16Array",
  "Int32Array","Uint32Array","Float32Array","Float64Array","BigInt64Array","BigUint64Array",
  "Function","parseInt","parseFloat","isNaN","isFinite","encodeURI","encodeURIComponent",
  "decodeURI","decodeURIComponent","escape","unescape","Intl","arguments","eval",
  // ortak calisma zamani
  "console","setTimeout","clearTimeout","setInterval","clearInterval","queueMicrotask",
  "structuredClone","URL","URLSearchParams","TextEncoder","TextDecoder","AbortController",
  "AbortSignal","Event","EventTarget","fetch","Headers","Request","Response","Blob","File",
  "FormData","ReadableStream","WritableStream","TransformStream","performance","crypto",
  "atob","btoa","AbortError",
  // node
  "process","Buffer","global","__dirname","__filename","require","module","exports",
  "setImmediate","clearImmediate",
  // tarayici
  "window","document","navigator","location","history","localStorage","sessionStorage",
  "alert","confirm","prompt","requestAnimationFrame","cancelAnimationFrame","getComputedStyle",
  "matchMedia","CustomEvent","MutationObserver","ResizeObserver","IntersectionObserver",
  "Image","Audio","AudioContext","webkitAudioContext","MediaRecorder","MediaStream",
  "SpeechSynthesisUtterance","speechSynthesis","webkitSpeechRecognition","SpeechRecognition",
  "HTMLElement","Element","Node","NodeList","DOMParser","XMLHttpRequest","WebSocket",
  "HTMLInputElement","HTMLCanvasElement","HTMLAudioElement","HTMLVideoElement","Option",
  "customElements","CSS","devicePixelRatio","screen","scrollTo","close","open","name",
  "top","self","parent","frames","innerWidth","innerHeight","OffscreenCanvas","Path2D",
  "DOMMatrix","ImageData","createImageBitmap","Notification","IDBKeyRange","indexedDB",
]);

/* ------------------------------------------------------------ kapsam */

class Scope {
  constructor(parent, kind) {
    this.parent = parent;
    this.kind = kind; // "module" | "function" | "block"
    this.names = new Set();
  }
  declare(name) { this.names.add(name); }
  has(name) {
    for (let s = this; s; s = s.parent) if (s.names.has(name)) return true;
    return false;
  }
  fnScope() {
    let s = this;
    while (s.kind === "block") s = s.parent;
    return s;
  }
}

/** Bir baglama deseninden (pattern) cikan tum isimleri toplar. */
function patternNames(node, out = []) {
  if (!node) return out;
  switch (node.type) {
    case "Identifier": out.push(node.name); break;
    case "ObjectPattern":
      for (const p of node.properties) {
        if (p.type === "RestElement") patternNames(p.argument, out);
        else patternNames(p.value, out);
      }
      break;
    case "ArrayPattern":
      for (const el of node.elements) if (el) patternNames(el, out);
      break;
    case "AssignmentPattern": patternNames(node.left, out); break;
    case "RestElement": patternNames(node.argument, out); break;
  }
  return out;
}

/** Alt agactaki var / function bildirimlerini (fonksiyon sinirinda durarak) toplar. */
function hoistVars(node, out) {
  if (!node || typeof node.type !== "string") return;
  if (node.type === "VariableDeclaration" && node.kind === "var") {
    for (const d of node.declarations) patternNames(d.id, out);
  }
  if (node.type === "FunctionDeclaration" && node.id) out.push(node.id.name);
  const dur = ["FunctionDeclaration","FunctionExpression","ArrowFunctionExpression","ClassDeclaration","ClassExpression"];
  for (const key of Object.keys(node)) {
    if (key === "type" || key === "start" || key === "end" || key === "loc") continue;
    const v = node[key];
    if (Array.isArray(v)) {
      for (const c of v) {
        if (c && typeof c.type === "string") {
          if (dur.includes(c.type)) { if (c.type === "FunctionDeclaration" && c.id) out.push(c.id.name); continue; }
          hoistVars(c, out);
        }
      }
    } else if (v && typeof v.type === "string") {
      if (dur.includes(v.type)) { if (v.type === "FunctionDeclaration" && v.id) out.push(v.id.name); continue; }
      hoistVars(v, out);
    }
  }
}

/** Blok govdesindeki let/const/class/function bildirimlerini toplar. */
function blockDecls(body, out) {
  for (const st of body) {
    if (!st) continue;
    if (st.type === "VariableDeclaration" && st.kind !== "var") {
      for (const d of st.declarations) patternNames(d.id, out);
    } else if (st.type === "FunctionDeclaration" && st.id) out.push(st.id.name);
    else if (st.type === "ClassDeclaration" && st.id) out.push(st.id.name);
  }
}

let parse = null;

/** acorn kurulu mu? Degilse tarama atlanir, testler kirilmaz. */
export async function parserHazir() {
  if (parse) return true;
  try {
    ({ parse } = await import("acorn"));
    return true;
  } catch {
    return false;
  }
}

export function scanFile(path) {
  const src = readFileSync(path, "utf8");
  let ast;
  try {
    ast = parse(src, { ecmaVersion: "latest", sourceType: "module", locations: true, allowHashBang: true });
  } catch (err) {
    return [{ path, line: err.loc?.line ?? 0, name: "(ayristirma)", message: err.message }];
  }

  const bulunanlar = [];
  const moduleScope = new Scope(null, "module");

  // ust duzey bildirimler
  for (const st of ast.body) {
    if (st.type === "ImportDeclaration") {
      for (const sp of st.specifiers) moduleScope.declare(sp.local.name);
    } else if (st.type === "ExportNamedDeclaration" && st.declaration) {
      blockDecls([st.declaration], [...[]]) ;
    }
  }
  {
    const isimler = [];
    const govde = ast.body.map((st) =>
      (st.type === "ExportNamedDeclaration" || st.type === "ExportDefaultDeclaration") && st.declaration
        ? st.declaration : st);
    blockDecls(govde, isimler);
    hoistVars({ type: "Program", body: govde }, isimler);
    isimler.forEach((n) => moduleScope.declare(n));
  }

  function kullan(name, node, scope) {
    if (scope.has(name) || GLOBALS.has(name)) return;
    bulunanlar.push({ path, line: node.loc.start.line, name, message: "tanimsiz" });
  }

  function walk(node, scope) {
    if (!node || typeof node.type !== "string") return;

    switch (node.type) {
      case "Identifier":
        kullan(node.name, node, scope);
        return;

      case "MemberExpression":
        walk(node.object, scope);
        if (node.computed) walk(node.property, scope);
        return;

      case "Property":
        if (node.computed) walk(node.key, scope);
        walk(node.value, scope);
        return;

      case "PropertyDefinition":
      case "MethodDefinition":
        if (node.computed) walk(node.key, scope);
        walk(node.value, scope);
        return;

      case "MetaProperty":
      case "PrivateIdentifier":
      case "Super":
      case "ThisExpression":
        return;

      case "LabeledStatement":
        walk(node.body, scope);
        return;

      case "BreakStatement":
      case "ContinueStatement":
        return;

      case "ImportDeclaration":
      case "ExportAllDeclaration":
        return;

      case "ExportNamedDeclaration":
        if (node.source) return;           // re-export: yerel isim yok
        if (node.declaration) { walk(node.declaration, scope); return; }
        for (const sp of node.specifiers) {
          if (sp.local.type === "Identifier") kullan(sp.local.name, sp.local, scope);
        }
        return;

      case "FunctionDeclaration":
      case "FunctionExpression":
      case "ArrowFunctionExpression": {
        const fs = new Scope(scope, "function");
        if (node.type === "FunctionExpression" && node.id) fs.declare(node.id.name);
        for (const p of node.params) { patternNames(p).forEach((n) => fs.declare(n)); }
        for (const p of node.params) walkPatternDefaults(p, fs);
        if (node.body.type === "BlockStatement") {
          const isimler = [];
          blockDecls(node.body.body, isimler);
          hoistVars({ type: "Program", body: node.body.body }, isimler);
          isimler.forEach((n) => fs.declare(n));
          for (const st of node.body.body) walk(st, fs);
        } else {
          walk(node.body, fs);
        }
        return;
      }

      case "ClassDeclaration":
      case "ClassExpression": {
        const cs = new Scope(scope, "block");
        if (node.id) cs.declare(node.id.name);
        if (node.superClass) walk(node.superClass, cs);
        for (const m of node.body.body) walk(m, cs);
        return;
      }

      case "BlockStatement": {
        const bs = new Scope(scope, "block");
        const isimler = [];
        blockDecls(node.body, isimler);
        isimler.forEach((n) => bs.declare(n));
        for (const st of node.body) walk(st, bs);
        return;
      }

      case "ForStatement":
      case "ForInStatement":
      case "ForOfStatement": {
        const fs2 = new Scope(scope, "block");
        const head = node.type === "ForStatement" ? node.init : node.left;
        if (head && head.type === "VariableDeclaration") {
          for (const d of head.declarations) patternNames(d.id).forEach((n) => fs2.declare(n));
          for (const d of head.declarations) if (d.init) walk(d.init, fs2);
        } else if (head) walk(head, fs2);
        if (node.type === "ForStatement") { if (node.test) walk(node.test, fs2); if (node.update) walk(node.update, fs2); }
        else walk(node.right, fs2);
        walk(node.body, fs2);
        return;
      }

      case "CatchClause": {
        const cs = new Scope(scope, "block");
        if (node.param) patternNames(node.param).forEach((n) => cs.declare(n));
        walk(node.body, cs);
        return;
      }

      case "VariableDeclaration":
        for (const d of node.declarations) {
          patternNames(d.id).forEach((n) => scope.declare(n));
          walkPatternDefaults(d.id, scope);
          if (d.init) walk(d.init, scope);
        }
        return;
    }

    for (const key of Object.keys(node)) {
      if (key === "type" || key === "start" || key === "end" || key === "loc" || key === "range") continue;
      const v = node[key];
      if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === "string") walk(c, scope); }
      else if (v && typeof v.type === "string") walk(v, scope);
    }
  }

  /** Desen icindeki varsayilan degerler ve hesaplanan anahtarlar da kod. */
  function walkPatternDefaults(node, scope) {
    if (!node) return;
    if (node.type === "AssignmentPattern") { walk(node.right, scope); walkPatternDefaults(node.left, scope); }
    else if (node.type === "ObjectPattern") for (const p of node.properties) {
      if (p.type === "RestElement") walkPatternDefaults(p.argument, scope);
      else { if (p.computed) walk(p.key, scope); walkPatternDefaults(p.value, scope); }
    }
    else if (node.type === "ArrayPattern") for (const el of node.elements) walkPatternDefaults(el, scope);
    else if (node.type === "RestElement") walkPatternDefaults(node.argument, scope);
  }

  for (const st of ast.body) walk(st, moduleScope);
  return bulunanlar;
}

/* ===================================================================
 * Ek denetimler.
 *
 * Asagidakilerin hepsi bu projede GERCEKTEN yasanmis hata siniflari.
 * Tekrar etmemeleri icin her kosuda araniyorlar.
 * =================================================================== */

/** Kaynak agacinda gezer. */
function gez(node, gor) {
  if (!node || typeof node.type !== "string") return;
  gor(node);
  for (const k of Object.keys(node)) {
    if (k === "type" || k === "start" || k === "end" || k === "loc") continue;
    const v = node[k];
    if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === "string") gez(c, gor); }
    else if (v && typeof v.type === "string") gez(v, gor);
  }
}

function ayristir(path) {
  try {
    return parse(readFileSync(path, "utf8"), {
      ecmaVersion: "latest", sourceType: "module", locations: true, allowHashBang: true,
    });
  } catch {
    return null;
  }
}

/**
 * Ayni nesne icinde tekrarlanan anahtar.
 *
 * Yasandi: komut baglaminda `systemReport` iki kez tanimliydi; ikincisi
 * birincisini eziyor ve "rapor ver" yanlis seyi dondurüyordu. Sessiz
 * bir hata — ne uyari cikar ne de cokme olur.
 */
export function ayniAnahtarlar(path) {
  const ast = ayristir(path);
  if (!ast) return [];
  const bulgular = [];
  gez(ast, (node) => {
    if (node.type !== "ObjectExpression") return;
    const gorulen = new Map();
    for (const pr of node.properties) {
      if (pr.type !== "Property" || pr.computed) continue;
      if (pr.kind === "get" || pr.kind === "set") continue;
      const ad = pr.key.type === "Identifier" ? pr.key.name
        : pr.key.type === "Literal" ? String(pr.key.value) : null;
      if (ad === null) continue;
      if (gorulen.has(ad)) {
        bulgular.push({
          path, line: pr.loc.start.line, name: ad,
          message: `ayni nesnede tekrar ediyor (ilk: satir ${gorulen.get(ad)})`,
        });
      }
      gorulen.set(ad, pr.loc.start.line);
    }
  });
  return bulgular;
}

/**
 * `new Promise(async …)`.
 *
 * Yasandi: ses motoru boyle yaziliydi. Yurutucunun icindeki bir hata
 * sozu HIC sonuclandirmadan kayboluyor; cagiran sonsuza kadar bekliyor.
 * Mikrofonun acilmamasinin ve hicbir hata gorunmemesinin sebebi buydu.
 */
export function asyncYurutucu(path) {
  const ast = ayristir(path);
  if (!ast) return [];
  const bulgular = [];
  gez(ast, (node) => {
    if (node.type !== "NewExpression") return;
    if (node.callee?.name !== "Promise") return;
    const ilk = node.arguments?.[0];
    if (!ilk || !ilk.async) return;
    bulgular.push({
      path, line: node.loc.start.line, name: "new Promise(async …)",
      message: "async yurutucudaki hata sozu hic sonuclandirmaz",
    });
  });
  return bulgular;
}

/**
 * Testlerde SABIT tarih.
 *
 * Iki kez yasandi ve ikisinde de aylar sonra, bambaska bir is
 * yapilirken patladi: bir test fixture'i "2026-09-10" ya da   sabit-tarih-tamam
 * "1789000000" gibi mutlak bir zaman yaziyordu (sabit-tarih-tamam). Urun kodu ise son 7
 * gune / son 24 saate bakiyor. Tarih gectikce fixture o pencerenin
 * disina dusuyor ve test, kodda hicbir sey degismeden kendiliginden
 * bozuluyor.
 *
 * Kural: test zamanlari `Date.now()` uzerinden GORELI uretilir.
 * Gercekten sabit bir tarih gerekiyorsa (bicim ayristirma sinamasi
 * gibi) satira `sabit-tarih-tamam` yaziliyor.
 */
export function sabitTarih(path) {
  const satirlar = readFileSync(path, "utf8").split("\n");
  const bulgular = [];

  // ISO tarih ("2026-09-10"), epoch saniye (10 hane) ve epoch ms (13 hane).   sabit-tarih-tamam
  const kaliplar = [
    [/["'`]\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2})?/, "sabit ISO tarih"],   // sabit-tarih-tamam
    [/["'`]1[6-9]\d{8}["'`]/, "sabit epoch saniye"],   // sabit-tarih-tamam
    [/\b1[6-9]\d{11}\b/, "sabit epoch milisaniye"],   // sabit-tarih-tamam
  ];

  satirlar.forEach((satir, i) => {
    if (satir.includes("sabit-tarih-tamam")) return;
    for (const [kalip, ad] of kaliplar) {
      if (!kalip.test(satir)) continue;
      bulgular.push({
        path, line: i + 1, name: ad,
        message: "zamani Date.now() uzerinden goreli uretin (yoksa test bir sure sonra bozulur)",
      });
      break;
    }
  });

  return bulgular;
}
