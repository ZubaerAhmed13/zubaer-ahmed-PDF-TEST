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
import './styles/editor-interaction-hardening.css';
import './styles/cloud-sync.css';
import './styles/editor-foundation.css';
import './styles/essential-utilities.css';
import './styles/phase3-documents.css';
import './styles/document-session.css';
import './styles/mobile-offline.css';
import './styles/document-quality.css';
import './styles/product-finish.css';
import { installMobileViewport } from './app/mobileViewport';
import { createApp } from './app/createApp';
import { finishEmailConfirmation } from './app/cloudSync';
import { installEditorLifecycleHardening } from './app/editorLifecycleHardening';
import { installPreEditPreview } from './app/preEditPreview';
import { installPreEditPreviewLabels } from './app/preEditPreviewLabels';
import { installLegacyExactLoopGuard } from './app/legacyExactLoopGuard';
import { installLegacyExactWorkspace } from './app/legacyExactWorkspace';
import { installLegacyIntegrationGuard } from './app/legacyIntegrationGuard';
import { installLegacyScreenshotParity } from './app/legacyScreenshotParity';
import { registerServiceWorker } from './pwa';

installMobileViewport();
createApp(document.querySelector<HTMLDivElement>('#app'));
void finishEmailConfirmation();
installEditorLifecycleHardening();
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
