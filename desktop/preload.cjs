const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("frameforge", {
  getAppVersion: () => ipcRenderer.invoke("app:version"),
  openMedia: () => ipcRenderer.invoke("media:open"),
  registerDroppedMedia: (files) =>
    ipcRenderer.invoke(
      "media:register-dropped",
      files.map((file) => webUtils.getPathForFile(file)),
    ),
  saveProject: (project) => ipcRenderer.invoke("project:save", project),
  openProject: () => ipcRenderer.invoke("project:open"),
  saveExport: (bytes) =>
    ipcRenderer.invoke("export:save", { bytes: new Uint8Array(bytes) }),
});
