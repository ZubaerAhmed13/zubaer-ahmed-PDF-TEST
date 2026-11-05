import './styles.css';
import { mountV2 } from './app';

import {finishEmailConfirmation} from '../app/cloudSync';
import {registerServiceWorker} from '../pwa';
void finishEmailConfirmation().then(()=>{mountV2(document.querySelector<HTMLDivElement>('#app'));void registerServiceWorker();});
