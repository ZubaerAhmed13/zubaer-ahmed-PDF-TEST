import './styles/main.css';
import './styles/quick.css';
import './styles/preview.css';
import './styles/legacy-refresh.css';
import './styles/legacy-contrast.css';
import './styles/legacy-workspace.css';
import './styles/state.css';
import { createApp } from './app/createApp';
import { registerServiceWorker } from './pwa';

createApp(document.querySelector<HTMLDivElement>('#app'));
void registerServiceWorker();
