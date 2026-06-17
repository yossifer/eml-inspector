# EML Inspector

A local-only `.eml` viewer built as an installable Progressive Web App (PWA). It shows full
headers (including **Cc / Bcc / Subject / Date**), renders the body in a sandboxed frame with
remote images blocked by default, and lets you download attachments. **No data ever leaves the
device** — there is no server, no upload, no account, and it works offline once installed.

It is built deliberately as a buildless, framework-free app: plain ES modules, no bundler, no npm
dependencies for the app itself. That keeps it easy to read and easy to extend (by you or by
Claude Code) as your team requests features.

---

## Why a PWA (and not just an HTML file)

The goal is "double-click an `.eml` in the ChromeOS Files app and it opens here." On ChromeOS that
requires the **File Handling API**, which only works for an *installed* PWA. A bare local HTML file
can't register itself as the handler for a file type. So the model is:

1. Host the app once over HTTPS (Firebase Hosting — see below).
2. Each teammate installs it (or you push it to everyone via the Google Admin console).
3. After install it runs locally and offline, and ChromeOS offers it under **Open with** for `.eml`.

The first time the OS launches the app to handle a file, Chrome shows a one-time permission prompt.
That's expected and only appears once per user.

---

## Project structure

```
eml-inspector/        (all files at the repo root — no subfolders)
├── index.html              app shell (markup only)
├── manifest.webmanifest    PWA manifest + file_handlers (the OS file association)
├── sw.js                   service worker (offline + installability)
├── mime.js                 MIME/RFC-5322 parser — exports parseMessage(); extend parsing here
├── ui.js                   rendering of the list + message view; extend UI here
├── app.js                  bootstrap: state, drag/drop, launchQueue, SW registration
├── app.css                 all styling (CSS variables at the top)
├── icon-192.png / icon-512.png / icon-maskable-512.png
├── .nojekyll               tells GitHub Pages to serve files as-is
└── README.md
```

**The one rule that keeps this maintainable:** parsing logic lives in `mime.js`, presentation lives
in `ui.js`. `ui.js` only depends on the *shape* that `parseMessage()` returns, so you can change one
without touching the other.

---

## Run it locally (development)

ES modules don't load from a `file://` path, so you need a tiny local server. From the project
folder:

```bash
npm run dev        # serves at http://localhost:8080  (uses npx serve, no install needed)
```

Then open http://localhost:8080. On `localhost`, install + service worker + file handling all work,
so you can test the full flow before deploying.

(If you prefer the ChromeOS Linux container: `python3 -m http.server 8080` works just as well.)

---

## Deploy to HTTPS (Firebase Hosting)

Firebase fits a Google Workspace environment and the free Spark tier is plenty for an internal tool.

```bash
# one time
npx --yes firebase-tools login
# create or pick a project at https://console.firebase.google.com, then put its id in .firebaserc
npm run deploy
```

You'll get a URL like `https://YOUR_PROJECT.web.app`. That URL is what people install.

Any static HTTPS host works (Cloud Storage static site, Netlify, Cloudflare Pages, GitHub Pages) —
Firebase is just the path of least resistance here. If you use a different host, make sure
`*.webmanifest` is served as `application/manifest+json` (Firebase config already does this).

---

## Install on a Chromebook + set as default for .eml

1. Visit the deployed URL in Chrome.
2. Click the **install icon** in the address bar (or ⋮ menu → *Install EML Inspector*).
3. Open the **Files** app, right-click any `.eml` → **Open with** → *EML Inspector*.
4. To make double-click work without the menu: right-click → **Open with** → **Change default** →
   *EML Inspector*. From then on, double-clicking an `.eml` opens it here.
5. Accept the one-time "open files with this app?" prompt.

---

## Roll it out to the whole team (Google Admin console)

Since you administer Google Workspace, you can push the installed app and its file association to
every managed Chromebook instead of having each person install it:

1. **Admin console → Devices → Chrome → Apps & extensions → Users & browsers** (pick the right OU).
2. Add a **web app** by its deployed URL and set **Installation policy = Force install**.
3. (Optional) Use a Chrome policy / app config to set EML Inspector as the default handler so users
   don't have to choose it themselves.

This deploys the file association centrally; managed devices skip the per-user install step. The
exact Admin console labels move around occasionally — if a menu name differs, search the Admin Help
for "force-install web app". Verify on one OU before rolling out broadly.

---

## Extending it

Bring the folder into VS Code with Claude Code and describe the change. Good first features your
team might ask for, and where they go:

- **"Extract all attachments at once" / zip them** → add a button in `ui.js`, add a bulk-download
  handler in `app.js`. (For zipping you'd add a small client-side zip step.)
- **Search across loaded messages** → add an input in `index.html`, filter `docs` in `app.js`.
- **Show the full raw header list as a table** → new render branch in `ui.js` (data is already in
  `msg.headers`).

### Adding `.msg` (Outlook) support later

`.msg` is **not** text like `.eml` — it's a binary Microsoft OLE compound-document format, so it
needs a real parser, not a tweak to `mime.js`. The clean way to add it:

1. Create `msg.js` that parses a `.msg` file and returns the **same object shape** as
   `parseMessage()` in `mime.js` (`headers`, `subject`, `from`/`to`/`cc`/`bcc`, `html`/`text`,
   `attachments`, `raw`).
2. In `app.js`, pick the parser by file extension (e.g. `name.endsWith(".msg") ? parseMsg : parseMessage`).
3. Add a `.msg` handler to `file_handlers` in `manifest.webmanifest`:
   ```json
   { "action": "./index.html",
     "accept": { "application/vnd.ms-outlook": [".msg"] },
     "icons": [ { "src": "./icons/icon-192.png", "sizes": "192x192", "type": "image/png" } ] }
   ```
4. Bump `CACHE` in `sw.js` and re-deploy. Because everything downstream only depends on the parser's
   return shape, `ui.js` needs no changes.

Because OLE parsing is fiddly, this is a good task to hand to Claude Code with a sample `.msg` file
to test against.

---

## Notes & limitations

- **Privacy:** parsing and rendering happen entirely in the browser. The sandboxed body frame has
  scripts disabled and remote images blocked until you click *Load remote content* — useful when
  triaging suspicious mail.
- **Coverage:** the parser handles the common real-world cases (multipart, base64 /
  quoted-printable, RFC-2047 encoded headers). Unusual or malformed messages may render oddly — use
  **Raw source** to inspect, and iterate on `mime.js` if needed.
- **Updates:** after changing any cached file, bump the `CACHE` version string in `sw.js` so clients
  pick up the new version.
