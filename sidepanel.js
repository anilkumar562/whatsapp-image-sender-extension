let manualImageFiles = [];
let autoJobs = [];
let mappingLower = new Map();
let baseFolderHandle = null;

let isRunning = false;
let sentCount = 0;
let failedCount = 0;
let failedImages = [];
let totalPlanned = 0;
let processedCount = 0;

const runModeInput = document.getElementById('runMode');
const manualSection = document.getElementById('manualSection');
const autoSection = document.getElementById('autoSection');
const selectFolderBtn = document.getElementById('selectFolder');
const folderInfo = document.getElementById('folderInfo');
const selectBaseFolderBtn = document.getElementById('selectBaseFolder');
const baseFolderInfo = document.getElementById('baseFolderInfo');
const mappingInfo = document.getElementById('mappingInfo');
const autoJobsInfo = document.getElementById('autoJobsInfo');
const startBtn = document.getElementById('startBtn');
const delayInput = document.getElementById('delay');
const captionInput = document.getElementById('caption');
const sendModeInput = document.getElementById('sendMode');
const batchSizeInput = document.getElementById('batchSize');
const progressSection = document.getElementById('progressSection');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const statsSection = document.getElementById('statsSection');
const sentCountEl = document.getElementById('sentCount');
const failedCountEl = document.getElementById('failedCount');
const pendingCountEl = document.getElementById('pendingCount');
const currentImageSection = document.getElementById('currentImage');
const currentImageName = document.getElementById('currentImageName');
const logContainer = document.getElementById('logContainer');
const statusMessage = document.getElementById('statusMessage');

runModeInput.addEventListener('change', () => {
  const isAuto = runModeInput.value === 'auto';
  manualSection.classList.toggle('hidden', isAuto);
  autoSection.classList.toggle('hidden', !isAuto);
  updateStartAvailability();
});

sendModeInput.addEventListener('change', () => {
  batchSizeInput.disabled = sendModeInput.value !== 'batch';
});

selectFolderBtn.addEventListener('click', async () => {
  try {
    const dirHandle = await window.showDirectoryPicker();
    manualImageFiles = await getImagesFromDirectory(dirHandle);

    if (manualImageFiles.length > 0) {
      folderInfo.textContent = `${manualImageFiles.length} images found`;
      addLog(`Manual folder loaded: ${manualImageFiles.length} images`, 'info');
    } else {
      folderInfo.textContent = 'No images found in folder';
      addLog('Manual folder has no images', 'error');
    }

    updateStartAvailability();
  } catch (err) {
    if (err.name !== 'AbortError') {
      showStatus('Error selecting folder: ' + err.message, 'error');
    }
  }
});

selectBaseFolderBtn.addEventListener('click', async () => {
  try {
    baseFolderHandle = await window.showDirectoryPicker();
    baseFolderInfo.textContent = `Base folder selected: ${baseFolderHandle.name}`;
    addLog(`Base folder selected: ${baseFolderHandle.name}`, 'info');
    await rebuildAutoJobs();
  } catch (err) {
    if (err.name !== 'AbortError') {
      showStatus('Error selecting base folder: ' + err.message, 'error');
    }
  }
});

startBtn.addEventListener('click', async () => {
  if (isRunning) {
    stopSending();
  } else {
    await startSending();
  }
});

runModeInput.dispatchEvent(new Event('change'));
sendModeInput.dispatchEvent(new Event('change'));
loadMappingFromRoot();
updateStartAvailability();

async function startSending() {
  const tab = await ensureWhatsAppTab();
  if (!tab) return;

  isRunning = true;
  sentCount = 0;
  failedCount = 0;
  failedImages = [];
  processedCount = 0;

  startBtn.textContent = 'Stop';
  startBtn.classList.add('stop');
  disableSelectors(true);

  progressSection.classList.remove('hidden');
  statsSection.classList.remove('hidden');
  currentImageSection.classList.remove('hidden');

  if (runModeInput.value === 'auto') {
    totalPlanned = autoJobs.reduce((sum, job) => sum + job.files.length, 0);
    addLog(`Auto run started: ${autoJobs.length} folder(s), ${totalPlanned} image(s)`, 'info');
    await processAutoJobs(tab.id);
  } else {
    totalPlanned = manualImageFiles.length;
    addLog(`Manual run started: ${totalPlanned} image(s)`, 'info');
    await processFilesForCurrentChat(tab.id, manualImageFiles, 'Manual folder');
  }

  if (isRunning) {
    finishSending();
  }
}

function stopSending() {
  isRunning = false;
  startBtn.textContent = 'Start Sending';
  startBtn.classList.remove('stop');
  disableSelectors(false);
  addLog('Stopped by user', 'info');
}

async function processAutoJobs(tabId) {
  for (const job of autoJobs) {
    if (!isRunning) return;

    currentImageName.textContent = `${job.folderName} -> ${job.chatName}`;
    addLog(`Opening chat "${job.chatName}" for folder "${job.folderName}"`, 'info');

    const openResponse = await Promise.race([
      chrome.tabs.sendMessage(tabId, { action: 'openChat', chatName: job.chatName }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Chat open timeout')), 20000))
    ]).catch(err => ({ success: false, error: err.message }));

    if (!openResponse || !openResponse.success) {
      failedCount += job.files.length;
      processedCount += job.files.length;
      failedImages.push(...job.files.map(f => `${job.folderName}/${f.name}`));
      addLog(`Chat open failed for "${job.chatName}": ${openResponse?.error || 'Unknown error'}`, 'error');
      updateProgress();
      showStatus(`Stopped: chat not opened (${job.chatName})`, 'error');
      stopSending();
      return;
    }

    await sleep(300);
    await processFilesForCurrentChat(tabId, job.files, `Folder ${job.folderName}`);
  }
}

async function processFilesForCurrentChat(tabId, files, contextLabel) {
  if (sendModeInput.value === 'batch') {
    await processFilesBatchMode(tabId, files, contextLabel);
  } else {
    await processFilesSingleMode(tabId, files, contextLabel);
  }
}

async function processFilesSingleMode(tabId, files, contextLabel) {
  for (let i = 0; i < files.length; i++) {
    if (!isRunning) return;

    const file = files[i];
    currentImageName.textContent = `${contextLabel}: ${file.name}`;
    // eslint-disable-next-line no-await-in-loop
    await sendOneFile(tabId, file, contextLabel);

    if (!isRunning) return;
    if (i < files.length - 1) {
      // eslint-disable-next-line no-await-in-loop
      await sleep(getDelayMs());
    }
  }
}

async function processFilesBatchMode(tabId, files, contextLabel) {
  const chunkSize = getBatchSize();

  for (let start = 0; start < files.length; start += chunkSize) {
    if (!isRunning) return;

    const end = Math.min(start + chunkSize, files.length);
    const chunk = files.slice(start, end);
    addLog(`${contextLabel}: fast chunk ${start + 1}-${end}`, 'info');

    for (let i = 0; i < chunk.length; i++) {
      if (!isRunning) return;

      const file = chunk[i];
      currentImageName.textContent = `${contextLabel}: ${file.name}`;
      // eslint-disable-next-line no-await-in-loop
      await sendOneFile(tabId, file, contextLabel);

      if (!isRunning) return;
      if (i < chunk.length - 1) {
        // eslint-disable-next-line no-await-in-loop
        await sleep(getBatchIntraDelayMs());
      }
    }

    if (!isRunning) return;
    if (end < files.length) {
      // eslint-disable-next-line no-await-in-loop
      await sleep(getDelayMs());
    }
  }
}

async function sendOneFile(tabId, file, contextLabel) {
  addLog(`Sending ${contextLabel}: ${file.name}`, 'info');

  try {
    const base64 = await fileToBase64(file);

    const response = await Promise.race([
      chrome.tabs.sendMessage(tabId, {
        action: 'sendImage',
        imageData: base64,
        fileName: file.name,
        mimeType: file.type,
        caption: getDefaultCaption()
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 30000))
    ]);

    if (response && response.success) {
      sentCount++;
      addLog(`Sent: ${file.name}`, 'success');
    } else {
      failedCount++;
      failedImages.push(`${contextLabel}/${file.name}`);
      addLog(`Failed: ${file.name} - ${response?.error || 'Unknown error'}`, 'error');
    }
  } catch (err) {
    failedCount++;
    failedImages.push(`${contextLabel}/${file.name}`);
    addLog(`Error: ${file.name} - ${err.message}`, 'error');
  }

  processedCount++;
  updateProgress();
}

function finishSending() {
  isRunning = false;
  startBtn.textContent = 'Start Sending';
  startBtn.classList.remove('stop');
  disableSelectors(false);

  addLog('All items processed', 'success');
  showStatus(`Completed. Sent: ${sentCount}, Failed: ${failedCount}`, 'success');

  if (failedImages.length > 0) {
    addLog(`Failed list: ${failedImages.join(', ')}`, 'error');
  }
}

async function ensureWhatsAppTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab || !tab.url || !tab.url.includes('web.whatsapp.com')) {
    showStatus('Open WhatsApp Web and select a chat tab first', 'error');
    return null;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, { action: 'ping' });
  } catch (e) {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });
    await sleep(300);
  }

  return tab;
}

async function rebuildAutoJobs() {
  autoJobs = [];

  if (!baseFolderHandle || mappingLower.size === 0) {
    autoJobsInfo.textContent = 'Select base folder and mapping JSON to prepare jobs';
    updateStartAvailability();
    return;
  }

  let totalFolders = 0;
  let mappedFolders = 0;
  let totalImages = 0;

  for await (const entry of baseFolderHandle.values()) {
    if (entry.kind !== 'directory') continue;
    totalFolders++;

    const folderName = entry.name;
    const chatName = mappingLower.get(folderName.toLowerCase());
    if (!chatName) continue;

    const files = await getImagesFromDirectory(entry);
    if (files.length === 0) continue;

    autoJobs.push({ folderName, chatName, files });
    mappedFolders++;
    totalImages += files.length;
  }

  autoJobsInfo.textContent = `${mappedFolders}/${totalFolders} folders mapped, ${totalImages} images ready`;
  addLog(`Auto jobs ready: ${mappedFolders} folders, ${totalImages} images`, 'info');
  updateStartAvailability();
}

async function loadMappingFromRoot() {
  try {
    const response = await fetch(chrome.runtime.getURL('mapping.json'));
    if (!response.ok) {
      throw new Error('mapping.json not found');
    }

    const parsed = await response.json();
    mappingLower = normalizeMapping(parsed);
    mappingInfo.textContent = `Mapping loaded: mapping.json (${mappingLower.size} entries)`;
    addLog(`Loaded mapping.json with ${mappingLower.size} entries`, 'info');

    await rebuildAutoJobs();
  } catch (err) {
    mappingLower = new Map();
    mappingInfo.textContent = 'Mapping load failed: check mapping.json';
    addLog(`Failed to load mapping.json: ${err.message}`, 'error');
    updateStartAvailability();
  }
}

function normalizeMapping(parsed) {
  const map = new Map();

  if (Array.isArray(parsed)) {
    for (const row of parsed) {
      if (!row || typeof row !== 'object') continue;
      const folder = String(row.folder || row.folderName || row.subfolder || '').trim();
      const chat = String(row.chat || row.chatName || row.group || '').trim();
      if (folder && chat) map.set(folder.toLowerCase(), chat);
    }
    return map;
  }

  if (parsed && typeof parsed === 'object') {
    for (const [folder, chat] of Object.entries(parsed)) {
      const folderName = String(folder || '').trim();
      const chatName = String(chat || '').trim();
      if (folderName && chatName) map.set(folderName.toLowerCase(), chatName);
    }
    return map;
  }

  throw new Error('Invalid mapping format');
}

async function getImagesFromDirectory(dirHandle) {
  const files = [];

  for await (const entry of dirHandle.values()) {
    if (entry.kind !== 'file') continue;
    const file = await entry.getFile();
    if (file.type.startsWith('image/')) {
      files.push(file);
    }
  }

  files.sort((a, b) => a.name.localeCompare(b.name));
  return files;
}

function updateProgress() {
  sentCountEl.textContent = sentCount;
  failedCountEl.textContent = failedCount;
  pendingCountEl.textContent = Math.max(0, totalPlanned - processedCount);

  const pct = totalPlanned > 0 ? (processedCount / totalPlanned) * 100 : 0;
  progressFill.style.width = `${pct}%`;
  progressText.textContent = `${processedCount} / ${totalPlanned}`;
}

function updateStartAvailability() {
  if (isRunning) return;

  if (runModeInput.value === 'auto') {
    startBtn.disabled = autoJobs.length === 0;
  } else {
    startBtn.disabled = manualImageFiles.length === 0;
  }
}

function disableSelectors(disabled) {
  runModeInput.disabled = disabled;
  selectFolderBtn.disabled = disabled;
  selectBaseFolderBtn.disabled = disabled;
  sendModeInput.disabled = disabled;
  batchSizeInput.disabled = disabled || sendModeInput.value !== 'batch';
  delayInput.disabled = disabled;
  captionInput.disabled = disabled;
}

function getDefaultCaption() {
  return (captionInput.value || '.').trim() || '.';
}

function getBatchSize() {
  const batchSize = parseInt(batchSizeInput.value, 10);
  if (!Number.isFinite(batchSize)) return 10;
  return Math.min(Math.max(batchSize, 1), 50);
}

function getDelayMs() {
  const seconds = parseInt(delayInput.value, 10);
  if (!Number.isFinite(seconds)) return 3000;
  return Math.min(Math.max(seconds, 1), 60) * 1000;
}

function getBatchIntraDelayMs() {
  return 120;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function addLog(message, type = 'info') {
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  logContainer.insertBefore(entry, logContainer.firstChild);

  while (logContainer.children.length > 100) {
    logContainer.removeChild(logContainer.lastChild);
  }
}

function showStatus(message, type) {
  statusMessage.textContent = message;
  statusMessage.className = `status-message ${type}`;

  if (type === 'success') {
    setTimeout(() => {
      statusMessage.textContent = '';
      statusMessage.className = 'status-message';
    }, 5000);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
