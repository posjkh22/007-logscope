const { contextBridge, ipcRenderer, webUtils } = require('electron');
const invoke = channel => (...args) => ipcRenderer.invoke(channel, ...args);
const subscribe = channel => callback => {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
contextBridge.exposeInMainWorld('logscope', {
  bootstrap: invoke('bootstrap'), choose: invoke('choose'), addPaths: invoke('add-paths'),
  demo: invoke('demo'), removeFile: invoke('remove-file'), removeFiles: invoke('remove-files'), clear: invoke('clear-workspace'),
  search: invoke('search'), findFile: invoke('find-file'), cancel: invoke('cancel'),
  readWindow: invoke('read-window'), statFile: invoke('stat-file'), reveal: invoke('reveal-file'),
  copy: invoke('copy'), export: invoke('export'), windowControl: invoke('window-control'),
  onSearch: subscribe('search-event'), onNotice: subscribe('notice'),
  pathsForFiles: items => Array.from(items).map(file => webUtils.getPathForFile(file)).filter(Boolean)
});
