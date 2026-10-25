# Motor impairment prototype

This mode uses **head movement for pointing** and **your RIGHT eye held closed for three seconds for one LEFT click**, with your left eye open. It uses the same MediaPipe detector and pointer smoothing that you confirmed working. It is not eye-gaze tracking.

## Start and use

1. Start the local app server: open a terminal in the project folder and run `node server.mjs`. It listens only at `http://127.0.0.1:4173`.
2. After this update, reload the unpacked Access extension in Chrome/Edge's extension manager **and refresh the webpage**. This replaces the older scripts already injected into that tab.
3. Open Access on the page, open **Access settings**, then select **Motor impairment**. The local ML Python controller starts automatically and loads the saved settings. Its camera/settings window minimizes to the taskbar. Keep one face visible and your head comfortably neutral during startup.
4. Use small head movements. Hold your RIGHT eye closed for three seconds, keeping the left open, to make one LEFT click. Reopen both eyes before the next click.
5. **Mouse / trackpad** pauses head movement and wink clicks. **Head control** resumes and sets a fresh neutral position. **Recenter head** resets the neutral position. Escape stops desktop control; F8 pauses/toggles while connected; F9 recenters; F10 toggles wink clicks. Normal hardware input is never blocked.
6. Hover **Scroll down/up** for about half a second to scroll; move away to stop. Horizontal buttons appear when the current scroll area overflows. Hover an editable text field for half a second (or focus it) to open the keyboard. Click its keys using your wink or mouse. Hovering keys does not type. **Done typing** closes the keyboard without submitting the form.

You can also test in the local app at `http://127.0.0.1:4173`. Motor impairment is separate from Focus. Reopening a saved Motor view starts head mode automatically once a stable face is detected. **Mouse / trackpad** or **Esc** explicitly pauses it; use **Head control** to re-enable automatic face recovery. Closing/hiding that page pauses head control; disconnection also pauses it within six seconds. A brief face loss stops movement and cancels the current wink; control recenters and resumes after your face returns. Camera errors and lost browser connections require explicit reactivation. The standalone Python launcher also starts on face detection; add `--paused` for TEST-only startup.

## Saved settings

`eye-tracking/head-mouse/settings.json` (created on first use; the defaults apply until then) loads on every Python launch. It holds the right-closed threshold (default **0.4566502463054187**), left-open maximum (**0.4517241379310345**), three-second hold, sensitivity, mirror setting, camera index and whether wink clicks are allowed. Valid slider changes save automatically. Invalid threshold combinations do not overwrite the last valid settings. Desktop-control enabled state is deliberately not saved. Sensitivity defaults to 1.1 with mirror on.

To adjust settings, restore the minimized head-mouse window from the taskbar. To launch it independently, first close the controller started by Access, then use `eye-tracking\head-mouse\start-head-blink-mouse.cmd`. Only one new controller can own its camera lock at a time. The old gaze models and recordings remain available.

## Claude policy and integration

The ready-to-use Claude system description is `server\policies\motor.md`. The app/extension sends `purpose: "motor"` to the existing `/api/redesign` endpoint. The server loads that policy, checks returned IDs, and preserves all content/actions/order: only section headings are accepted for this mode. It rejects hide/collapse/reorder/summary substitutions even if the model proposes them. The existing AI button handles consent. Motor controls work without an AI request. No live paid Claude call was needed for the checks.

`extension\motor.js` owns the keyboard, hover scrolling, large control bar and connection heartbeat. `server\motor.mjs` starts the fixed local Python script using the Python named by `ACCESS_PYTHON` in `.env` (default `python` on Windows, `python3` elsewhere; install `requirements.txt` into it). No shell commands or screen coordinates can be supplied through the browser API. Commands are limited to start/pause, status, heartbeat and recenter. The local controller receives JSON over stdin and sends numeric status over stdout; camera frames are not sent to the browser or Claude. Each view has an owner ID and increasing sequence number so a delayed start cannot override a newer pause. The Python watchdog also pauses when browser heartbeats stop.

## Scope and checks

Standard inputs, textareas, links and buttons retain the original engine's field mapping and events; final actions retain confirmation. Password/file inputs, embedded frames, contenteditable and other custom widgets may still require the original page. Date/select controls use their native controls. A webcam/head mouse cannot be guaranteed reliable for every person, pose or lighting condition.

Checks: `node tests/browser.cjs`, `node tests/extension.cjs`, `node tests/motor.cjs`, `node tests/motor-bridge.mjs`; Python: from `eye-tracking\head-mouse`, run the ML interpreter with `-m unittest test_auto_wink test_head_settings test_head_blink_mouse test_head_mouse`.

The new integration still needs your live pointing/clicking check in a redesigned page. Automated UI tests use a simulated controller; the actual camera smoke check reads live landmarks with desktop input disabled. These checks do not establish mouse accuracy or wink reliability in a new live session.



## Motor view redesign (2026-10-24, from the Figma file "Access - Motor view")
Design: https://www.figma.com/design/8yrQzZeuZnYdMmFZXJ1ak2 and `design/MOTOR_DESIGN_BRIEF.md`. Built in `extension/motor.js` and the motor block of `extension/access.css`.

- **One-row top bar, 88 px** (was 156): brand mark, Head, Mouse, Recenter, Details, one status line and a wink ring. It shrinks to a 40 px strip while the keyboard is open. Accessible names are unchanged ("Head control", "Mouse / trackpad", "Recenter head").
- **Wink ring**: fills over the 3 seconds in the top bar and also follows the pointer, so progress shows where you are looking.
- **Keyboard**: 96 x 72 keys, 8 px apart, one chip row on top. The row shows your **saved details** (name, email, phone, address), or **word suggestions** once you type, or **@gmail.com / @outlook.com / @icloud.com** after an email's first letters, or **Remember** to save what you just typed. It closes by itself 2 seconds after the pointer leaves it and the field; Done is still there. Open **Details** in the top bar to forget saved items. Saved details live in this extension's preferences on your computer only.
- **Option picker**: a `<select>` opens a full-screen sheet of 96 px option cards instead of the browser's tiny popup (click, Enter, Space or arrows; Escape cancels). Date and time pickers still use the browser's own controls.
- **Scroll rail**: Up and Down scroll while you hover (0.45 s fill), **Top** and **End** jump on a click, Left and Right appear only when needed.
- **Targets**: top-bar buttons, chips and keys are 72 px, option cards and rail buttons 96 px, page buttons and fields at least 72 px, links at least 56 px, text at least 22 px. Checkbox and radio glyphs are 40 px inside 72 px clickable rows.
- **Confirmation**: "Send this form?" with two huge buttons, "No, go back" first, ringed and focused, then "Yes, send it".
- **Messages never block clicks**: the toast ignores the pointer. Fonts Sora and Atkinson Hyperlegible (SIL Open Font License, files and licences in `extension/fonts`) ship with the extension.

Checks: `node tests/motor.cjs` (original behaviour, still passes) and `node tests/motor-view.cjs` (the new view, simulated controller). Real camera accuracy and real wink clicks in this new layout are not verified.

## Big-tile board (gaze and head friendly)

Motor mode opens on the **whole page** (as before). The **Big tiles** button switches to a **board** drawn in the extension's own plain palette (not the site's colours):

- **Tiles.** The page's sections become at most six giant tiles on one screen. Open one and its content is split into short **steps** (about one field or two buttons each), so nothing needs scrolling. "Whole page" returns to the full layout.
- **Dwell click.** Hold the pointer on a target and a ring fills at the pointer (plus a sweep on the target); when it completes the target is clicked. Hovering alone never acts, looking away cancels it, and after a dwell the pointer must move 60 px before another can start, so a still pointer never runs through several steps. The toolbar button cycles: tiles only (default: 1.2 s on the big tiles, off on the whole page where targets are small), 0.8 s, 1.2 s, 2 s and off. A real click or the 3 s wink on the same target replaces the dwell, so nothing runs twice.
- **Rest.** Dims the page and disables everything except "Resume" (itself a dwell target).
- **Option cards.** A dropdown opens a list of full-width cards; the original `<select>` is updated.
- **Safe-first confirmation.** "No, go back" comes first and has focus; "Yes, do it" second.
- **Keyboard.** Keys show symbols (shift, delete, enter), and the field being typed in is lifted above the keyboard once its height is known.

Why: webcam gaze is off by about 110-360 px in our own reports, so every target must be large, few, and never need precise scrolling. This is a head-pointer layout first; it is built so a gaze pointer can drive it later. It has been tested with a simulated pointer, not with live gaze.

Tests: `node tests/motor-board.cjs` (dwell flow) and `node tests/motor.cjs` (full-page fallback).


## Head control runs in the background
Choosing Head control starts the head-mouse process without showing any window: it is hidden from the screen and the taskbar, and uses the camera quietly. Esc, F8, F9 and F10 still work. The only thing you see is the face mask in the toolbar.

## Staying on one head
If more than one person is in the camera's view, head control follows one head only (`eye-tracking/head-mouse/face_lock.py`): the nearest at first (the face with the widest eye span), then the same head from frame to frame. Someone else walking in, even someone nearer, never takes over. If the original head is hidden for a moment the pointer waits rather than jumping to the other person; only after 1.5 seconds without the original does it pick the nearest again. The face mask follows the same head. `npm run test:facelock` tests the rules without a camera.

## Toolbar, Advanced and the face mask
The motor toolbar is one flat row: **Head control**, **Mouse / trackpad**, **Advanced**, the status, the right-wink meter, and a **face mask** at the top right. **Advanced** holds Recenter head, Dwell (tiles only, 0.8 s, 1.2 s, 2 s, off) and Rest. The mask is a schematic face (outline, eyes, brows, nose, lips and 138 landmark dots) drawn from landmark numbers only: the head-mouse process sends 276 numbers about 20 times a second to the local server, the page asks for them with each heartbeat (about 9 times a second) and smooths them, so the mask follows your head and your eyes and mouth. It is mirrored like a mirror, the right eye lights up while a right wink is being held, and no camera picture is ever sent or shown. It is hidden when head control is off.

## Tiles: size, grouping and titles
- Tiles are about 370 x 188 px, two rows of up to three, which is large enough to aim at without filling the screen.
- A tile is a section worth opening: menu-only sections are gathered into one **Menu** tile and tiny sections (a button and a line of text) into one **Quick actions** tile, so there are no tiles that hold a single button. A step that would hold only one button joins the step before it, and buttons are never stretched across the screen.
- Each tile says what is inside: a title from the content (the page's heading, or the first line, or the form's purpose), a subtitle (the fields to fill, the links you can follow, the first sentence) and small counts.
- With AI consent already given, Claude writes a clearer title and subtitle for every tile (one small request per page: only short snippets, never field values), shown on the tiles as soon as they arrive. Without consent a **Smart titles** button asks first. Without AI the built-in titles are used. `server/policies/tiles.md` is the rulebook.
