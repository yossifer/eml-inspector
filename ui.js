/**
 * mime.js — RFC 5322 / MIME parser for .eml messages.
 *
 * Pure, dependency-free, framework-free. This is the file you (or Claude Code)
 * will extend most often. It exports a single high-level function:
 *
 *   parseMessage(uint8) -> {
 *     headers,        // { 'header-name': 'value', ... } (lowercased keys)
 *     subject, from, to, cc, bcc, replyTo, date,   // decoded convenience fields
 *     html,           // string | null  (decoded HTML body, if present)
 *     text,           // string | null  (decoded plain-text body, if present)
 *     attachments,    // [{ filename, mimeType, disposition, bytes, size }]
 *     raw             // binary string of the original bytes (for "Save .eml")
 *   }
 *
 * To add .msg support later, write a sibling msg.js that returns the SAME shape,
 * and have app.js pick the parser by file extension / magic bytes. Everything
 * downstream (ui.js) only depends on that shape, so nothing else needs to change.
 */

/* ---------- byte / string helpers ---------- */
export function bytesToBinaryString(u8) {
  let s = ""; const C = 0x8000;
  for (let i = 0; i < u8.length; i += C) s += String.fromCharCode.apply(null, u8.subarray(i, i + C));
  return s;
}
export function binStrToBytes(str) {
  const b = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) b[i] = str.charCodeAt(i) & 0xff;
  return b;
}
function base64ToBytes(b64) {
  try {
    const bin = atob(b64.replace(/[^A-Za-z0-9+/=]/g, ""));
    const b = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
    return b;
  } catch (e) { return new Uint8Array(0); }
}
function qpToBytes(str) {
  str = str.replace(/=\r?\n/g, ""); // soft line breaks
  const out = [];
  for (let i = 0; i < str.length; i++) {
    if (str[i] === "=") {
      const hex = str.substr(i + 1, 2);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) { out.push(parseInt(hex, 16)); i += 2; continue; }
    }
    out.push(str.charCodeAt(i) & 0xff);
  }
  return new Uint8Array(out);
}
function pctToBytes(s) {
  const out = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "%" && /^[0-9A-Fa-f]{2}$/.test(s.substr(i + 1, 2))) { out.push(parseInt(s.substr(i + 1, 2), 16)); i += 2; }
    else out.push(s.charCodeAt(i) & 0xff);
  }
  return new Uint8Array(out);
}
function normCharset(cs) {
  if (!cs) return "utf-8";
  cs = cs.toLowerCase().trim().replace(/['"]/g, "");
  if (cs === "us-ascii" || cs === "ascii" || cs === "") return "utf-8";
  return cs;
}
function decodeText(bytes, charset) {
  try { return new TextDecoder(normCharset(charset)).decode(bytes); }
  catch (e) { try { return new TextDecoder("utf-8").decode(bytes); } catch (_) { return bytesToBinaryString(bytes); } }
}

/* ---------- RFC 2047 encoded words (=?utf-8?B?..?=) ---------- */
export function decodeWords(str) {
  if (!str) return "";
  str = str.replace(/(=\?[^?]+\?[BbQq]\?[^?]*\?=)\s+(?==\?[^?]+\?[BbQq]\?)/g, "$1");
  return str.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (m, cs, enc, txt) => {
    try {
      const bytes = enc.toUpperCase() === "B" ? base64ToBytes(txt) : qpToBytes(txt.replace(/_/g, " "));
      return decodeText(bytes, cs);
    } catch (e) { return m; }
  });
}

/* ---------- header + structure parsing ---------- */
function splitHeadersBody(raw) {
  const m = raw.match(/\r?\n\r?\n/);
  if (!m) return { headerText: raw, body: "" };
  return { headerText: raw.slice(0, m.index), body: raw.slice(m.index + m[0].length) };
}
function parseHeaders(headerText) {
  const unfolded = headerText.replace(/\r?\n[ \t]+/g, " ");
  const headers = {};
  for (const line of unfolded.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i === -1) continue;
    const k = line.slice(0, i).trim().toLowerCase();
    const v = line.slice(i + 1).trim();
    headers[k] = headers[k] !== undefined ? headers[k] + ", " + v : v;
  }
  return headers;
}
function parseContentType(val) {
  if (!val) return { type: "text/plain", params: {} };
  const segs = val.split(";");
  const type = segs[0].trim().toLowerCase();
  const params = {};
  for (let i = 1; i < segs.length; i++) {
    const eq = segs[i].indexOf("=");
    if (eq === -1) continue;
    params[segs[i].slice(0, eq).trim().toLowerCase()] = segs[i].slice(eq + 1).trim().replace(/^"|"$/g, "");
  }
  return { type, params };
}
function paramFrom(value, key) {
  if (!value) return null;
  let m = value.match(new RegExp(key + '\\s*=\\s*"([^"]*)"', "i"));
  if (m) return m[1];
  m = value.match(new RegExp(key + "\\s*=\\s*([^;\\s]+)", "i"));
  return m ? m[1] : null;
}
function decode2231(value, key) {
  if (!value) return null;
  const m = value.match(new RegExp(key + "\\*\\s*=\\s*([^;]+)", "i"));
  if (!m) return null;
  const v = m[1].trim().replace(/^"|"$/g, "");
  const parts = v.split("'");
  if (parts.length >= 3) {
    try { return decodeText(pctToBytes(parts.slice(2).join("'")), parts[0]); }
    catch (e) { try { return decodeURIComponent(v); } catch (_) { return v; } }
  }
  try { return decodeURIComponent(v); } catch (_) { return v; }
}
function getFilename(headers) {
  const cd = headers["content-disposition"] || "";
  const ct = headers["content-type"] || "";
  let fn = paramFrom(cd, "filename") || paramFrom(ct, "name");
  if (!fn) fn = decode2231(cd, "filename") || decode2231(ct, "name");
  return fn ? decodeWords(fn) : null;
}

function parsePart(raw) {
  const { headerText, body } = splitHeadersBody(raw);
  const headers = parseHeaders(headerText);
  const ct = parseContentType(headers["content-type"]);
  const part = { headers, ct, body, children: [] };
  if (ct.type.startsWith("multipart/") && ct.params.boundary) {
    for (const seg of splitMultipart(body, ct.params.boundary)) part.children.push(parsePart(seg));
  }
  return part;
}
function splitMultipart(body, boundary) {
  const delim = "--" + boundary;
  const lines = body.split(/\r?\n/);
  const parts = []; let cur = null;
  for (const line of lines) {
    if (line === delim || line === delim + "--") {
      if (cur !== null) parts.push(cur.join("\r\n"));
      if (line === delim + "--") { cur = null; break; }
      cur = [];
    } else if (cur !== null) cur.push(line);
  }
  return parts;
}

function decodePartBytes(part) {
  const enc = (part.headers["content-transfer-encoding"] || "").trim().toLowerCase();
  if (enc === "base64") return base64ToBytes(part.body);
  if (enc === "quoted-printable") return qpToBytes(part.body);
  return binStrToBytes(part.body);
}
const EXT = { "application/pdf": ".pdf", "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "text/calendar": ".ics", "application/zip": ".zip" };
function collect(part, acc) {
  if (part.ct.type.startsWith("multipart/")) { for (const c of part.children) collect(c, acc); return; }
  const disp = (part.headers["content-disposition"] || "").split(";")[0].trim().toLowerCase();
  const fn = getFilename(part.headers);
  const type = part.ct.type;
  const bytes = decodePartBytes(part);
  const isText = type === "text/plain" || type === "text/html";
  const isAttachment = disp === "attachment" || (!!fn && disp !== "inline") || (!!fn && !isText) || (!isText && type !== "");

  if (!isAttachment && type === "text/html" && acc.html === null) acc.html = decodeText(bytes, part.ct.params.charset);
  else if (!isAttachment && type === "text/plain" && acc.text === null) acc.text = decodeText(bytes, part.ct.params.charset);
  else acc.attachments.push({
    filename: fn || ("part-" + (acc.attachments.length + 1) + (EXT[type] || "")),
    mimeType: type || "application/octet-stream",
    disposition: disp || "inline",
    bytes, size: bytes.length
  });
}

/* ---------- public entry point ---------- */
export function parseMessage(uint8) {
  const raw = bytesToBinaryString(uint8);
  const tree = parsePart(raw);
  const acc = { html: null, text: null, attachments: [] };
  collect(tree, acc);
  const h = tree.headers;
  return {
    headers: h,
    subject: decodeWords(h["subject"] || ""),
    from: decodeWords(h["from"] || ""),
    to: decodeWords(h["to"] || ""),
    cc: decodeWords(h["cc"] || ""),
    bcc: decodeWords(h["bcc"] || ""),
    replyTo: decodeWords(h["reply-to"] || ""),
    date: h["date"] || "",
    html: acc.html, text: acc.text, attachments: acc.attachments,
    raw
  };
}
