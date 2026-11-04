const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("methodMeshDesktop", {
  openFile: (options) => ipcRenderer.invoke("files:open", options),
  openFolder: () => ipcRenderer.invoke("files:open-folder"),
  saveFile: (file) => ipcRenderer.invoke("files:save", file),
  requestTimestamp: (file) => ipcRenderer.invoke("timestamp:request", file),
  cancelTimestamp: (requestId) => ipcRenderer.invoke("timestamp:cancel", requestId),
  saveTimestampProof: (proof) => ipcRenderer.invoke("timestamp:save-proof", proof),
  verifyTimestamp: (input) => ipcRenderer.invoke("timestamp:verify", input),
  saveTimestampInPlace: (input) => ipcRenderer.invoke("timestamp:save-in-place", input),
  catalogue: () => ipcRenderer.invoke("runtime:catalogue"),
  adapterInventory: () => ipcRenderer.invoke("adapters:inventory"),
  loadRuntimeState: () => ipcRenderer.invoke("runtime:state"),
  saveRuntimeState: (state) => ipcRenderer.invoke("runtime:save-state", state),
  recordExecution: (execution) => ipcRenderer.invoke("runtime:record-execution", execution),
  commitResult: (execution) => ipcRenderer.invoke("runtime:commit-result", execution),
  executions: () => ipcRenderer.invoke("runtime:executions"),
  launchPlan: (target) => ipcRenderer.invoke("runtime:launch-plan", target),
  dueSchedules: () => ipcRenderer.invoke("runtime:due-schedules"),
  savePreset: (preset) => ipcRenderer.invoke("presets:save", preset),
  saveProtocol: (protocol) => ipcRenderer.invoke("protocols:save", protocol),
  saveSchedule: (schedule) => ipcRenderer.invoke("schedules:save", schedule),
  exportConfiguration: () => ipcRenderer.invoke("configuration:export"),
  importConfiguration: (bundle) => ipcRenderer.invoke("configuration:import", bundle),
  listArtifacts: () => ipcRenderer.invoke("artifacts:list"),
  exportArtifact: (artifact) => ipcRenderer.invoke("artifacts:export", artifact)
});
