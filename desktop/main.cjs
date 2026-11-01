const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  protocol,
} = require("electron");
const { randomUUID } = require("node:crypto");
const { constants } = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { registerSelectedMedia, serveMedia, validateVideoPath } = require("./media.cjs");
const { validateProject } = require("./project.cjs");
const projectExtension = ".frameforge";
const projectFileLimit = 5 * 1024 * 1024;
const exportFileLimit = 150 * 1024 * 1024;

protocol.registerSchemesAsPrivileged([
  {
    scheme: "frameforge",
    privileges: {
      standard: true,
      secure: true,
      corsEnabled: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);

function createWindow() {
  const window = new BrowserWindow({
    width: 1520,
    height: 980,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: "#101110",
    title: "FrameForge Studio",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    const applicationUrl = process.env.NODE_ENV === "development"
      ? "http://127.0.0.1:5173/"
      : pathToFileURL(path.join(__dirname, "..", "dist", "index.html")).href;
    if (url !== applicationUrl) event.preventDefault();
  });

  if (process.env.NODE_ENV === "development") {
    void window.loadURL("http://127.0.0.1:5173");
  } else {
    void window.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

ipcMain.handle("app:version", () => app.getVersion());
ipcMain.handle("media:open", async () => {
  const result = await dialog.showOpenDialog({
    title: "Import video",
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "Video", extensions: ["mp4", "m4v", "mov", "webm", "ogv"] },
    ],
  });
  return result.canceled ? [] : registerSelectedMedia(result.filePaths);
});
ipcMain.handle("media:register-dropped", async (_event, filePaths) => {
  if (
    !Array.isArray(filePaths) ||
    filePaths.length === 0 ||
    filePaths.length > 50
  ) {
    throw new Error("Drop between 1 and 50 video files at a time.");
  }
  return registerSelectedMedia(filePaths);
});
ipcMain.handle("project:save", async (_event, rawProject) => {
  const project = validateProject(rawProject);
  const result = await dialog.showSaveDialog({
    title: "Save FrameForge project",
    defaultPath: `${project.projectName.replace(/[^\p{L}\p{N} _-]/gu, "").slice(0, 80) || "Untitled"}.frameforge`,
    filters: [{ name: "FrameForge project", extensions: ["frameforge"] }],
  });
  if (result.canceled || !result.filePath) return false;
  const filePath = result.filePath.endsWith(projectExtension)
    ? result.filePath
    : `${result.filePath}${projectExtension}`;
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  const contents = JSON.stringify(project, null, 2);
  if (Buffer.byteLength(contents) > projectFileLimit) {
    throw new Error("The project is too large to save.");
  }
  try {
    await fs.writeFile(temporaryPath, contents, { flag: "wx", mode: 0o600 });
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true });
    throw error;
  }
  return true;
});
ipcMain.handle("project:open", async () => {
  const result = await dialog.showOpenDialog({
    title: "Open FrameForge project",
    properties: ["openFile"],
    filters: [{ name: "FrameForge project", extensions: ["frameforge"] }],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const stat = await fs.stat(result.filePaths[0]);
  if (stat.size > projectFileLimit) {
    throw new Error("The selected project file is too large.");
  }
  let project;
  try {
    project = JSON.parse(await fs.readFile(result.filePaths[0], "utf8"));
  } catch {
    throw new Error("The selected file is not valid FrameForge project JSON.");
  }
  return validateProject(project);
});
ipcMain.handle("export:save", async (_event, payload) => {
  if (
    !payload ||
    !(payload.bytes instanceof Uint8Array) ||
    payload.bytes.byteLength === 0 ||
    payload.bytes.byteLength > exportFileLimit
  ) {
    throw new Error("The WebM export is empty or exceeds the 150 MB limit.");
  }
  const result = await dialog.showSaveDialog({
    title: "Export composite",
    defaultPath: "FrameForge-export.webm",
    filters: [{ name: "WebM video", extensions: ["webm"] }],
  });
  if (result.canceled || !result.filePath) return false;
  const filePath = result.filePath.toLowerCase().endsWith(".webm")
    ? result.filePath
    : `${result.filePath}.webm`;
  const file = await fs.open(
    filePath,
    constants.O_CREAT | constants.O_WRONLY | constants.O_TRUNC | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await file.writeFile(Buffer.from(payload.bytes));
  } finally {
    await file.close();
  }
  return true;
});

app.whenReady().then(() => {
  protocol.handle("frameforge", (request) => serveMedia(request));
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
