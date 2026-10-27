# Access: project brief (current version, extension 0.3.0)

## 1. What it is, in one paragraph
Access is a Chrome/Edge extension plus a small local server. Click the Access icon on any website and the page you are on is replaced, in the same tab and at the same URL, by a redesigned version that fits how you can actually use it. It keeps the site's own colours, fonts, pictures and logo, and it throws nothing away. There are three tracks: **Focus** (ADHD, anxiety, fatigue), **Motor impairment** (head control and big targets, no precise mouse needed) and **Screen reader** (blind and low-vision). One optional **AI redesign** button asks Apify to read the whole site and then Claude to plan the page with that site map. Everything private stays on your computer: keys live only in a local `.env`, and the extension never talks to Anthropic, Apify or Figma directly.

## 2. The pieces
| Piece | Where | What it does |
|---|---|---|
| Extension (Manifest V3) | `extension/` | The product. Scans the page, draws the redesign over it, forwards your edits and clicks to the original page. Permissions: `activeTab`, `scripting`, `storage`, and host `http://127.0.0.1:4173/*` (the local server only). |
| Local server | `server.mjs` (+ `server/`) | Port 4173, listens on 127.0.0.1 only. Holds the Anthropic key and Apify token, relays AI and site-reading calls, bridges to the head-mouse program, serves the companion site. |
| Companion site | `app/` | The project page at `/` and demo pages (`demo.html`, `demo-menu.html`, `demo-rich.html`, `demo-tiles.html`, `demo-blind.html`) that run the same engine and UI in a normal page. Used for development and tests. |
| Head-mouse program | `eye-tracking/head-mouse/` (Python + MediaPipe) | Turns head movement into the mouse pointer and a held right-eye wink into a click. Started only when asked, runs hidden. |
| Design tokens | `design/tokens.json`, `scripts/` | The one palette. Generated into the extension, popup and site CSS. Synced with a Figma file. |
| Research | `eye-tracking/` | Gaze models and measurements (webcam gaze was 110 to 360 px off, so it is not the pointer). Git-ignored apart from small source files. |
| Tests | `tests/` | 15 suites (see section 12). |

How a click flows: toolbar icon → `background.js` injects `content.js` + `engine.js`, `reader.js`, `motor.js`, `ui.js` into the tab → `engine.js` scans the page → `ui.js` draws the redesign in a shadow-DOM overlay and marks the original page inert but alive → your actions go through `engine.activate/setValue/open` to the original page → closing Access removes the overlay and the original is back untouched.

## 3. Setup and running
1. `node server.mjs` in `D:\Calhacks` (prints `Access: http://127.0.0.1:4173 (AI ready), site reader ready` when the keys are found).
2. Load the extension: `edge://extensions` or `chrome://extensions`, Developer mode, Load unpacked, choose `D:\Calhacks\extension`. After changing extension files press the reload icon on its card. The extension works with the server stopped (only the AI, site-reading and head-control features need it).
3. Keys: copy `.env.example` to `.env` and fill in `ANTHROPIC_API_KEY=` (Claude) and `APIFY_TOKEN=` (site reading). You type them yourself; they are never pasted in chat. `.env` is git-ignored.
4. Apify, one time per account: open the Cheerio Scraper in Apify Console and approve its permissions (otherwise Apify answers 403 "full-permission-actor-not-approved" and Access shows a message saying so). This has been done for the current account.

## 4. How the redesign works
**Scan (`engine.js`).** Walks the page the way a reader would and turns it into plain data items (headings, text runs, links, fields, buttons, pictures, tables, charts, quotes, code, media cards, landmarks):
- Paragraphs keep their links, bold and italics inline; headings keep their links; tables keep caption, header and rows (links in cells too); inline SVG and canvas charts become pictures with colours baked in and their caption; a picture that is a link stays a picture; video, audio and frames become a card that points back to the original.
- It also captures the site's colours, fonts and brand header colour, and fields (label, type, required, options, validation state).
- Pages that draw things only on scroll are visited once, top to bottom, behind the overlay first. Cap 3000 items.
- Left out on purpose: decorative icons, hidden text, unlabelled hidden toggles, password and file fields.

**Designed page (`ui.js`, `access.css`).** A real-looking site in the site's own look: header band in the brand colour with logo, a few navigation links (the rest under "More") and search; a hero with title, intro and first picture; sections in a comfortable reading column with figures, captions, galleries, story cards and styled tables; a sticky side rail with "On this page"; a quiet footer.

**Acting on the original.** Typing and choosing in the redesign fires the original page's input/change events; buttons ask for confirmation (safe choice first); validation messages are mirrored back; a page-change observer re-scans after the page updates; targets that left the page are detected before acting. After the original page navigates, click the Access icon again.

**Themes and chrome.** Auto keeps the site as designed; Light and Dark restyle the page itself (logos get a backing) and the Access controls. The Access chrome is deliberately flat: a small dock ("Access settings") with Refresh, Focus, Motor impairment, Screen reader, Reading line (and thinner/thicker), text size, contrast, theme, Close, and the **AI redesign** button. Fonts: Atkinson Hyperlegible and Sora, bundled in `extension/fonts`.

## 5. The three tracks
### Focus
- **Slides.** Slide 1 is the whole designed page. Later slides hold only main content: text in chunks of about 50 words under their heading, up to 5 key points, a picture with its description and caption, story cards, a real form kept together, a table or chart on its own. Progress bar with minutes left, a Sections menu, arrow keys, a closing slide. Menus, links and search stay on slide 1. ALL-CAPS text becomes sentence case. Main content is found from the page's own landmarks, from Claude's ranges when AI is on, or by a text-and-image guess.
- **Reading line.** Dims everything except a band that follows the pointer (or keyboard focus).
- **AI plan.** See section 6.

### Motor impairment
- **Head control.** A slim toolbar: Head control, Mouse / trackpad, **Big tiles / Whole page**, **Advanced** (Recenter head, Dwell setting, Rest). The program follows one head: the nearest at first, then that same head; a nearer newcomer never takes over; if you are hidden the pointer waits, and after 1.5 s it picks the nearest again. Camera pictures never leave the Python program; only landmark numbers reach the page.
- **Click.** A deliberate right-eye wink held 3 seconds (`hold_seconds: 3`, meter in the toolbar), or dwell.
- **Face mask** (top right). A schematic face (outline, eyes, brows, nose, lips, 138 landmark dots) drawn from landmark numbers only, mirrored; the right eye lights while a wink is held. No camera image is ever shown or sent.
- **Whole page** (default). The designed page with larger text and targets.
- **Big tiles.** Two rows of tiles (about 370 x 188 px) in the extension's own plain palette. Menu-only sections merge into a Menu tile and tiny sections into Quick actions; each tile has a title, subtitle and counts. Opening a tile gives short steps (about one field or two buttons each), so nothing needs scrolling; long tables show five rows at a time; a lone button joins the step before it; after a button runs, the board jumps to whatever new text appeared. With consent already given, Claude writes clearer tile titles and subtitles (one small request per page, snippets only, never field values).
- **Dwell click.** Hold the pointer on a target and a ring fills at the pointer plus a sweep on the target. Default on for tiles only. Hovering alone never acts; looking away cancels; after a dwell the pointer must move 60 px before another can start; a real click or wink replaces the dwell so nothing runs twice; the board is not rebuilt while someone is aiming.
- **On-screen keyboard** opens when a text field is hovered or dwelled; the field is lifted above it. **Scroll zones** on the right edge (faster toward the edge) and **Back to top**. **Option picker** replaces tiny dropdowns. **Safe-first confirmation** ("No, go back" first and focused). **Rest** dims everything until Resume.
- Head control stops on tab hide, Escape, disconnect (watchdog) or leaving motor mode.

### Screen reader
- Rebuilds the page with real landmarks (banner, navigation, search, main, complementary, footer; sensibly invented when missing), one h1 and a heading outline without skipped levels, skip links, clear link purposes (generic "read more" gets context), named icon buttons, real tables with caption and `th scope`, figures with captions, links inside sentences.
- **Describe images** (optional, consent): the AI button in this mode asks Claude's vision to write alt text, long descriptions and text-in-image for pictures and unnamed icon buttons, clearly marked as automatically written. Image fetching is SSRF-safe (refuses private addresses, limits redirects, size and type).
- Not yet verified with a real screen reader or phone (`SCREENREADER.md`).

## 6. The AI redesign button (Apify + Claude in one step)
In Focus and Motor modes the dock's **AI redesign** button does everything in one click:
1. **One consent** ("Let Apify and Claude redesign this website?") explains both steps. Declining sends nothing to anyone. The choice is remembered (`siteConsent`, `aiConsent` in preferences). If the server has no Apify token, the button skips this and works with Claude alone (the older, Claude-only dialog).
2. **Apify reads the site** (section 7): menu items the page hides in drop-downs join the navigation; the site's other pages become an "Elsewhere on this site" section; the page's tiles and screen-reader view include them too.
3. **Claude plans the page** with the site map as context (site title, description, menu names and page titles; labels only, never addresses). Claude may only: name the `main` stretches, `hide` distractions (recoverable under "Hidden by Claude"; charts, tables and code can never be hidden), `collapse` side content, add short `chunks` headings, write one-line `gists` for long text, and label a stretch's purpose with `layout` (hero, article, cards, gallery, steps, data, callout, cta). It can never touch fields or buttons and cannot reword anything. `server/redesign.mjs` re-checks every id, locks controls, and caps every list.
4. Status line (also read by screen readers) reports what happened, e.g. "Claude organized this page: ... With Apify: 2 menu links the page was hiding and 5 other pages added." If Apify fails, the reason is shown and Claude still plans the page alone. Clicking the button again shows the standard redesign; the site data stays loaded.

Rulebooks (system prompts, with the W3C COGA / Section 508 / reading-ruler research they cite): `server/policies/focus.md`, `motor.md`, `screenreader.md`, `tiles.md`. Model: `claude-opus-5-5` (`server/redesign.mjs`, `server/describe.mjs`).

## 7. The Apify agent (`server/apify.mjs`)
- Runs the Apify **Cheerio Scraper** (`apify~cheerio-scraper`, `run-sync-get-dataset-items`) from the local server: start page plus same-site links in the header/nav, depth 1, at most 8 pages, 60-second timeout. A fixed page function extracts title, description, language, headings, links (flagged when in a nav) and JSON-LD.
- **What is sent to Apify:** only the page's web address, with query, fragment and credentials removed. Local, private, numeric, non-standard-port and intranet addresses are refused. The token goes in an Authorization header only (never in a URL or log).
- **What comes back** is treated as untrusted: cleaned to plain text, http(s) links only, short lengths. Cached 15 minutes per site; 12 reads per hour; one at a time.
- Errors are explained plainly: 401 token rejected, 403 approve the Actor's permissions, 402 out of credits, 408/504 too slow, 429 busy.
- Verified live on example.com and python.org (60 menu links, 7 further pages). Uses a little of your Apify credit per new site.

## 8. Design tokens and Figma
- `design/tokens.json` is the single source of truth: 10 colours in light and dark (bg, panel, line, text, muted, accent, accent-ink, focus, danger, ok), 4 radii (8/12/14/999) and the display font.
- `npm run tokens` (`scripts/build-tokens.mjs`) regenerates the CSS between `/* tokens:begin */` and `/* tokens:end */` in `extension/access.css`, `extension/popup.css` and `app/style.css`; `--check` fails if any of them has drifted.
- `npm run test:tokens` also checks 26 WCAG contrast pairs (text 4.5:1, focus ring 3:1, etc.) and light/dark key parity, and that the Figma export equals `tokens.json`.
- **Figma** file "Access Design Tokens" (key `QwpB8wl6Mo2Y2BvHXZxUPh`), variable collection "Access Tokens", modes Light and Dark, scopes and `var(--name)` code syntax set. `.mcp.json` registers the Figma MCP. Pull: Claude reads the collection into `design/figma-export.json`, then `npm run tokens:from-figma` (validates #rrggbb, unknown/missing colours, radius range, then updates `tokens.json`) and `npm run tokens`. Push: Claude writes `tokens.json` into the collection. The first push and read-back matched the code exactly.
- Figma is a design-time tool only. Nothing at run time calls Figma, so Figma cannot break the extension. The file is in the Figma account that was connected (Janisha Hota's), not yours; details in `design/FIGMA.md`.

## 9. Local server API (`server.mjs`)
All `/api/*` calls need a local origin and the `X-Access: 1` header (otherwise 403).

| Route | Purpose | Limit |
|---|---|---|
| `GET /api/status` | `{ai, site}`: whether the Anthropic key and Apify token are set | |
| `POST /api/redesign` | Claude plan or tile titles | 40 per hour |
| `POST /api/describe` | Claude vision for images and unnamed buttons | 40 per hour |
| `POST /api/site` | Apify site read (needs `consent: true`) | 12 per hour |
| `POST /api/motor` | Start/stop/status/recenter for the head-mouse program | |

The extension reaches these only through `background.js` messages (`AI_REDESIGN`, `AI_DESCRIBE`, `SITE_STATUS`, `SITE_READ`, `MOTOR_CONTROL`, `OPEN_ACCESS`). Static files are served only from the allowed folders (path traversal blocked).

## 10. Privacy and safety
- Anthropic key and Apify token only in the local `.env`; never in the extension, a URL, a log or chat.
- Consent dialog before the first AI request and before the first image description; one combined dialog for Apify + Claude.
- Field values and passwords are never sent; only short labels, headings and snippets are. Claude only ever gets labels from the site map, never addresses.
- Fields and submit buttons are never hidden or folded by AI; actions that may submit need confirmation.
- Camera frames stay inside the Python program. The server binds to 127.0.0.1.

## 11. File map
- `extension/`: engine.js (scan, act), ui.js (all views, ~2,000 lines), reader.js (screen-reader rebuild), motor.js (head-control client), content.js, background.js, popup.*, access.css, fonts, icons, manifest.json.
- `server.mjs`, `server/`: redesign.mjs, describe.mjs, apify.mjs, motor.mjs, policies/*.md.
- `app/`: project site and demo pages. `design/`: tokens.json, figma-export.json, FIGMA.md, MOTOR_DESIGN_BRIEF.md. `scripts/`: build-tokens.mjs, sync-from-figma.mjs.
- `eye-tracking/head-mouse/`: head_blink_mouse.py, face_lock.py, settings.json. `tests/`.
- Docs: README.md, MOTOR_ACCESS.md, SCREENREADER.md, GIT.md. `backups/` is old manual copies (git-ignored; git history replaces it; tags `snapshot-2026-10-24` and `motor-view-figma`).

## 12. Verification status (checked 2026-10-24)
- **15 of 15 suites pass:** `browser`, `extension` (real unpacked extension in Edge), `reader` (two files), `content` (nothing dropped, every track), `chrome`, `tiles`, `site`, `site-agent` (mocked Apify: consent, failure, recovered links, Claude context, tiles, screen reader), `apify` (mocked Apify: address-only, refusals, token handling, cleaning, cache, errors, route), `tokens`, `motor`, `motor-board`, `motor-bridge`, `face-lock`.
- Live checks done: Apify read of python.org and example.com; Claude plan on a live site map (returned a valid plan); access control (no header and foreign origin both 403); private address refused; token CSS in sync; all source files parse.
- **Not verified:** the full click-through in your own browser with live Apify + Claude together (each was checked live, the combined flow with mocks); any real screen reader or phone; a second real person in front of the camera (head-lock rules are tested with simulated faces); WCAG conformance (this is a prototype, not a claim).

## 13. Honest limits
- Top-document standard DOM only: no cross-origin frames, closed shadow roots, script-drawn widgets or multiple selects. Charts that only render after interaction and cross-origin canvases show as a card back to the original page.
- Browser settings/store pages block injection.
- Sending a click does not mean the task succeeded.
- Gaze is research only; head pointer plus wink or dwell is the working input.
- Apify and Anthropic are third parties and may use credits; the site reader reads public pages only (no sign-in areas).
- Not integrated: voice (Cartesia), gaze (iDirections).

## 14. Quick troubleshooting
- AI button does nothing: is `node server.mjs` running, and does it print "AI ready"?
- "Apify will not run the Cheerio Scraper yet": approve its permissions once in Apify Console.
- "Apify rejected the token": check `APIFY_TOKEN` in `.env`, restart the server.
- Extension changes not showing: press reload on its card, then click the icon again.
- Colours look off after editing `tokens.json`: run `npm run tokens`.
