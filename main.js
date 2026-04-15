const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const https = require('https');
const fs = require('fs');
const { execFile } = require('child_process');

// https.get wrapper that follows redirects (GIPHY redirects frequently)
function httpGet(url, callback, redirects = 0) {
  if (redirects > 5) { callback(null, new Error('Too many redirects')); return; }
  const mod = url.startsWith('https') ? https : require('http');
  mod.get(url, (res) => {
    if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
      res.resume();
      httpGet(res.headers.location, callback, redirects + 1);
    } else {
      callback(res, null);
    }
  }).on('error', (err) => callback(null, err));
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#1a1a2e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile('index.html');
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Download a file (GIF or MP4) to the designated folder
ipcMain.handle('download-file', async (event, { url, filename }) => {
  const downloadsPath = 'C:\\Users\\Dawid\\Desktop\\GIFY';
  fs.mkdirSync(downloadsPath, { recursive: true });
  const filePath = path.join(downloadsPath, filename);
  return new Promise((resolve) => {
    httpGet(url, (response, err) => {
      if (err) { resolve({ success: false, error: err.message }); return; }
      if (response.statusCode !== 200) {
        response.resume();
        resolve({ success: false, error: `HTTP ${response.statusCode}` });
        return;
      }
      const file = fs.createWriteStream(filePath);
      response.pipe(file);
      file.on('finish', () => { file.close(); resolve({ success: true, filePath }); });
      file.on('error', (e) => { fs.unlink(filePath, () => {}); resolve({ success: false, error: e.message }); });
    });
  });
});

// Copy GIF to clipboard as a file (CF_HDROP via PowerShell) so it pastes in Discord/Slack/etc.
ipcMain.handle('copy-image-to-clipboard', async (event, { url }) => {
  const tempDir = path.join(app.getPath('temp'), 'gif-search-clipboard');
  fs.mkdirSync(tempDir, { recursive: true });
  const tempPath = path.join(tempDir, `clip_${Date.now()}.gif`);

  return new Promise((resolve) => {
    httpGet(url, (response, err) => {
      if (err) { resolve({ success: false, error: err.message }); return; }
      if (response.statusCode !== 200) {
        response.resume();
        resolve({ success: false, error: `HTTP ${response.statusCode}` });
        return;
      }
      const file = fs.createWriteStream(tempPath);
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        // Use PowerShell to put the file on the clipboard (CF_HDROP)
        // This allows pasting as an animated GIF in Discord, Slack, Teams, etc.
        const escaped = tempPath.replace(/'/g, "''");
        const script = `Add-Type -AssemblyName System.Windows.Forms; $c = New-Object System.Collections.Specialized.StringCollection; $c.Add('${escaped}'); [System.Windows.Forms.Clipboard]::SetFileDropList($c)`;
        execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], (psErr) => {
          if (psErr) {
            resolve({ success: false, error: psErr.message });
          } else {
            // Keep temp file alive for 60s so the clipboard can access it after paste
            setTimeout(() => fs.unlink(tempPath, () => {}), 60000);
            resolve({ success: true });
          }
        });
      });
      file.on('error', (e) => resolve({ success: false, error: e.message }));
    });
  });
});

// Open a URL in the system default browser
ipcMain.handle('open-external', async (event, { url }) => {
  await shell.openExternal(url);
});

const USER_GIFS_DIR = path.join(__dirname, 'user-gifs');
const FAVORITES_FILE = path.join(__dirname, 'favorites.json');

function readFavorites() {
  try { return JSON.parse(fs.readFileSync(FAVORITES_FILE, 'utf8')); }
  catch { return []; }
}
function writeFavorites(favs) {
  fs.writeFileSync(FAVORITES_FILE, JSON.stringify(favs, null, 2));
}

ipcMain.handle('list-favorites', () => readFavorites());

ipcMain.handle('add-favorite', (event, gif) => {
  const favs = readFavorites();
  if (!favs.find(f => f.id === gif.id)) { favs.push(gif); writeFavorites(favs); }
  return { success: true };
});

ipcMain.handle('remove-favorite', (event, { id }) => {
  writeFavorites(readFavorites().filter(f => f.id !== id));
  return { success: true };
});
fs.mkdirSync(USER_GIFS_DIR, { recursive: true });

// List all GIFs stored in the user-gifs folder
ipcMain.handle('list-user-gifs', () => {
  return fs.readdirSync(USER_GIFS_DIR)
    .filter(f => f.toLowerCase().endsWith('.gif'))
    .map(f => ({ name: f, filePath: path.join(USER_GIFS_DIR, f) }));
});

// Copy a GIF into the user-gifs folder (deduplicates by name)
ipcMain.handle('import-gif', (event, { sourcePath }) => {
  const name = path.basename(sourcePath);
  let dest = path.join(USER_GIFS_DIR, name);
  // Avoid overwriting: append a counter if file already exists
  if (fs.existsSync(dest) && dest !== sourcePath) {
    const ext = path.extname(name);
    const base = path.basename(name, ext);
    let i = 1;
    while (fs.existsSync(path.join(USER_GIFS_DIR, `${base}_${i}${ext}`))) i++;
    dest = path.join(USER_GIFS_DIR, `${base}_${i}${ext}`);
  }
  try {
    if (sourcePath !== dest) fs.copyFileSync(sourcePath, dest);
    return { success: true, name: path.basename(dest), filePath: dest };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Delete a GIF from the user-gifs folder
ipcMain.handle('remove-user-gif', (event, { filePath }) => {
  try {
    fs.unlinkSync(filePath);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Open native file picker and return selected GIF paths
ipcMain.handle('open-gif-dialog', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Select GIF files',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'GIF Images', extensions: ['gif'] }],
  });
  return result.canceled ? [] : result.filePaths;
});

// Copy a local GIF file to clipboard as CF_HDROP via PowerShell
ipcMain.handle('copy-local-to-clipboard', async (event, { filePath }) => {
  const escaped = filePath.replace(/'/g, "''");
  const script = `Add-Type -AssemblyName System.Windows.Forms; $c = New-Object System.Collections.Specialized.StringCollection; $c.Add('${escaped}'); [System.Windows.Forms.Clipboard]::SetFileDropList($c)`;
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], (err) => {
      if (err) resolve({ success: false, error: err.message });
      else resolve({ success: true });
    });
  });
});

// Copy a local GIF file into the GIFY desktop folder
ipcMain.handle('copy-local-to-folder', async (event, { filePath }) => {
  const destFolder = 'C:\\Users\\Dawid\\Desktop\\GIFY';
  fs.mkdirSync(destFolder, { recursive: true });
  const filename = path.basename(filePath);
  const destPath = path.join(destFolder, filename);
  try {
    fs.copyFileSync(filePath, destPath);
    return { success: true, filePath: destPath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});
