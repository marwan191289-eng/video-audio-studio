const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("desktopBridge", {
  isElectron: true,
});
