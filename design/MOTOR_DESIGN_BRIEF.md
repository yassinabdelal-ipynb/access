# Motor view: design brief for Figma

Goal: a motor-accessibility view that feels monumental (huge, calm, confident, unmistakable) and, more importantly, costs fewer clicks. Input is a head pointer plus a RIGHT-eye wink held 3 seconds for one click, or a mouse/trackpad. Every click is expensive (about 3 s plus pointer travel), so fewer, bigger, safer clicks beat decoration.

Evidence behind this brief (measured on the current build, 1280x800 and 1366x768): targets are already 44-56 px with no gaps under 8 px; the sticky toolbar takes 156 px (about 20% of the height); the on-screen keyboard takes 406 px (about 51%); a 3-field form needs roughly 35 clicks (about 2-3 minutes, estimate). Native dropdowns and date pickers stay tiny. See the review in the conversation and `extension/access.css` (`.motor-*`).

## Design principles
1. **Clicks are the budget.** Design every screen by counting clicks to finish a task.
2. **Monumental targets.** Primary targets at least 72 px tall, secondary at least 56 px, 16 px between neighbours, hover state obvious from across the room.
3. **Feedback at the point of attention.** The wink-hold progress belongs in a ring around the pointer or the hovered target, not in a toolbar far away.
4. **Nothing floats over targets.** No message, toast or panel may sit on top of something the person may need to click.
5. **Safe by default.** Destructive or submitting actions show a large two-button confirmation; Cancel is the default.
6. **Keep the site's identity.** The site's fonts and colours stay; Access adds structure, scale and a single accent.

## Screens and components to design (frames at 1366x768 and 1920x1080, light and dark)
- **Top bar, one row, at most 72 px:** mode switch (Head control / Mouse), Recenter, state text, wink ring. Collapsible to a 40 px strip.
- **Page view:** large type (body at least 22 px), 24-32 px between targets, section headings as big anchors, full-width buttons for primary actions, links as 56 px rows.
- **Form view:** one field per row, label above, input at least 64 px tall; auto-advance to the next field; progress "Field 2 of 4".
- **Saved-details row** above the keyboard: tap to insert name, email, phone, address (stored locally, edited in a settings screen, never sent anywhere).
- **Keyboard:** 10-column QWERTY with a word-suggestion row (3 suggestions at 72 px), domain shortcuts (`@gmail.com`, `.com`), Shift, Space, Backspace; closes itself when the pointer leaves the field for 2 s; no "Done typing" click needed (button optional).
- **Option picker** replacing native dropdowns: full-screen sheet of big option buttons with the current choice marked.
- **Scroll rail:** Up, Down, Top, Bottom, plus Left/Right when needed; hover-to-scroll with a visible dwell fill.
- **Confirmation sheet:** two huge buttons, "Cancel" highlighted as default.
- **States for every target:** rest, pointer hover (strong outline plus fill), wink in progress (ring filling over 3 s), activated, disabled, error.
- **Empty and error states:** controller disconnected, face not found (calm, large, one action: "Use mouse / trackpad").

## Design tokens (make these Figma variables so code can read them)
Target sizes 56 / 72 / 96; spacing 16 / 24 / 32; radius 16 / 24; border 3; focus ring 4 px in a colour that passes 3:1 against any site background; text sizes 22 / 28 / 40 / 64; light and dark neutrals; one accent; success / warning / danger.

## Acceptance checks before it is built
- Complete the 3-field practice form in 20 clicks or fewer.
- Nothing is smaller than 56 px except the checkbox glyph (its row is 72 px).
- Top bar plus keyboard take at most 55% of a 1366x768 screen.
- Contrast: text 4.5:1, focus ring and borders 3:1 on both themes.
- Every frame works at 200% browser zoom.

## Hand-off
When the Figma file exists, point the implementation at the frame links; code should read the variables for sizes, spacing and colours instead of re-guessing them. After building, rerun `tests/motor.cjs`, `tests/browser.cjs`, `tests/extension.cjs` and the audit that measures target sizes and keyboard footprint.

## Figma file (built)
https://www.figma.com/design/8yrQzZeuZnYdMmFZXJ1ak2 ("Access - Motor view", drafts of the signed-in Figma account).

- **Cover**: what the file is.
- **Foundations**: Light and Dark specimens. Variables: collection Primitives (24 colours, hidden), Color (18 semantic colours, modes Light and Dark, code names like ar(--motor-action-primary)), Size (13 numbers: 	arget/min 56, 	arget/primary 72, 	arget/hero 96, space/8..48, adius/16..32, order/3, ing/4, code names like ar(--motor-target-primary)). Text styles: Display/64, Title/40, Heading/28 (Sora), Body/24, Label/22, Key/28, Caption/18 (Atkinson Hyperlegible).
- **Components**: Target / Button (3 kinds x 4 states), Keyboard / Key (6), Keyboard / Panel, Chip (saved detail, suggestion), Option card (4), Field / Large (2), Toolbar / Top (3 modes), Rail / Scroll, Sheet / Confirm. Built from variables, with component properties for labels.
- **Screens** (1366 wide): Form (full page), Form (typing, keyboard open), Page (stories), Confirm (submit), Form dark.

### Decisions made while designing (supersede the brief where they differ)
- Top bar is **88 px** tall (was 156), not 72: the 72 px buttons need 8 px of space above and below. It still collapses to a 40 px strip while typing.
- Keyboard panel is **443 px** tall; with the 40 px strip that is about 63% of a 1366x768 screen (about 45% at 1080 high). The acceptance target of 55% only holds at 1080 high or taller; on 768 the field being typed into stays visible above the keyboard.
- Keyboard has one chip row (saved details when the field is empty, word suggestions once typing starts), three letter rows and one bottom row. No number row: 123 switches the layer.
- Fonts: Sora (display) and Atkinson Hyperlegible (UI, designed for low vision). Both are open fonts; the extension must bundle them, because a content script cannot rely on Google Fonts under a site's CSP.