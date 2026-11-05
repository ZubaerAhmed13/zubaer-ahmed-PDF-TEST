import './styles.css';
import { mountV2 } from './app';

import {finishEmailConfirmation} from '../app/cloudSync';
void finishEmailConfirmation().then(()=>mountV2(document.querySelector<HTMLDivElement>('#app')));
