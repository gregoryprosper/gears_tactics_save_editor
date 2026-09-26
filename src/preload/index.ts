import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { EditorApi } from '../shared/api';
const api: EditorApi = {
  exportSoldier: (id, revision, index) =>
    ipcRenderer.invoke('editor:export-soldier', id, revision, index),
  prepareSoldierImport: (id, revision) =>
    ipcRenderer.invoke('editor:prepare-soldier-import', id, revision),
  cancelSoldierImport: (id, token) => ipcRenderer.invoke('editor:cancel-soldier-import', id, token),
  applySoldierImport: (id, revision, token, mode, target) =>
    ipcRenderer.invoke('editor:apply-soldier-import', id, revision, token, mode, target),
  settings: () => ipcRenderer.invoke('editor:settings'),
  updateSettings: (settings) => ipcRenderer.invoke('editor:update-settings', settings),
  current: () => ipcRenderer.invoke('editor:current'),
  open: () => ipcRenderer.invoke('editor:open'),
  openDropped: (file) => ipcRenderer.invoke('editor:open-dropped', webUtils.getPathForFile(file)),
  enableEditing: (id) => ipcRenderer.invoke('editor:enable', id),
  apply: (id, revision, changes) => ipcRenderer.invoke('editor:apply', id, revision, changes),
  history: (id, action) => ipcRenderer.invoke('editor:history', id, action),
  save: (id, saveAs) => ipcRenderer.invoke('editor:save', id, saveAs),
  inspect: (id, index) => ipcRenderer.invoke('editor:inspect', id, index),
  hex: (id, offset) => ipcRenderer.invoke('editor:hex', id, offset),
  strings: (id, query) => ipcRenderer.invoke('editor:strings', id, query),
  draftDirty: (dirty) => ipcRenderer.invoke('editor:draft-dirty', dirty),
};
contextBridge.exposeInMainWorld('editor', api);
