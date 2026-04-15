const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  downloadFile: (url, filename) =>
    ipcRenderer.invoke('download-file', { url, filename }),

  copyImageToClipboard: (url) =>
    ipcRenderer.invoke('copy-image-to-clipboard', { url }),

  openExternal: (url) =>
    ipcRenderer.invoke('open-external', { url }),

  copyLocalToClipboard: (filePath) =>
    ipcRenderer.invoke('copy-local-to-clipboard', { filePath }),

  copyLocalToFolder: (filePath) =>
    ipcRenderer.invoke('copy-local-to-folder', { filePath }),

  openGifDialog: () =>
    ipcRenderer.invoke('open-gif-dialog'),

  listUserGifs: () =>
    ipcRenderer.invoke('list-user-gifs'),

  importGif: (sourcePath) =>
    ipcRenderer.invoke('import-gif', { sourcePath }),

  removeUserGif: (filePath) =>
    ipcRenderer.invoke('remove-user-gif', { filePath }),

  listFavorites: () =>
    ipcRenderer.invoke('list-favorites'),

  addFavorite: (gif) =>
    ipcRenderer.invoke('add-favorite', gif),

  removeFavorite: (id) =>
    ipcRenderer.invoke('remove-favorite', { id }),
});
