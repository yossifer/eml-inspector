/**
 * app.js — application bootstrap and glue.
 *
 *  - owns the in-memory state (open documents, active doc, view state)
 *  - wires drag/drop + the file picker
 *  - registers the launchQueue consumer (this is what makes a double-clicked
 *    .eml from the ChromeOS Files app open here)
 *  - registers the service worker (offline + installability)
 *
 * No data ever leaves the device. Everything below runs locally in the browser.
 */
import { parseMessage } from "./mime.js";
import { renderList, renderMessage } from "./ui.js";

/* ---------- minimal ZIP (store, no compression) — keeps the app dependency-free ----------
   Attachments (PDF/images/office) are already compressed, so storing them as-is is fine
   and avoids pulling in a compression library. */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
  return t;
})();
function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function concatBytes(arrs) {
  let len = 0; for (const a of arrs) len += a.length;
  const out = new Uint8Array(len); let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}
const u16 = (v) => new Uint8Array([v & 0xff, (v >>> 8) & 0xff]);
const u32 = (v) => new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]);

function makeZip(files) {
  const enc = new TextEncoder();
  const chunks = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name), data = f.bytes, crc = crc32(data), size = data.length;
    const local = concatBytes([
      u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
      u32(crc), u32(size), u32(size), u16(name.length), u16(0), name
    ]);
    chunks.push(local, data);
    central.push(concatBytes([
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
      u32(crc), u32(size), u32(size), u16(name.length), u16(0), u16(0), u16(0), u16(0),
      u32(0), u32(offset), name
    ]));
    offset += local.length + data.length;
  }
  const cd = concatBytes(central);
  const end = concatBytes([
    u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(cd.length), u32(offset), u16(0)
  ]);
  return concatBytes([...chunks, cd, end]);
}

/** Ensure no two entries share a name (Outlook often sends image001.png repeatedly). */
function uniqueNames(attachments) {
  const seen = {};
  return attachments.map((a) => {
    let name = a.filename || "attachment";
    if (seen[name]) {
      const dot = name.lastIndexOf("."), base = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : "";
      let n = 1, cand; do { cand = `${base} (${n})${ext}`; n++; } while (seen[cand]);
      name = cand;
    }
    seen[name] = true;
    return { name, bytes: a.bytes };
  });
}

const docs = [];
let activeId = null;
const state = { bodyMode: "auto", showRemote: false };

const els = {
  drop: document.getElementById("drop"),
  file: document.getElementById("file"),
  list: document.getElementById("filelist"),
  empty: document.getElementById("empty"),
  view: document.getElementById("view"),
};

const actions = {
  setMode(mode) { state.bodyMode = mode; paint(); },
  loadRemote() { state.showRemote = true; paint(); },
  download(bytes, name, type) {
    const url = URL.createObjectURL(new Blob([bytes], { type: type || "application/octet-stream" }));
    const a = document.createElement("a");
    a.href = url; a.download = name || "download";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  },
  downloadAll(attachments, sourceName) {
    if (!attachments || !attachments.length) return;
    const zip = makeZip(uniqueNames(attachments));
    const base = (sourceName || "message").replace(/\.[^.]*$/, "");
    this.download(zip, `${base}-attachments.zip`, "application/zip");
  },
};

function select(id) { activeId = id; state.bodyMode = "auto"; state.showRemote = false; paint(); }

function paint() {
  renderList(els.list, docs, activeId, select);
  const doc = docs.find(d => d.id === activeId);
  if (!doc) { els.empty.hidden = false; els.view.hidden = true; return; }
  els.empty.hidden = true; els.view.hidden = false;
  renderMessage(els.view, doc, state, actions);
}

async function addFile(file) {
  try {
    const buf = await file.arrayBuffer();
    const msg = parseMessage(new Uint8Array(buf));
    const doc = { id: "d" + Date.now() + Math.random().toString(36).slice(2, 6), name: file.name || "message.eml", size: file.size, msg };
    docs.push(doc);
    select(doc.id);
  } catch (e) {
    console.error("Could not parse", file && file.name, e);
  }
}
function addFiles(list) { Array.from(list || []).forEach(addFile); }

/* file picker + drag and drop */
els.drop.addEventListener("click", () => els.file.click());
els.drop.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); els.file.click(); } });
els.file.addEventListener("change", e => addFiles(e.target.files));
["dragenter", "dragover"].forEach(ev => els.drop.addEventListener(ev, e => { e.preventDefault(); els.drop.classList.add("over"); }));
["dragleave", "drop"].forEach(ev => els.drop.addEventListener(ev, e => { e.preventDefault(); els.drop.classList.remove("over"); }));
els.drop.addEventListener("drop", e => addFiles(e.dataTransfer.files));
document.addEventListener("dragover", e => e.preventDefault());
document.addEventListener("drop", e => e.preventDefault());

/* FILE HANDLING API — receive files the OS launched us with (double-click) */
if ("launchQueue" in window && "files" in LaunchParams.prototype) {
  window.launchQueue.setConsumer(async (launchParams) => {
    if (!launchParams || !launchParams.files || !launchParams.files.length) return;
    for (const handle of launchParams.files) {
      try { await addFile(await handle.getFile()); }
      catch (e) { console.error("launch file error", e); }
    }
  });
}

/* service worker — required for install + offline */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(err => console.warn("SW registration failed", err)));
}

paint();
