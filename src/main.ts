import './styles/main.css';
import './styles/quick.css';
import { createApp } from './app/createApp';
import { registerServiceWorker } from './pwa';

createApp(document.querySelector<HTMLDivElement>('#app'));
void registerServiceWorker();
