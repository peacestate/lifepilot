/**
 * App entry. Registers the root component for Expo (dev client / prebuild).
 * Single screen in v1: Overwhelm Manager.
 */
import { registerRootComponent } from 'expo';

import App from './App';

registerRootComponent(App);
