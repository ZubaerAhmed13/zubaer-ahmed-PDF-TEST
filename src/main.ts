import './styles/main.css';
import './styles/quick.css';
import './styles/preview.css';
import './styles/legacy-refresh.css';
import './styles/legacy-contrast.css';
import './styles/legacy-workspace.css';
import './styles/pre-edit-preview.css';
import './styles/legacy-exact-workspace.css';
import './styles/legacy-screenshot-parity.css';
import './styles/state.css';
import { createApp } from './app/createApp';
import { installPreEditPreview } from './app/preEditPreview';
import { installPreEditPreviewLabels } from './app/preEditPreviewLabels';
import { installLegacyExactLoopGuard } from './app/legacyExactLoopGuard';
import { installLegacyExactWorkspace } from './app/legacyExactWorkspace';
import { installLegacyIntegrationGuard } from './app/legacyIntegrationGuard';
import { installLegacyScreenshotParity } from './app/legacyScreenshotParity';
import { registerServiceWorker } from './pwa';

createApp(document.querySelector<HTMLDivElement>('#app'));
installPreEditPreviewLabels();
installPreEditPreview();
// Install the integration guard before the legacy workspace observers so it can
// preserve recovery/status nodes and dialog lifecycle controls before the
// presentation adapters move or replace DOM nodes.
installLegacyIntegrationGuard();
installLegacyExactLoopGuard();
installLegacyExactWorkspace();
installLegacyScreenshotParity();
void registerServiceWorker();
