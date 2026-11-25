/// <reference types="vite/client" />
import type { SortBoxApi } from "../main/preload.cjs";

declare global {
  interface Window {
    sortbox: SortBoxApi;
  }
}

export {};
