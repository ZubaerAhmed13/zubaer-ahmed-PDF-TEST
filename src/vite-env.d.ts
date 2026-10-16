/// <reference types="vite/client" />

declare const __DOCFLOW_VERSION__: string;
declare const __DOCFLOW_BUILD__: string;

declare module '*?retry' {
  export const mountWorkspace: typeof import('./tools/workspace').mountWorkspace;
}
