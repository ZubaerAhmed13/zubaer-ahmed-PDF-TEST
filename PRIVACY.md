# Privacy

DocFlow Professional is designed for on-device browser processing.

The migrated core:

- does not upload PDF contents to a DocFlow server;
- does not configure analytics, telemetry, crash reporting or third-party trackers;
- stores favorites and recent-tool IDs in localStorage;
- uses browser Cache Storage for application assets required by offline use;
- creates temporary Blob URLs for generated downloads and revokes them when the workspace is reset or closed.

The application must not claim broader privacy guarantees for any future feature that introduces remote processing. Such a feature would require an explicit disclosure before use.
