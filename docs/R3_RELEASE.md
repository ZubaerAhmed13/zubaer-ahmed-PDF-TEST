# R3 — Mobile, offline and accessible operation (0.5.0)

## User journey

Open **Offline & storage** (or **Help & offline** inside a workspace), check stored core files, and explicitly prepare English/German OCR. Disconnect, reopen the application, import a PDF, edit or process it, and export a new copy. The original stays on the device. No document bytes are uploaded by offline setup.

## Delivered scope

- A generated per-release asset manifest enumerates core assets, the OCR worker, all three LSTM WebAssembly variants, and each language model (served as plain .traineddata to avoid host-dependent .gz decoding) with exact stored byte counts and SHA-256 digests. Download integrity is checked before a file is published by the preparation flow. Readiness verifies actual cache bodies against their lengths and digests rather than trusting a local flag. Core readiness includes both the reload shell and setup manifest and requires a controlling service worker.
- OCR assets are stored in a separate content-versioned cache. English/German share the worker/engine files, so preparing a second language only downloads its missing model. Setup reports bytes to store, browser usage/quota and persistence status. Downloads are cancellable; completed files remain reusable. Closing setup cancels the in-flight download. Failure, eviction, missing storage and insufficient quota remain visible and retryable.
- Offline OCR checks the selected language's cache before creating a recognition worker. A missing model produces an actionable error rather than an indefinite workspace. Existing-text pages can still skip recognition. OCR's existing page/rotation/script bounds remain unchanged.
- Service-worker navigation retains its installed shell until the existing multi-tab, work-aware update protocol activates the new release. Runtime cache-write failures do not discard a successful online asset response. Explicit preparation can bypass a damaged cached body and re-fetch it.
- Mobile editing offers separate **Pan page** and **Select objects** modes. Pan uses native browser scrolling and pinch magnification; zoom percentages remain available. On coarse pointers the editor initially uses Pan and a collapsed object inspector. A named Object properties action, object list, numerical controls and Move left/right/up/down buttons provide alternatives to dragging. Pointer cancellation restores the starting geometry rather than committing a partial drag.
- Dialogs use the visual viewport with a dynamic-height fallback, safe-area padding and focused-input visibility handling. The app does not disable native page zoom. Narrow screens use readable form text and 44 px actions (PDF form overlays keep their true geometry and retain a separate field-list alternative). Reduced motion and focus styling apply across workspaces. Raster install icons and an Apple touch icon supplement the SVG.
- Every main PDF-result renderer adds **Save / share** when file-sharing capability detection succeeds. Prepared Blob/File bytes are passed synchronously inside the click gesture. Cancelling or denying sharing retains the download link. Downloads remain available on browsers without file sharing. OS sharing sends the file only to a destination the user chooses; it is not cloud sync.

## Privacy and resource boundaries

Offline assets contain application code/fonts/engines/models only. Documents, edits, form values, passwords and signatures stay within the existing tab-memory lifecycle. Offline setup is not document recovery or backup. Export before closing or leaving the application in the background: the operating system can terminate a tab. Browser storage can be evicted; requesting persistence does not grant unlimited space. Setup stores roughly 6 MB of core files plus about 42 MB for English OCR or 34 MB for German OCR on this build (shared engine files count once; the UI uses exact generated sizes). No assets are downloaded merely to claim a language is ready.

## Automated verification

- Unit checks cover real cache-body truncation/eviction, checksum mismatch, incomplete downloads, cancellation before publication, retry, quota preflight, cache-write failure and missing reload-shell entries. Existing independent PDF output checks and multi-tab update checks remain release gates.
- R3 browser journeys cover narrow-screen offline reload → Unicode edit → download/reopen, non-drag move controls, pan-mode touch action, reduced-motion accessibility, real scanned-page OCR offline after explicit preparation, evicted-model errors, system-share cancellation/user activation/export size, cancelled pointer movement and landscape dialog geometry.
- The complete Chromium, Firefox and WebKit regression matrix runs before merge and again before Pages deployment. The deployed production suite includes the R3 journeys. CI artifacts retain the mobile screenshot and failure traces.

Chromium and Firefox use Playwright’s offline network mode. The existing WebKit forced-offline shim blocks newly created workers before the service worker can answer, so R3 denies all actual network requests through routing and reports the browser offline while still executing cached local workers. This exercises the no-network processing path; it is not a claim about physical Safari airplane mode.

Final run links and counts belong in the release PR after validation; this document alone is not a certificate.

## Acceptance still requiring physical systems

Automated mobile-size browsers are not physical-device certification. The following remain **not performed** here and must not be represented as passed:

| Target | Practical acceptance |
|---|---|
| Android Chrome and installed app | Real Files picker, native Save/share destination, airplane-mode core/OCR export, portrait/landscape, keyboard, background/resume, storage eviction |
| iPhone/iPad Safari and Home Screen app | Same journey, Files/download handling, pinch interaction, software keyboard and safe-area handling |
| VoiceOver (iOS/macOS) | Headings, reading/selection, form labels, object selection/properties, processing messages, modal focus and export |
| NVDA (Windows) | Keyboard-only journey, modal/focus restoration, reader text, field navigation, download and errors |

The declared automated offline core journey is opening/reading/editing a PDF and exporting it. All core engine files are enumerated, but arbitrary PDFs, every browser storage policy, all device-memory limits and every OS share target are not certified. Existing original-text editing, PDF preservation, manual Adobe/Preview, real-account cloud acceptance and hosting limitations remain documented in CAPABILITIES.md and earlier release records.

## References

- W3C Web Share: https://www.w3.org/TR/web-share/
- WebKit user activation: https://webkit.org/blog/13862/the-user-activation-api/
- Visual viewport: https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport
- WCAG 2.2: https://www.w3.org/TR/WCAG22/
