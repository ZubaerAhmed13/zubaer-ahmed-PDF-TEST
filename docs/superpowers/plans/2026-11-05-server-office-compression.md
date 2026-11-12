# Server Office and compression controls implementation plan

> For agentic workers: implement inline using executing-plans, then one bounded fresh review. Continue the authorized rebuild without another approval handoff.

**Goal:** Expose the already-verified server compression and DOCX/PPTX/XLSX conversion through the existing explicit-consent session UI.

**Architecture:** Reuse the verified account, consent and same-job recovery controller. Keep local compression as default. Add an Office conversion catalog entry only in explicitly configured server builds; it requires server consent and has no fake pre-conversion PDF preview. Keep the broker disabled except synthetic owners. No new infrastructure, VM start or snapshot rebuild.

**Spec:** Existing V2_REBUILD_MASTERPLAN.md engine strategy/R2 and PROCESSING_BACKEND_ACCEPTANCE.md; the OCR consent/recovery checkpoint at implementation 67fca54 supplies the lifecycle contract.

**Tech stack:** Existing TypeScript/Vite DOM shell, portable contracts, Supabase broker and pinned Vercel worker.

## Tasks

1. Add `src/v2/serverTools.ts` with settings/input validation that uses portable contracts before reading bytes. Normalize only empty/generic Office MIME from a supported extension; reject explicit mismatches, legacy/macro formats, oversize and invalid numeric settings. Write failing unit cases first.
2. Generalize `serverProcessing.ts` by operation with operation-specific settings/notices. Compression exposes quality 50–95, DPI 72–300 and dimension 900–5000; OCR retains English/German toggles. Office has no fictitious local processing or OCR controls. Fresh consent remains nonpersistent.
3. Connect compression mode and a gated Office catalog/upload/workspace/result. Preserve device mode by default and all current OCR recovery/navigation guards. Office metadata/extension is screened before reads and whole-document limits are explicit. Server results report measured input/output sizes, actual-PDF review and truthful operation-specific warnings; do not invent image counts absent from broker metadata.
4. Add intercepted browser journeys for server compression settings/actual size review, DOCX/PPTX/XLSX metadata and real returned PDF review, format/size rejection, original preservation and phone controls. Run full local checks and three-browser CI, fresh review, deploy exact implementation privately and retain evidence.

## Review focus

- Office file MIME is empty/generic or explicitly wrong; no silent reinterpretation of a mismatched type.
- Replacing a file while server status is uncertain cannot discard the original or permit a second start.
- Server compression result metadata lacks image counts; UI must not report zero recompressed as fact.
- Configured/unconfigured builds must retain all 29 original tools and truthful Office availability.
- Phones can reach consent, account and recovery controls without horizontal overflow or an unreachable Run button.

Ruling: reuse one lifecycle component rather than adding another server session implementation; the published races and tests remain shared requirements. Mode-switch setting retention will be refined with the related operation-selection work and browser coverage.

## Progress

Metadata/settings units were observed failing before the helper existed, then pass (4 cases). Full local verification: 285 units, typecheck, lint, build and provenance pass. Office source files stay unparsed before consent; generic MIME is normalized from DOCX/PPTX/XLSX only and validated by the portable contract. Server compressed results use actual measured input/output bytes and avoid absent image counts. The shared option capture now preserves temporarily unmounted server controls while excluding private consent; browser regression is pending. Fresh read-only review and expanded browser CI remain in progress. No VM or snapshot rebuild occurred.

Fresh read-only review found no important defects in settings/MIME/default mode/measured results/shared session guards. It flagged narrow mobile server controls as a minor; the controls and local fieldsets now span the available settings grid, with a phone width/screenshot regression. At 8e32864, all thirteen server UI journeys and the full Chromium suite pass (102 cases); quality and processing CI pass, Firefox/WebKit remain pending. The mode-switch corrections/consent regression passes in Chromium. The pending follow-up also ports two release checks: 240-page late-page addressing/real rotation output, and Chromium forced-GC repeated preview/export/disposal heap measurements (JS heap only, not native/GPU memory). No runtime memory claim until CI results are measured.

A Firefox CI retry exposed a concrete result action race: trace input at 110073ms showed a 300×150 preview canvas, and after the same click at 110380ms it was 700×420. The Return button moved under the pointer and the route stayed on the result. This was a new server return-to-edit test, not an unrelated editor-focus case. Result actions are now placed before the asynchronously sized preview. A controlled-worker browser regression holds rendering, presses the action, releases the preview, checks unchanged action position, then finishes the click and verifies the preserved workspace. The earlier run is recorded as 100 Firefox passes plus one retry, not an unqualified clean 101-pass result.
