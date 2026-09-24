import type { EditorApi } from '../shared/api';
declare global {
  interface Window {
    editor?: EditorApi;
  }
}
export {};
