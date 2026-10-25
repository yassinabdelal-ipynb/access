# Figma and the design tokens

The colours and radii of Access live in one file, `design/tokens.json`. Everything visual is generated from it:

| File | What is generated |
|---|---|
| `extension/access.css` | the Access chrome and the tiles (light and dark) |
| `extension/popup.css` | the toolbar popup |
| `app/style.css` | the project site |

```
npm run tokens                  # write the CSS from tokens.json
npm run tokens:from-figma       # apply design/figma-export.json (a read of Figma) to tokens.json
npm run test:tokens             # CSS in sync, 26 WCAG contrast pairs, the Figma export matches
```

Change a colour in `tokens.json` (or in Figma), run the steps, and the extension, popup and site change together. The test refuses a palette whose text, muted text, links, buttons, errors or focus ring would be hard to read in light or dark.

## The Figma file

[Access Design Tokens](https://www.figma.com/design/QwpB8wl6Mo2Y2BvHXZxUPh) (file key `QwpB8wl6Mo2Y2BvHXZxUPh`) holds one variable collection, **Access Tokens**, with modes **Light** and **Dark**:

- 10 colours: `color/bg`, `panel`, `line`, `text`, `muted`, `accent`, `accent-ink`, `focus`, `danger`, `ok`, each with a sensible scope and the code syntax `var(--name)`.
- 4 radii: `radius/sm` 8, `md` 12, `lg` 14, `full` 999.

It was created from `tokens.json` through the Figma MCP, then read back; every value matched what the code already used.

## Figma MCP

`.mcp.json` registers the Figma MCP server for Claude Code in this folder. With it Claude can:

- **Push**: "Push the tokens to Figma." Creates or updates the collection from `tokens.json`.
- **Pull**: "Sync the tokens from Figma." Reads the collection, saves it as `design/figma-export.json`, runs `npm run tokens:from-figma` and `npm run tokens`.
- **Review**: "Put this redesign in Figma." Captures a redesigned page as editable layers.

Nothing in Figma is needed at run time. The extension never talks to Figma, so Figma cannot break it.

## Account note

The linked file is private to the Figma account that created it, so you will not be able to open it. To use your own: create a Figma file in your account (ask Claude with the Figma MCP to "push the tokens to Figma" and it will create the "Access Tokens" collection), then set `FIGMA_FILE_KEY` when running `tokens:from-figma` and update `source.figmaFileKey` in `design/tokens.json`.
