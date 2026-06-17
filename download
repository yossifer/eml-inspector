/**
 * ui.js — rendering. Takes a parsed message (the shape from mime.js) plus a
 * small view-state object, and paints the DOM. No parsing logic lives here.
 *
 * Add UI features here (new buttons, panels, columns). Add *parsing* features
 * in mime.js. Keeping that line clean is what makes the app easy to grow.
 */
import { binStrToBytes } from "./mime.js";

export function esc(s) {
  return (s || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
export function fmtSize(n) {
  if (n == null) return "";
  if (n < 1024) return n + " B";
  if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
  return (n / 1048576).toFixed(1) + " MB";
}
function fmtDate(raw) {
  if (!raw) return "";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return esc(raw);
  return esc(raw) + '  <span style="color:var(--faint)">(' + d.toLocaleString() + ")</span>";
}

/** Rewrite remote image/background/url() references so they don't load until asked. */
export function blockRemote(html) {
  let count = 0; const bump = () => count++;
  const out = html
    .replace(/(\s)(src)\s*=\s*("|')\s*(https?:\/\/[^"']*)\3/gi, (m, sp, a, q, url) => { bump(); return sp + "data-blocked-src=" + q + url + q; })
    .replace(/(\s)(background)\s*=\s*("|')\s*(https?:\/\/[^"']*)\3/gi, (m, sp, a, q, url) => { bump(); return sp + "data-blocked-bg=" + q + url + q; })
    .replace(/url\(\s*(['"]?)(https?:\/\/[^)'"]*)\1\s*\)/gi, () => { bump(); return "url()"; });
  return { html: out, blocked: count };
}

export function renderList(listEl, docs, activeId, onSelect) {
  listEl.innerHTML = "";
  docs.forEach(d => {
    const li = document.createElement("li");
    li.className = "fileitem" + (d.id === activeId ? " active" : "");
    li.innerHTML = `<div class="fn"></div><div class="meta"></div>`;
    li.querySelector(".fn").textContent = d.msg.subject || "(no subject)";
    li.querySelector(".meta").textContent = d.name + " · " + fmtSize(d.size);
    li.addEventListener("click", () => onSelect(d.id));
    listEl.appendChild(li);
  });
}

/**
 * @param viewEl   container element
 * @param doc      { id, name, size, msg }  (msg = parseMessage output)
 * @param state    { bodyMode: "auto"|"text"|"raw", showRemote: bool }
 * @param actions  { setMode(mode), loadRemote(), download(bytes,name,type) }
 */
export function renderMessage(viewEl, doc, state, actions) {
  const m = doc.msg;
  const field = (label, value, addr) => value
    ? `<div class="field"><div class="k">${label}</div><div class="v ${addr ? "addr" : ""}">${esc(value)}</div></div>`
    : "";

  const hasHtml = m.html != null, hasText = m.text != null;
  let blocked = 0, htmlForFrame = "";
  if (hasHtml) {
    if (state.showRemote) htmlForFrame = m.html;
    else { const r = blockRemote(m.html); htmlForFrame = r.html; blocked = r.blocked; }
  }

  const mode = state.bodyMode === "auto" ? (hasHtml ? "html" : (hasText ? "text" : "raw")) : state.bodyMode;
  let bodyHtml;
  if (mode === "raw") bodyHtml = `<div class="body-wrap"><pre class="raw">${esc(m.raw)}</pre></div>`;
  else if (mode === "text" || (!hasHtml && hasText)) bodyHtml = `<div class="body-wrap"><pre class="body-text">${esc(m.text != null ? m.text : "(no plain-text body)")}</pre></div>`;
  else if (hasHtml) bodyHtml = `<div class="body-wrap"><iframe class="body" sandbox referrerpolicy="no-referrer"></iframe></div>`;
  else bodyHtml = `<div class="body-wrap"><pre class="body-text">(no readable body — use Raw to see source)</pre></div>`;

  const seg = `<div class="seg">
    <button data-mode="auto" class="${state.bodyMode === "auto" ? "on" : ""}">Rendered</button>
    <button data-mode="text" class="${state.bodyMode === "text" ? "on" : ""}" ${hasText ? "" : "disabled"}>Plain text</button>
    <button data-mode="raw" class="${state.bodyMode === "raw" ? "on" : ""}">Raw source</button>
  </div>`;

  const notice = (hasHtml && mode !== "raw" && mode !== "text" && blocked > 0 && !state.showRemote)
    ? `<div class="notice">🔒 Blocked ${blocked} remote resource${blocked > 1 ? "s" : ""} (images / tracking pixels).<button class="btn" id="loadRemote">Load remote content</button></div>` : "";

  let attHtml = "";
  if (m.attachments.length) {
    attHtml = `<div class="att-head">Attachments · ${m.attachments.length}</div><div class="att-grid">` +
      m.attachments.map((a, i) => {
        const tag = (a.mimeType.split("/")[1] || a.mimeType.split("/")[0] || "bin").slice(0, 4).toUpperCase();
        return `<div class="att">
          <div class="ic">${esc(tag)}</div>
          <div class="info"><div class="name" title="${esc(a.filename)}">${esc(a.filename)}</div>
            <div class="sub">${esc(a.mimeType)} · ${fmtSize(a.size)}</div></div>
          <div class="dl"><button class="btn accent" data-att="${i}">Download</button></div>
        </div>`;
      }).join("") + `</div>`;
  }

  viewEl.innerHTML = `
    <div class="envelope">
      <div class="subject"><div class="lbl">Subject</div><h2>${esc(m.subject || "(no subject)")}</h2></div>
      <div class="fields">
        ${field("From", m.from, true)}
        ${field("To", m.to, true)}
        ${field("Cc", m.cc, true)}
        ${field("Bcc", m.bcc, true)}
        ${field("Reply-To", m.replyTo, true)}
        ${m.date ? `<div class="field"><div class="k">Date</div><div class="v">${fmtDate(m.date)}</div></div>` : ""}
      </div>
    </div>
    <div class="bar">${seg}<button class="btn" id="dlEml">Save .eml</button></div>
    ${notice}
    ${bodyHtml}
    ${attHtml}`;

  if (mode !== "raw" && mode !== "text" && hasHtml) {
    const frame = viewEl.querySelector("iframe.body");
    if (frame) frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><base target="_blank">` +
      `<style>body{font-family:system-ui,Arial,sans-serif;margin:16px;color:#16202B;}</style></head><body>${htmlForFrame}</body></html>`;
  }

  viewEl.querySelectorAll(".seg button[data-mode]").forEach(b =>
    b.addEventListener("click", () => { if (!b.disabled) actions.setMode(b.dataset.mode); }));
  const lr = viewEl.querySelector("#loadRemote");
  if (lr) lr.addEventListener("click", () => actions.loadRemote());
  viewEl.querySelectorAll("button[data-att]").forEach(b =>
    b.addEventListener("click", () => { const a = m.attachments[+b.dataset.att]; actions.download(a.bytes, a.filename, a.mimeType); }));
  const de = viewEl.querySelector("#dlEml");
  if (de) de.addEventListener("click", () => actions.download(binStrToBytes(m.raw), doc.name || "message.eml", "message/rfc822"));
}
