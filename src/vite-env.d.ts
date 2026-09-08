/// <reference types="vite/client" />

declare module '*?retry' {
  export const mountWorkspace: typeof import('./tools/workspace').mountWorkspace;
}
