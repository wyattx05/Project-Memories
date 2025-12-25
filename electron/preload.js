const { contextBridge, ipcRenderer } = require('electron');

/**
 * Preload script - Secure bridge between main and renderer processes
 * 
 * This script runs in a privileged context and exposes a limited API
 * to the renderer process through contextBridge. This maintains security
 * by keeping Node.js APIs isolated from the web content.
 */

// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electron', {
  /**
   * Select a folder using native dialog
   * @returns {Promise<{canceled: boolean, folderPath?: string, files?: Array, error?: string}>}
   */
  selectFolder: () => {
    return ipcRenderer.invoke('select-folder');
  },

  /**
   * Select a file using native dialog
   * @param {Object} options - Dialog options (title, filters)
   * @returns {Promise<{canceled: boolean, filePath?: string, content?: string, error?: string}>}
   */
  selectFile: (options) => {
    return ipcRenderer.invoke('select-file', options);
  },

  /**
   * Save memories data to persistent storage
   * @param {Object} data - Memories data to save
   * @returns {Promise<{success: boolean, path?: string, error?: string}>}
   */
  saveMemoriesData: (data) => {
    return ipcRenderer.invoke('save-memories-data', data);
  },

  /**
   * Load memories data from persistent storage
   * @returns {Promise<{success: boolean, data?: Object, error?: string}>}
   */
  loadMemoriesData: () => {
    return ipcRenderer.invoke('load-memories-data');
  },

  /**
   * Clear saved memories data
   * @returns {Promise<{success: boolean, message?: string, error?: string}>}
   */
  clearMemoriesData: () => {
    return ipcRenderer.invoke('clear-memories-data');
  },

  /**
   * Run a Python script with arguments
   * @param {string} scriptName - Name of the Python script to run
   * @param {Array<string>} args - Arguments to pass to the script
   * @returns {Promise<{success: boolean, output?: string, error?: string, exitCode: number}>}
   */
  runPythonScript: (scriptName, args) => {
    return ipcRenderer.invoke('run-python-script', scriptName, args);
  },

  /**
   * Check if Python is available on the system
   * @returns {Promise<{available: boolean, version?: string}>}
   */
  checkPython: () => {
    return ipcRenderer.invoke('check-python');
  },

  /**
   * Register a callback for Python script output
   * @param {Function} callback - Callback to receive output messages
   */
  onPythonOutput: (callback) => {
    ipcRenderer.on('python-output', (event, data) => {
      callback(data);
    });
  },

  /**
   * Remove Python output listener
   * @param {Function} callback - Callback to remove
   */
  removePythonOutputListener: (callback) => {
    ipcRenderer.removeListener('python-output', callback);
  },

  /**
   * Get application paths
   * @returns {Promise<{userData: string, temp: string, documents: string}>}
   */
  getAppPath: () => {
    return ipcRenderer.invoke('get-app-path');
  },

  /**
   * Read a file and return as data URL
   * @param {string} filePath - Path to the file
   * @returns {Promise<{success: boolean, dataUrl?: string, error?: string}>}
   */
  readFileAsDataUrl: (filePath) => {
    return ipcRenderer.invoke('read-file-as-data-url', filePath);
  }
});
