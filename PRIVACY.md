# Privacy

DocFlow Professional is designed for on-device browser processing.

The application:

- does not upload PDF contents to a DocFlow server;
- optionally connects to the separate DocFlow Supabase project for email/password authentication and explicit Save/Restore of favorite/recent tool IDs; no PDF files, file metadata, forms, passwords used in PDFs, or recovery settings are sent;
- stores a cloud-login access and refresh session for the current tab in sessionStorage (sign out clears it); email/password credentials are submitted over HTTPS directly to Supabase Auth and are not stored by DocFlow;
- does not configure analytics, telemetry, crash reporting or third-party trackers;
- stores favorites and recent-tool IDs in `localStorage` by default; optional cloud sync requires sign-in and an explicit Save or Restore action;
- stores lightweight recovery state in IndexedDB: selected tool ID, tool settings, and file metadata (`name`, `size`, `type`, `lastModified`) only;
- does **not** store PDF/image file contents in `localStorage` or the project-recovery IndexedDB store;
- requires the user to reselect original files after restoring recovery state;
- uses browser Cache Storage for application assets required by offline use; explicit offline setup caches engine/font/model files, never imported documents; OCR models may also be cached by Tesseract in its own browser database;
- creates temporary Blob URLs for generated downloads and revokes them when the workspace is reset or closed;
- runs Protect PDF and Unlock PDF in a local qpdf 12.3.2 WebAssembly worker bundled with the application;
- deliberately bypasses project-recovery autosave for Protect PDF and Unlock PDF, so password fields are not persisted by that recovery system;
- clears security password fields after completion/failure and when the security workspace closes.

Automated encryption certification checks that its known test password is absent from DocFlow localStorage and the project-state IndexedDB snapshot after a Protect PDF operation. This is evidence for those DocFlow-managed storage locations and the tested implementation; it is not a claim about browser extensions, operating-system memory, swap, device compromise, screenshots, or other software outside DocFlow's control.

The application must not claim broader privacy guarantees for any future feature that introduces remote processing. Such a feature would require an explicit disclosure before use.


## In-memory document sessions

Optional document sessions hold the starting PDF, working revisions, page selection and pending results only in the current tab's memory. Export before closing or reloading the tab. Closing an individual tool keeps the applied document until the tab ends or New document is confirmed. Session content and history are not written to IndexedDB, localStorage, URLs or cloud preferences. Applied secure redaction removes previous session revisions/source previews; the original file on the user's device stays under their control. Service-worker update coordination exchanges boolean safety responses only, with no document names, contents or settings.

## System export

Save / share passes the generated file to the device sharing interface only after an explicit user click and browser capability checks. The user chooses its destination, which may be a third-party application or service. Cancelling leaves the local download available. This is separate from optional preference sync. Offline setup requests download application assets from the same host and can request persistent browser storage; storage remains evictable and export remains necessary for documents.
