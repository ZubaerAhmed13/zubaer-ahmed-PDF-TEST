# U6 — Split PDF visual page selection

Scope: visually select pages for Split PDF without changing its tested, local PDF worker.

The shared U4 thumbnail picker now recognises Split. Users see numbered page thumbnails, per-page selection, Shift-click ranges, select-all and clear, and a local enlarged preview. Clicking a thumbnail or using the selection buttons changes the native Split mode to **Selected pages** and writes the existing `name=pages` field; the worker then creates the selected-pages output using exactly that range.

**Existing alternatives remain fully supported.** In Settings, users may still choose Ranges (semicolon-delimited groups), Every N pages, and Individual pages. When one of these modes is chosen, the selected-pages validation does not incorrectly block processing.

## Checks
- Four-page fixture with widths 300–303pt: click page 2, Shift-click page 4 → `pages=2-4`, `mode=selected`, resulting PDF pages 301/302/303pt.
- Change mode to ranges, set `1-2;3-4`, verify two PDFs in result ZIP with correct page widths.
- 390px mobile: no horizontal overflow, enlarged preview and focus restoration, invalid empty selected-pages run stopped without empty ZIP.
- Existing Remove/Extract picker tests and all platform browser tests must remain green.

No new conversion engine, cloud processing, AI service, or change to document semantics. No claim of certified accessibility until physical device testing.
