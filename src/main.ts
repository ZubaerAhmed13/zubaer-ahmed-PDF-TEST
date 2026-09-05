import './styles/main.css';
import './styles/quick.css';
import './styles/preview.css';
import './styles/legacy-refresh.css';
import './styles/legacy-contrast.css';
import './styles/legacy-workspace.css';
import './styles/pre-edit-preview.css';
import './styles/state.css';
import { createApp } from './app/createApp';
import { installPreEditPreview } from './app/preEditPreview';
import { installPreEditPreviewLabels } from './app/preEditPreviewLabels';
import { registerServiceWorker } from './pwa';

createApp(document.querySelector<HTMLDivElement>('#app'));
installPreEditPreviewLabels();
installPreEditPreview();
void registerServiceWorker();
