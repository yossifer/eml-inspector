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
