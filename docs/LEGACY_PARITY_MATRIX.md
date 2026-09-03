# Legacy Parity Matrix

Baseline: audited legacy `main` at `4c8f38831750102cd6fff49d145fed5d6409c4af`, as recorded in `docs/EXISTING_FEATURE_AUDIT.md`.

Parity is evaluated against capabilities that the audit classified as working, working/limited, partially working/fragile, or product infrastructure actually present in the legacy app. Items that the legacy audit itself marked only **Unverified** are not treated as proven legacy functionality, although several have since been implemented independently on the migration branch.

| Audited legacy capability | Legacy audit state | Professional branch state | Evidence / parity conclusion |
|---|---|---|---|
| Tool discovery/search | Working | Migrated | Search/filter plus Ctrl/Cmd+K covered by Playwright. |
| Recent tools | Working | Migrated | Local recent-tool state retained and tested with the modular shell. |
| Favorites | Unverified / missing | Migrated | Added beyond legacy baseline; local-only preference state. |
| Merge PDF | Working, unverified at scale | Migrated | Worker-backed merge with downloaded output reopened and validated. |
| Split PDF | Working, limited | Migrated | Range/selected/every-N/individual modes; ZIP/PDF outputs reopened. |
| Remove pages | Working | Migrated | Structural output reopened with selected-page geometry checks. |
| Extract pages | Working | Migrated | Structural output reopened with selected-page geometry checks. |
| Organize/reorder | Working, limited | Migrated | Visual lazy thumbnails, reorder, duplicate, delete, multi-select, undo/redo and structural reopen validation. |
| Rotate | Working, limited | Migrated | All/odd/even/selected modes with structural rotation and reopen validation. |
| Page numbers | Working, limited | Migrated | Configurable numbering export with reopen validation. |
| Watermark | Working, limited | Migrated | Text plus PNG/JPEG image watermarking with structural output validation. |
| Images → PDF | Working, limited | Migrated | JPEG/PNG conversion with valid PDF output validation. |
| PDF → Images | Working, limited | Migrated | Bounded page rendering to PNG/JPEG ZIP with artifact signature validation. |
| Extract Images | Partially working / fragile | Migrated | Decoded embedded-raster extraction with ZIP, PNG signature, manifest and dimension validation. |
| Compress PDF | Unverified quality | Limited but parity-preserving | Structural optimization exports a reopenable PDF. It remains explicitly **Limited** because professional image recompression is a separate new release gate. |
| PDF preview | Partially working | Migrated | Worker-backed PDF.js active-page preview and virtualized/lazy thumbnail rail. |
| PDF forms | Unverified | Migrated | Supported AcroForm matrix, flattening, reopen checks and explicit XFA rejection implemented beyond proven legacy evidence. |
| Encryption/password tools | Unverified | Migrated | Local qpdf AES-256 protect/unlock, wrong-password recovery, password non-persistence and cross-browser/offline evidence implemented beyond proven legacy evidence. |
| OCR | Unverified | Not implemented | No proven legacy workflow existed; OCR remains an explicit new professional-release capability gate and is not claimed as parity functionality. |
| Offline/PWA | Broken / unverified | Migrated foundation | Generated service worker/manifest, nested Pages scope, Chromium/Firefox offline worker flows and WebKit precache evidence. |
| Accessibility | Partial | Improved / still manually gated | Automated axe serious/critical gate, responsive checks and dialog focus containment/return exist. Manual WCAG 2.2 AA remains a release gate. |
| Mobile | Partial | Improved | Automated responsive overflow matrix at 360/768/1280 px. Real-device/manual accessibility verification remains separate. |
| CI/release gates | Missing | Added | `npm ci`, audit, typecheck, lint, unit tests, production build, bundle report and Chromium/Firefox/WebKit Playwright matrix. |

## Parity verdict

**Legacy functional parity is demonstrated for the capabilities actually observed as present in the audited legacy application.** The migration branch preserves or improves those workflows and adds independently certified capabilities that were previously unverified.

This parity verdict does **not** mean the product is a professional release. The following are deliberate release gates beyond legacy parity and remain tracked separately until completed with executed evidence:

- professional image recompression;
- OCR/text-layer generation;
- cryptographic digital-signature creation/validation;
- multi-gigabyte streaming/reference architecture and certification;
- heap-growth memory certification;
- manual WCAG 2.2 AA and real Safari/iOS forced-offline verification;
- color/fidelity certification where representation can change;
- production GitHub Pages verification.

Because parity is now documented and the full historical root remains preserved at `legacy/index.html`, the obsolete second entry point `pdf-all-in-one/index.html` can be removed from the migration branch without losing the rollback baseline.
