/**
 * renderer.js - Electron-Specific Renderer Process Code
 * 
 * This file contains all Electron-specific functionality that bridges
 * the main process with the UI. It uses the APIs exposed through the
 * preload script to interact with Node.js features securely.
 */

/**
 * Setup clear memories button
 */
function setupClearMemories() {
    const clearBtn = document.getElementById('clear-btn');
    
    if (!clearBtn) return;
    
    clearBtn.addEventListener('click', async () => {
        try {
            // Check if electron API is available
            if (!window.electron) {
                alert('Electron API not available.');
                return;
            }
            
            // Confirm with user
            const confirmed = confirm('Are you sure you want to clear all memories? This cannot be undone.');
            
            if (!confirmed) {
                return;
            }
            
            // Clear from storage
            const result = await window.electron.clearMemoriesData();
            
            if (result.success) {
                // Clear in-memory data
                memoriesData = [];
                
                // Clear all displays
                document.getElementById('flashbacks-grid').innerHTML = '';
                document.getElementById('memories-grid').innerHTML = '';
                document.getElementById('years-container').innerHTML = '';
                document.getElementById('places-container').innerHTML = '';
                
                // Show empty states using classes
                const emptyState = document.getElementById('empty-state');
                if (emptyState) {
                    emptyState.classList.add('show');
                }
                
                const yearsEmptyState = document.getElementById('years-empty-state');
                if (yearsEmptyState) {
                    yearsEmptyState.classList.add('show');
                }
                
                const placesEmptyState = document.getElementById('places-empty-state');
                if (placesEmptyState) {
                    placesEmptyState.classList.add('show');
                }
                
                showNotification('All memories cleared');
            } else {
                alert(`Failed to clear memories: ${result.error}`);
            }
            
        } catch (error) {
            console.error('Error clearing memories:', error);
            alert(`Failed to clear memories: ${error.message}`);
        }
    });
}

/**
 * Setup folder selection using Electron's native dialog
 */
function setupFolderSelection() {
    const sourceBtn = document.getElementById('source-btn');
    
    if (!sourceBtn) return;
    
    sourceBtn.addEventListener('click', async () => {
        try {
            // Check if electron API is available
            if (!window.electron) {
                alert('Electron API not available. Please run this app in Electron.');
                return;
            }
            
            const result = await window.electron.selectFolder();
            
            if (result.canceled) {
                return;
            }
            
            if (result.error) {
                alert(`Error selecting folder: ${result.error}`);
                return;
            }
            
            // Process the files
            await processFiles(result.files, result.folderPath);
            
        } catch (error) {
            console.error('Error in folder selection:', error);
            alert(`Failed to select folder: ${error.message}`);
        }
    });
}

/**
 * Process files from the selected folder
 * @param {Array} files - Array of file objects
 * @param {string} folderPath - Path to the selected folder
 */
async function processFiles(files, folderPath) {
    // Clear existing memories
    memoriesData = [];
    
    // Create a map to match JSON files with their media files
    const fileMap = {};
    
    files.forEach(file => {
        const baseName = file.name.split('.')[0];
        if (!fileMap[baseName]) {
            fileMap[baseName] = {};
        }
        fileMap[baseName][file.name] = file;
    });
    
    // Process JSON files
    const jsonFiles = files.filter(f => f.type === 'json');
    
    for (const file of jsonFiles) {
        try {
            const data = JSON.parse(file.content);
            const baseName = file.name.split('.')[0];
            
            // Find matching media file
            let mediaFile = null;
            let mediaUrl = null;
            const mediaExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.mp4', '.mov', '.webm'];
            
            for (const ext of mediaExtensions) {
                const mediaName = baseName + ext;
                if (fileMap[baseName] && fileMap[baseName][mediaName]) {
                    mediaFile = fileMap[baseName][mediaName];
                    // Read file as data URL for proper loading in Electron
                    const result = await window.electron.readFileAsDataUrl(mediaFile.path);
                    if (result.success) {
                        mediaUrl = result.dataUrl;
                    }
                    break;
                }
            }
            
            memoriesData.push({
                filename: file.name,
                date: data['Date'] || '',
                mediaType: data['Media Type'] || 'Unknown',
                location: data['Location'] || 'Unknown location',
                locationName: data['Location Name'] || null,
                mediaFile: mediaFile,
                mediaUrl: mediaUrl,
                mediaName: mediaFile ? mediaFile.name : null
            });
        } catch (e) {
            console.error(`Failed to process ${file.name}:`, e);
        }
    }
    
    // Sort by date (newest first)
    memoriesData.sort((a, b) => {
        const dateA = parseMemoryDate(a.date);
        const dateB = parseMemoryDate(b.date);
        return dateB - dateA;
    });
    
    // Regenerate all views
    generateFlashbacks();
    generateMemories();
    generateYears();
    generatePlaces();
    
    // Save to persistent storage
    await saveMemoriesData();
}

/**
 * Save memories data to persistent storage
 */
async function saveMemoriesData() {
    if (!window.electron || memoriesData.length === 0) {
        return;
    }
    
    try {
        // Prepare data for saving (exclude blob URLs and file objects)
        const dataToSave = memoriesData.map(m => ({
            filename: m.filename,
            date: m.date,
            mediaType: m.mediaType,
            location: m.location,
            locationName: m.locationName,
            mediaName: m.mediaName,
            mediaPath: m.mediaFile ? m.mediaFile.path : null
        }));
        
        const result = await window.electron.saveMemoriesData(dataToSave);
        
        if (result.success) {
            showNotification('Data saved successfully');
        } else {
            console.error('Failed to save memories data:', result.error);
        }
    } catch (error) {
        console.error('Error saving memories data:', error);
    }
}

/**
 * Load memories data from persistent storage
 */
async function loadMemoriesData() {
    if (!window.electron) {
        return false;
    }
    
    try {
        const result = await window.electron.loadMemoriesData();
        
        if (!result.success) {
            return false;
        }
        
        // Restore memories data and reload media as data URLs
        memoriesData = [];
        for (const m of result.data) {
            let mediaUrl = null;
            if (m.mediaPath) {
                const fileResult = await window.electron.readFileAsDataUrl(m.mediaPath);
                if (fileResult.success) {
                    mediaUrl = fileResult.dataUrl;
                }
            }
            
            memoriesData.push({
                filename: m.filename,
                date: m.date,
                mediaType: m.mediaType,
                location: m.location,
                locationName: m.locationName,
                mediaName: m.mediaName,
                mediaFile: m.mediaPath ? { name: m.mediaName, path: m.mediaPath } : null,
                mediaUrl: mediaUrl
            });
        }
        
        // Regenerate all views
        generateFlashbacks();
        generateMemories();
        generateYears();
        generatePlaces();
        
        showNotification('Loaded saved memories');
        return true;
    } catch (error) {
        console.error('Error loading memories data:', error);
        return false;
    }
}

/**
 * Show a temporary notification to the user
 * @param {string} message - Message to display
 */
function showNotification(message) {
    // Create notification element
    const notification = document.createElement('div');
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background-color: #333;
        color: #fff;
        padding: 12px 20px;
        border-radius: 8px;
        z-index: 2000;
        animation: slideIn 0.3s ease-out;
    `;
    
    document.body.appendChild(notification);
    
    // Remove after 3 seconds
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease-out';
        setTimeout(() => {
            document.body.removeChild(notification);
        }, 300);
    }, 3000);
}

/**
 * Check if Python is available
 */
async function checkPythonAvailability() {
    if (!window.electron) {
        return;
    }
    
    try {
        const result = await window.electron.checkPython();
        
        if (!result.available) {
            showNotification('Warning: Python not found. Script features will not work.');
        }
    } catch (error) {
        console.error('Error checking Python:', error);
    }
}

/**
 * Run a Python script
 * @param {string} scriptName - Name of the script to run
 * @param {Array<string>} args - Arguments to pass to the script
 */
async function runPythonScript(scriptName, args = []) {
    if (!window.electron) {
        alert('Python scripts can only be run in Electron environment');
        return;
    }
    
    // Show console modal
    const consoleModal = document.getElementById('python-console');
    const consoleOutput = document.getElementById('console-output');
    consoleModal.style.display = 'flex';
    consoleOutput.textContent = 'Starting script...\n';
    
    try {
        // Setup output listener
        const outputCallback = (data) => {
            consoleOutput.textContent += data;
            // Auto-scroll to bottom
            consoleOutput.scrollTop = consoleOutput.scrollHeight;
        };
        
        window.electron.onPythonOutput(outputCallback);
        
        // Run the script
        const result = await window.electron.runPythonScript(scriptName, args);
        
        // Remove listener
        window.electron.removePythonOutputListener(outputCallback);
        
        if (result.success) {
            consoleOutput.textContent += '\n✓ Script completed successfully';
            showNotification('Script completed');
        } else {
            consoleOutput.textContent += `\n✗ Script failed: ${result.error}`;
            showNotification('Script failed');
        }
    } catch (error) {
        console.error('Error running Python script:', error);
        consoleOutput.textContent += `\n✗ Error: ${error.message}`;
    }
}

/**
 * Add CSS animations for notifications
 */
function addNotificationStyles() {
    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideIn {
            from {
                transform: translateX(100%);
                opacity: 0;
            }
            to {
                transform: translateX(0);
                opacity: 1;
            }
        }
        
        @keyframes slideOut {
            from {
                transform: translateX(0);
                opacity: 1;
            }
            to {
                transform: translateX(100%);
                opacity: 0;
            }
        }
    `;
    document.head.appendChild(style);
}

/**
 * Initialize Electron-specific functionality
 */
function initializeElectron() {
    // Add notification styles
    addNotificationStyles();
    
    // Setup folder selection
    setupFolderSelection();
    
    // Setup clear memories button
    setupClearMemories();
    
    // Check Python availability
    checkPythonAvailability();
    
    // Load saved data on startup
    loadMemoriesData();
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeElectron);
} else {
    initializeElectron();
}
