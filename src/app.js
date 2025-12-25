/**
 * app.js - Business Logic for Snapchat Memories Viewer
 * 
 * This file contains all the core business logic for processing,
 * organizing, and displaying memories data. It's independent of Electron
 * and could work in a browser environment.
 */

// Global memories data
let memoriesData = [];

// Cache for location formatting
const locationCache = {};

/**
 * Parse date string from JSON (format: "2025-12-11 00:57:27 UTC")
 * @param {string} dateString - Date string to parse
 * @returns {Date} Parsed date object
 */
function parseMemoryDate(dateString) {
    if (!dateString) {
        return new Date(NaN);
    }
    const cleanDate = dateString.replace(' UTC', '').trim();
    const date = new Date(cleanDate);
    return date;
}

/**
 * Normalize coordinates by rounding to 2 decimal places for grouping
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @returns {string} Normalized coordinate string
 */
function normalizeCoordinates(lat, lon) {
    const roundedLat = Math.round(lat * 100) / 100;
    const roundedLon = Math.round(lon * 100) / 100;
    return `${roundedLat},${roundedLon}`;
}

/**
 * Get normalized location key for grouping similar locations
 * @param {string} locationString - Location string from memory data
 * @returns {string} Normalized location key
 */
function getNormalizedLocationKey(locationString) {
    if (!locationString) return 'Unknown location';
    
    const coordMatch = locationString.match(/Latitude, Longitude: ([\d.-]+), ([\d.-]+)/);
    if (!coordMatch) return locationString;
    
    const lat = parseFloat(coordMatch[1]);
    const lon = parseFloat(coordMatch[2]);
    return normalizeCoordinates(lat, lon);
}

/**
 * Get location name from memory object or format coordinates
 * @param {Object} memory - Memory object with location and locationName
 * @returns {string} Formatted location name
 */
function getLocationName(memory) {
    // Use pre-geocoded location name if available
    if (memory.locationName) {
        return memory.locationName;
    }
    
    const locationString = memory.location || (typeof memory === 'string' ? memory : null);
    if (!locationString) return 'Unknown location';
    
    const coordMatch = locationString.match(/Latitude, Longitude: ([\d.-]+), ([\d.-]+)/);
    if (!coordMatch) return locationString;
    
    const lat = parseFloat(coordMatch[1]);
    const lon = parseFloat(coordMatch[2]);
    const coordKey = normalizeCoordinates(lat, lon);
    
    // Check cache first
    if (locationCache[coordKey]) {
        return locationCache[coordKey];
    }
    
    // Format as nice coordinate display
    const latDirection = lat >= 0 ? 'N' : 'S';
    const lonDirection = lon >= 0 ? 'E' : 'W';
    const formattedLoc = `${Math.abs(lat).toFixed(2)}°${latDirection}, ${Math.abs(lon).toFixed(2)}°${lonDirection}`;
    
    locationCache[coordKey] = formattedLoc;
    return formattedLoc;
}

/**
 * Generate flashback items (random selection of memories)
 */
function generateFlashbacks() {
    const grid = document.getElementById('flashbacks-grid');
    grid.innerHTML = '';
    
    if (memoriesData.length === 0) {
        return;
    }
    
    // Get 4 random memories
    let flashbacks = [];
    const memoriesToChooseFrom = [...memoriesData];
    const count = Math.min(4, memoriesToChooseFrom.length);
    
    for (let i = 0; i < count; i++) {
        const randomIndex = Math.floor(Math.random() * memoriesToChooseFrom.length);
        flashbacks.push(memoriesToChooseFrom[randomIndex]);
        memoriesToChooseFrom.splice(randomIndex, 1);
    }
    
    flashbacks.forEach((memory) => {
        const item = document.createElement('div');
        item.className = 'flashback-item';
        const date = parseMemoryDate(memory.date);
        const monthYear = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        
        if (memory.mediaUrl) {
            const isVideo = memory.mediaName && (memory.mediaName.endsWith('.mp4') || memory.mediaName.endsWith('.mov') || memory.mediaName.endsWith('.webm'));
            item.innerHTML = `
                ${isVideo ? '<video style="width: 100%; height: 100%; object-fit: cover;"></video>' : '<img class="memory-item-thumbnail" style="width: 100%; height: 100%;">'}
                <div class="flashback-label">${monthYear}</div>
            `;
            if (isVideo) {
                item.querySelector('video').src = memory.mediaUrl;
            } else {
                item.querySelector('img').src = memory.mediaUrl;
            }
        } else {
            item.innerHTML = `
                <div class="placeholder"></div>
                <div class="flashback-label">${monthYear}</div>
            `;
        }
        
        item.addEventListener('click', () => {
            openMemoryModal(memory);
        });
        
        grid.appendChild(item);
    });
}

/**
 * Generate memory items for Recently Added section
 */
function generateMemories() {
    const grid = document.getElementById('memories-grid');
    grid.innerHTML = '';
    
    if (memoriesData.length === 0) {
        document.getElementById('empty-state').classList.add('show');
        return;
    }
    
    document.getElementById('empty-state').classList.remove('show');
    
    memoriesData.forEach((memory) => {
        const item = document.createElement('div');
        item.className = 'memory-item';
        const date = parseMemoryDate(memory.date);
        const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        
        if (memory.mediaUrl) {
            const isVideo = memory.mediaName && (memory.mediaName.endsWith('.mp4') || memory.mediaName.endsWith('.mov') || memory.mediaName.endsWith('.webm'));
            item.innerHTML = `
                <div class="memory-item-content">
                    ${isVideo ? '<video style="width: 100%; height: 100%; object-fit: cover;"></video>' : '<img class="memory-item-thumbnail">'}
                </div>
            `;
            if (isVideo) {
                item.querySelector('video').src = memory.mediaUrl;
            } else {
                item.querySelector('img').src = memory.mediaUrl;
            }
        } else {
            item.innerHTML = `
                <div class="memory-item-content">
                    <div class="placeholder"></div>
                </div>
            `;
        }
        
        item.title = `${dateStr} - ${memory.mediaType}`;
        item.addEventListener('click', () => {
            openMemoryModal(memory);
        });
        
        grid.appendChild(item);
    });
}

/**
 * Generate years view grouped by year and month
 */
function generateYears() {
    const container = document.getElementById('years-container');
    container.innerHTML = '';
    
    if (memoriesData.length === 0) {
        document.getElementById('years-empty-state').classList.add('show');
        return;
    }
    
    document.getElementById('years-empty-state').classList.remove('show');
    
    const yearMap = {};
    
    // Group memories by year and month
    memoriesData.forEach((memory) => {
        const date = parseMemoryDate(memory.date);
        const year = date.getFullYear();
        const month = date.getMonth(); // 0-11
        const monthName = date.toLocaleString('en-US', { month: 'long' });
        const monthKey = `${month}-${monthName}`;
        
        if (!yearMap[year]) {
            yearMap[year] = {};
        }
        if (!yearMap[year][monthKey]) {
            yearMap[year][monthKey] = [];
        }
        yearMap[year][monthKey].push(memory);
    });
    
    const sortedYears = Object.keys(yearMap).sort((a, b) => b - a);
    
    // Create year sections with month subsections
    sortedYears.forEach((year) => {
        const yearSection = document.createElement('div');
        yearSection.style.marginBottom = '20px';
        
        const yearHeader = document.createElement('div');
        yearHeader.className = 'group-header';
        const totalMemories = Object.values(yearMap[year]).reduce((sum, arr) => sum + arr.length, 0);
        yearHeader.textContent = `${year} (${totalMemories} memories)`;
        yearHeader.style.marginBottom = '12px';
        
        yearSection.appendChild(yearHeader);
        
        // Get months sorted in reverse order (newest first)
        const months = Object.keys(yearMap[year]).sort((a, b) => {
            const monthA = parseInt(a.split('-')[0]);
            const monthB = parseInt(b.split('-')[0]);
            return monthB - monthA;
        });
        
        // Create subsection for each month
        months.forEach((monthKey) => {
            const monthMemories = yearMap[year][monthKey];
            const monthName = monthKey.split('-')[1];
            
            const monthSection = document.createElement('div');
            monthSection.className = 'group-section';
            monthSection.style.marginLeft = '12px';
            monthSection.style.marginBottom = '16px';
            
            const monthHeader = document.createElement('div');
            monthHeader.className = 'group-header';
            monthHeader.textContent = `${monthName} (${monthMemories.length} memories)`;
            monthHeader.style.fontSize = '14px';
            monthHeader.style.marginBottom = '8px';
            
            const memoriesGrid = document.createElement('div');
            memoriesGrid.className = 'group-memories';
            
            monthMemories.forEach((memory) => {
                const item = document.createElement('div');
                item.className = 'memory-item';
                
                if (memory.mediaUrl) {
                    const isVideo = memory.mediaName && (memory.mediaName.endsWith('.mp4') || memory.mediaName.endsWith('.mov') || memory.mediaName.endsWith('.webm'));
                    item.innerHTML = `
                        <div class="memory-item-content">
                            ${isVideo ? '<video style="width: 100%; height: 100%; object-fit: cover;"></video>' : '<img class="memory-item-thumbnail">'}
                        </div>
                    `;
                    if (isVideo) {
                        item.querySelector('video').src = memory.mediaUrl;
                    } else {
                        item.querySelector('img').src = memory.mediaUrl;
                    }
                } else {
                    item.innerHTML = `
                        <div class="memory-item-content">
                            <div class="placeholder"></div>
                        </div>
                    `;
                }
                
                item.addEventListener('click', () => {
                    openMemoryModal(memory);
                });
                
                memoriesGrid.appendChild(item);
            });
            
            monthSection.appendChild(monthHeader);
            monthSection.appendChild(memoriesGrid);
            yearSection.appendChild(monthSection);
        });
        
        container.appendChild(yearSection);
    });
}

/**
 * Generate places view grouped by location
 */
function generatePlaces() {
    const container = document.getElementById('places-container');
    container.innerHTML = '';
    
    if (memoriesData.length === 0) {
        document.getElementById('places-empty-state').classList.add('show');
        return;
    }
    
    document.getElementById('places-empty-state').classList.remove('show');
    
    const locationMap = {};
    
    // Group memories by normalized location
    memoriesData.forEach((memory) => {
        const normalizedKey = getNormalizedLocationKey(memory.location);
        
        if (!locationMap[normalizedKey]) {
            locationMap[normalizedKey] = [];
        }
        locationMap[normalizedKey].push(memory);
    });
    
    // Sort locations by memory count (descending)
    const normalizedKeys = Object.keys(locationMap);
    const sortedLocations = normalizedKeys.sort((a, b) => {
        return locationMap[b].length - locationMap[a].length;
    });
    
    // Render locations
    sortedLocations.forEach((normalizedKey) => {
        const memoriesAtLocation = locationMap[normalizedKey];
        
        const section = document.createElement('div');
        section.className = 'group-section';
        
        const header = document.createElement('div');
        header.className = 'group-header';
        
        // Get location name
        const locationName = getLocationName(memoriesAtLocation[0]);
        header.textContent = `${locationName} (${memoriesAtLocation.length} memories)`;
        
        const memoriesGrid = document.createElement('div');
        memoriesGrid.className = 'group-memories';
        
        memoriesAtLocation.forEach((memory) => {
            const item = document.createElement('div');
            item.className = 'memory-item';
            
            if (memory.mediaUrl) {
                const isVideo = memory.mediaName && (memory.mediaName.endsWith('.mp4') || memory.mediaName.endsWith('.mov') || memory.mediaName.endsWith('.webm'));
                item.innerHTML = `
                    <div class="memory-item-content">
                        ${isVideo ? '<video style="width: 100%; height: 100%; object-fit: cover;"></video>' : '<img class="memory-item-thumbnail">'}
                    </div>
                `;
                if (isVideo) {
                    item.querySelector('video').src = memory.mediaUrl;
                } else {
                    item.querySelector('img').src = memory.mediaUrl;
                }
            } else {
                item.innerHTML = `
                    <div class="memory-item-content">
                        <div class="placeholder"></div>
                    </div>
                `;
            }
            
            item.addEventListener('click', () => {
                openMemoryModal(memory);
            });
            
            memoriesGrid.appendChild(item);
        });
        
        section.appendChild(header);
        section.appendChild(memoriesGrid);
        container.appendChild(section);
    });
}

/**
 * Open memory in modal
 * @param {Object} memory - Memory data to display
 */
function openMemoryModal(memory) {
    const modal = document.getElementById('memory-modal');
    const modalMedia = document.getElementById('modal-media');
    const date = parseMemoryDate(memory.date);
    const isVideo = memory.mediaName && (memory.mediaName.endsWith('.mp4') || memory.mediaName.endsWith('.mov') || memory.mediaName.endsWith('.webm'));
    
    modalMedia.innerHTML = '';
    
    if (memory.mediaUrl) {
        if (isVideo) {
            const video = document.createElement('video');
            video.src = memory.mediaUrl;
            video.controls = true;
            video.style.maxWidth = '100%';
            video.style.maxHeight = '100%';
            video.style.objectFit = 'contain';
            modalMedia.appendChild(video);
        } else {
            const img = document.createElement('img');
            img.src = memory.mediaUrl;
            img.style.maxWidth = '100%';
            img.style.maxHeight = '100%';
            img.style.objectFit = 'contain';
            modalMedia.appendChild(img);
        }
    } else {
        const placeholder = document.createElement('div');
        placeholder.textContent = 'No media file found';
        placeholder.style.color = '#666';
        modalMedia.appendChild(placeholder);
    }
    
    const locationElement = document.getElementById('metadata-location');
    const displayLoc = getLocationName(memory);
    
    document.getElementById('metadata-date').textContent = date.toLocaleString();
    document.getElementById('metadata-type').textContent = memory.mediaType;
    locationElement.textContent = displayLoc;
    document.getElementById('metadata-filename').textContent = memory.filename;
    
    modal.classList.add('show');
}

/**
 * Setup tab switching functionality
 */
function setupTabSwitching() {
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            document.querySelectorAll('.tab-content').forEach(content => {
                content.classList.remove('active');
            });

            const tabName = tab.getAttribute('data-tab');
            const tabContent = document.getElementById(`${tabName}-tab`);
            if (tabContent) {
                tabContent.classList.add('active');
            }
        });
    });
}

/**
 * Setup modal close functionality
 */
function setupModal() {
    const modal = document.getElementById('memory-modal');
    const closeBtn = document.getElementById('modal-close-btn');
    
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            modal.classList.remove('show');
        });
    }
    
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target.id === 'memory-modal') {
                modal.classList.remove('show');
            }
        });
    }
    
    // Python console modal
    const consoleModal = document.getElementById('python-console');
    const consoleCloseBtn = document.getElementById('console-close-btn');
    
    if (consoleCloseBtn) {
        consoleCloseBtn.addEventListener('click', () => {
            consoleModal.style.display = 'none';
        });
    }
    
    if (consoleModal) {
        consoleModal.addEventListener('click', (e) => {
            if (e.target.id === 'python-console') {
                consoleModal.style.display = 'none';
            }
        });
    }
}

/**
 * Setup theme toggle functionality
 */
function setupThemeToggle() {
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
        const savedTheme = localStorage.getItem('theme') || 'dark';
        
        if (savedTheme === 'light') {
            document.body.classList.add('light-mode');
            themeToggle.textContent = '☀️';
        } else {
            themeToggle.textContent = '🌙';
        }

        themeToggle.addEventListener('click', () => {
            document.body.classList.toggle('light-mode');
            const isDarkMode = !document.body.classList.contains('light-mode');
            themeToggle.textContent = isDarkMode ? '🌙' : '☀️';
            localStorage.setItem('theme', isDarkMode ? 'dark' : 'light');
        });
    }
}

/**
 * Initialize the app
 */
function initializeApp() {
    setupTabSwitching();
    setupModal();
    setupThemeToggle();
    
    generateFlashbacks();
    generateMemories();
    generateYears();
    generatePlaces();
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    initializeApp();
}
