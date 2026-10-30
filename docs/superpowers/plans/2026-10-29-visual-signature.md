# Visual signature implementation plan

> Execute inline after the verified redaction milestone.

**Goal:** Draw or type a visual signature, place/move/size it on actual PDF pages, retain the draft through navigation and review the exact exported PDF.

**Architecture:** Reuse the existing pointer signature pad and direct-edit placement/history/model with a signature-only view. Typed marks are rendered from the pinned font into the same 720×210 PNG format as drawing. Existing certificate signatures are conservatively rejected; empty unsigned signature fields remain usable. Export is explicitly visual, not certificate-backed.

- [x] Observe failing browser journeys for typed/drawn placement, movement/history/draft retention, source-text preservation and exact output review; reject an empty signature and unsupported typed glyphs.
- [x] Add signature policy unit regressions: real signature dictionaries are detected/rejected in the signing path, empty unsigned signature fields are allowed.
- [x] Add signature-only mode/public placement API to `V2PageEditor`, preserving all existing editor behavior by default. Reuse normalized crop/rotation geometry and direct-edit worker export.
- [x] Preserve pad ink during navigation, support clear/typed alternatives, and initialise signature aspect ratio to the pad's ratio. Reuse exact-byte PDF result review.
- [ ] Run relevant browser tests, all current v2 Chromium journeys, units/typecheck/lint/build, fresh read-only review and new-head three-browser CI; publish exact tree.

Review focus: no fake certificate-validity claim, existing signed documents, typed font/shaping support, pad-load/clear races, stale async creation, page/zoom/crop alignment, unchanged original selectable text, and draft/history disposal. Physical-device and legal certificate signing remain separate acceptance work.
