const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const { spawn } = require('child_process');

let mainWindow;

/**
 * Create the main application window
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Snapchat Memories Viewer',
    webPreferences: {
      // Security: Enable context isolation and disable node integration
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // Required for file system access
      webSecurity: false // Allow loading local files
    },
    backgroundColor: '#000000',
    show: false // Show window only when ready
  });

  // Load the index.html file
  mainWindow.loadFile(path.join(__dirname, '../src/index.html'));

  // Show window when ready to avoid visual flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Handle window close
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * Get the user data directory path for storing app data
 */
function getAppDataPath() {
  return app.getPath('userData');
}

/**
 * Recursively read all files in a directory
 */
async function readDirectoryRecursive(dirPath) {
  const fileList = [];
  
  async function readDir(currentPath) {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      
      if (entry.isDirectory()) {
        await readDir(fullPath);
      } else if (entry.isFile()) {
        // Read file content as buffer for binary files or text for JSON
        const ext = path.extname(entry.name).toLowerCase();
        
        if (ext === '.json') {
          const content = await fs.readFile(fullPath, 'utf-8');
          fileList.push({
            name: entry.name,
            path: fullPath,
            type: 'json',
            content: content
          });
        } else if (['.jpg', '.jpeg', '.png', '.gif', '.mp4', '.mov', '.webm'].includes(ext)) {
          fileList.push({
            name: entry.name,
            path: fullPath,
            type: 'media',
            content: null // Media files are accessed directly by path
          });
        }
      }
    }
  }
  
  await readDir(dirPath);
  return fileList;
}

/**
 * Setup all IPC handlers - called once on app startup
 */
function setupIpcHandlers() {
  /**
   * IPC Handler: Read a file and return as base64 data URL
   */
  ipcMain.handle('read-file-as-data-url', async (event, filePath) => {
    try {
      const buffer = await fs.readFile(filePath);
      const ext = path.extname(filePath).toLowerCase();
      
      // Determine MIME type
      const mimeTypes = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.mp4': 'video/mp4',
        '.mov': 'video/quicktime',
        '.webm': 'video/webm'
      };
      
      const mimeType = mimeTypes[ext] || 'application/octet-stream';
      const base64 = buffer.toString('base64');
      
      return {
        success: true,
        dataUrl: `data:${mimeType};base64,${base64}`
      };
    } catch (error) {
      console.error('Error reading file:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * IPC Handler: Select a folder using native dialog
   */
  ipcMain.handle('select-folder', async () => {
    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
        title: 'Select Memories Folder'
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { canceled: true };
      }

      const folderPath = result.filePaths[0];
      
      // Read all files in the directory recursively
      const files = await readDirectoryRecursive(folderPath);
      
      return {
        canceled: false,
        folderPath: folderPath,
        files: files
      };
    } catch (error) {
      console.error('Error selecting folder:', error);
      return { error: error.message };
    }
  });

  /**
   * IPC Handler: Select a file using native dialog
   */
  ipcMain.handle('select-file', async (event, options = {}) => {
    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        title: options.title || 'Select File',
        filters: options.filters || [
          { name: 'JSON Files', extensions: ['json'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { canceled: true };
      }

      const filePath = result.filePaths[0];
      const content = await fs.readFile(filePath, 'utf-8');
      
      return {
        canceled: false,
        filePath: filePath,
        content: content
      };
    } catch (error) {
      console.error('Error selecting file:', error);
      return { error: error.message };
    }
  });

  /**
   * IPC Handler: Save memories data to app data directory
   */
  ipcMain.handle('save-memories-data', async (event, data) => {
    try {
      const appDataPath = getAppDataPath();
      const memoriesFilePath = path.join(appDataPath, 'memories-data.json');
      
      // Ensure the directory exists
      await fs.mkdir(appDataPath, { recursive: true });
      
      // Save the data
      await fs.writeFile(memoriesFilePath, JSON.stringify(data, null, 2), 'utf-8');
      
      return { success: true, path: memoriesFilePath };
    } catch (error) {
      console.error('Error saving memories data:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * IPC Handler: Load memories data from app data directory
   */
  ipcMain.handle('load-memories-data', async () => {
    try {
      const appDataPath = getAppDataPath();
      const memoriesFilePath = path.join(appDataPath, 'memories-data.json');
      
      // Check if file exists
      try {
        await fs.access(memoriesFilePath);
      } catch {
        return { success: false, error: 'No saved data found' };
      }
      
      // Read and parse the data
      const content = await fs.readFile(memoriesFilePath, 'utf-8');
      const data = JSON.parse(content);
      
      return { success: true, data: data };
    } catch (error) {
      console.error('Error loading memories data:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * IPC Handler: Clear saved memories data
   */
  ipcMain.handle('clear-memories-data', async () => {
    try {
      const appDataPath = getAppDataPath();
      const memoriesFilePath = path.join(appDataPath, 'memories-data.json');
      
      // Check if file exists
      try {
        await fs.access(memoriesFilePath);
        await fs.unlink(memoriesFilePath);
        return { success: true };
      } catch {
        return { success: true, message: 'No data to clear' };
      }
    } catch (error) {
      console.error('Error clearing memories data:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * IPC Handler: Run a Python script with arguments
   */
  ipcMain.handle('run-python-script', async (event, scriptName, args = []) => {
    return new Promise((resolve) => {
      try {
        // Determine Python executable (try python3 first, then python)
        const pythonCommand = process.platform === 'win32' ? 'python' : 'python3';
        const scriptPath = path.join(__dirname, '../python', scriptName);
        
        // Spawn the Python process
        const pythonProcess = spawn(pythonCommand, [scriptPath, ...args]);
        
        let output = '';
        let errorOutput = '';
        
        // Capture stdout
        pythonProcess.stdout.on('data', (data) => {
          const text = data.toString();
          output += text;
          // Send real-time output to renderer
          if (mainWindow) {
            mainWindow.webContents.send('python-output', text);
          }
        });
        
        // Capture stderr
        pythonProcess.stderr.on('data', (data) => {
          const text = data.toString();
          errorOutput += text;
          // Send real-time errors to renderer
          if (mainWindow) {
            mainWindow.webContents.send('python-output', text);
          }
        });
        
        // Handle process exit
        pythonProcess.on('close', (code) => {
          if (code === 0) {
            resolve({
              success: true,
              output: output,
              exitCode: code
            });
          } else {
            resolve({
              success: false,
              error: errorOutput || 'Python script exited with error',
              exitCode: code
            });
          }
        });
        
        // Handle process errors (e.g., Python not found)
        pythonProcess.on('error', (error) => {
          resolve({
            success: false,
            error: `Failed to start Python: ${error.message}. Please ensure Python 3 is installed.`,
            exitCode: -1
          });
        });
        
      } catch (error) {
        resolve({
          success: false,
          error: error.message,
          exitCode: -1
        });
      }
    });
  });

  /**
   * IPC Handler: Check if Python is available
   */
  ipcMain.handle('check-python', async () => {
    return new Promise((resolve) => {
      const pythonCommand = process.platform === 'win32' ? 'python' : 'python3';
      const pythonProcess = spawn(pythonCommand, ['--version']);
      
      let version = '';
      
      pythonProcess.stdout.on('data', (data) => {
        version += data.toString();
      });
      
      pythonProcess.stderr.on('data', (data) => {
        version += data.toString();
      });
      
      pythonProcess.on('close', (code) => {
        if (code === 0) {
          resolve({ available: true, version: version.trim() });
        } else {
          resolve({ available: false });
        }
      });
      
      pythonProcess.on('error', () => {
        resolve({ available: false });
      });
    });
  });

  /**
   * IPC Handler: Get app path
   */
  ipcMain.handle('get-app-path', () => {
    return {
      userData: app.getPath('userData'),
      temp: app.getPath('temp'),
      documents: app.getPath('documents')
    };
  });
}

/**
 * App lifecycle handlers
 */

// Create window when app is ready
app.whenReady().then(() => {
  setupIpcHandlers();
  createWindow();

  // On macOS, re-create window when dock icon is clicked
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed (except on macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Security: Prevent navigation to external URLs
app.on('web-contents-created', (event, contents) => {
  contents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);
    
    // Allow only file:// protocol
    if (parsedUrl.protocol !== 'file:') {
      event.preventDefault();
    }
  });
});
