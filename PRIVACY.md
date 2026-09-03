# Privacy

DocFlow Professional is designed for on-device browser processing.

The migrated core:

- does not upload PDF contents to a DocFlow server;
- does not configure analytics, telemetry, crash reporting or third-party trackers;
- stores favorites and recent-tool IDs in `localStorage`;
- stores lightweight recovery state in IndexedDB: selected tool ID, tool settings, and file metadata (`name`, `size`, `type`, `lastModified`) only;
- does **not** store PDF/image file contents in `localStorage` or the project-recovery IndexedDB store;
- requires the user to reselect original files after restoring recovery state;
- uses browser Cache Storage for application assets required by offline use;
- creates temporary Blob URLs for generated downloads and revokes them when the workspace is reset or closed;
- runs Protect PDF and Unlock PDF in a local qpdf 12.3.2 WebAssembly worker bundled with the application;
- deliberately bypasses project-recovery autosave for Protect PDF and Unlock PDF, so password fields are not persisted by that recovery system;
- clears security password fields after completion/failure and when the security workspace closes.

Automated encryption certification checks that its known test password is absent from DocFlow localStorage and the project-state IndexedDB snapshot after a Protect PDF operation. This is evidence for those DocFlow-managed storage locations and the tested implementation; it is not a claim about browser extensions, operating-system memory, swap, device compromise, screenshots, or other software outside DocFlow's control.

The application must not claim broader privacy guarantees for any future feature that introduces remote processing. Such a feature would require an explicit disclosure before use.
