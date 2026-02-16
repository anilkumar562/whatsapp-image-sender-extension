let manualImageFiles = [];
let autoJobs = [];
let autoFolderResults = [];
let mappingLower = new Map();
let baseFolderHandle = null;

let isRunning = false;
let isPaused = false;
let sentCount = 0;
let failedCount = 0;
let failedImages = [];
let totalPlanned = 0;
let processedCount = 0;
let autoTotalFolderCount = 0;
let autoStaticSkippedCount = 0;
let autoCompletedCount = 0;
let autoIncompleteCount = 0;
let autoSkippedCount = 0;
let activeAutoFolderId = null;
let imageResults = [];
let currentRunStartedAt = null;
let lastRunReport = null;

const runModeInput = document.getElementById('runMode');
const manualSection = document.getElementById('manualSection');
const autoSection = document.getElementById('autoSection');
const autoFolderTableSection = document.getElementById('autoFolderTableSection');
const selectFolderBtn = document.getElementById('selectFolder');
const folderInfo = document.getElementById('folderInfo');
const selectBaseFolderBtn = document.getElementById('selectBaseFolder');
const baseFolderInfo = document.getElementById('baseFolderInfo');
const mappingInfo = document.getElementById('mappingInfo');
const autoJobsInfo = document.getElementById('autoJobsInfo');
const startBtn = document.getElementById('startBtn');
const pauseBtn = document.getElementById('pauseBtn');
const stopBtn = document.getElementById('stopBtn');
const exportBtn = document.getElementById('exportBtn');
const captionInput = document.getElementById('caption');
const useImageNameCaptionInput = document.getElementById('useImageNameCaption');
const fastModeToggle = document.getElementById('fastModeToggle');
const progressSection = document.getElementById('progressSection');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const autoSummarySection = document.getElementById('autoSummarySection');
const autoTotalFoldersEl = document.getElementById('autoTotalFolders');
const autoCompletedFoldersEl = document.getElementById('autoCompletedFolders');
const autoIncompleteFoldersEl = document.getElementById('autoIncompleteFolders');
const autoSkippedFoldersEl = document.getElementById('autoSkippedFolders');
const autoFolderListEl = document.getElementById('autoFolderList');
const currentImageSection = document.getElementById('currentImage');
const currentImageName = document.getElementById('currentImageName');
const logContainer = document.getElementById('logContainer');
const statusMessage = document.getElementById('statusMessage');
const liveSummaryEl = document.getElementById('liveSummary');
const actionMessageEl = document.getElementById('actionMessage');

runModeInput.addEventListener('change', () => {
  const isAuto = runModeInput.value === 'auto';
  manualSection.classList.toggle('hidden', isAuto);
  autoSection.classList.toggle('hidden', !isAuto);
  autoFolderTableSection.classList.toggle('hidden', !isAuto);
  autoSummarySection.classList.toggle('hidden', !isAuto);
  setActionMessage('');
  updateStartAvailability();
});

fastModeToggle.addEventListener('change', () => {
  if (!isRunning) {
    setActionMessage('');
  }
});

selectFolderBtn.addEventListener('click', async () => {
  try {
    if (!isRunning) {
      resetRunData();
    }
    const dirHandle = await window.showDirectoryPicker();
    manualImageFiles = await getImagesFromDirectory(dirHandle);

    if (manualImageFiles.length > 0) {
      folderInfo.textContent = `${manualImageFiles.length} images found`;
      addLog(`Manual folder loaded: ${manualImageFiles.length} images`, 'info');
      setActionMessage('');
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
    setActionMessage('');
    await rebuildAutoJobs();
  } catch (err) {
    if (err.name !== 'AbortError') {
      showStatus('Error selecting base folder: ' + err.message, 'error');
    }
  }
});

startBtn.addEventListener('click', async () => {
  await startSending();
});

pauseBtn.addEventListener('click', () => {
  if (!isRunning) return;
  isPaused = !isPaused;
  pauseBtn.textContent = isPaused ? 'Resume' : 'Pause';
  addLog(isPaused ? 'Paused' : 'Resumed', 'info');
  setActionMessage('');
  updateActionButtons();
  updateLiveSummary();
});

stopBtn.addEventListener('click', () => {
  if (!isRunning) return;
  stopSending();
});

exportBtn.addEventListener('click', () => {
  exportRunResult(false);
});

runModeInput.dispatchEvent(new Event('change'));
loadMappingFromRoot();
updateStartAvailability();
renderAutoFolderResults();
updateActionButtons();
updateLiveSummary();

async function startSending() {
  if (isRunning) return;
  resetRunData();
  const tab = await ensureWhatsAppTab();
  if (!tab) return;

  if (runModeInput.value === 'manual') {
    const chatCheck = await chrome.tabs.sendMessage(tab.id, { action: 'isChatOpen' }).catch(() => null);
    if (!chatCheck || !chatCheck.success || !chatCheck.isOpen) {
      setActionMessage('Manual mode requires an opened chat before starting');
      return;
    }
  }
  setActionMessage('');

  isRunning = true;
  isPaused = false;
  activeAutoFolderId = null;
  sentCount = 0;
  failedCount = 0;
  failedImages = [];
  processedCount = 0;
  autoCompletedCount = 0;
  autoIncompleteCount = 0;
  autoSkippedCount = 0;
  imageResults = [];
  currentRunStartedAt = new Date();
  lastRunReport = null;

  pauseBtn.textContent = 'Pause';
  disableSelectors(true);
  updateActionButtons();

  progressSection.classList.remove('hidden');
  currentImageSection.classList.remove('hidden');

  if (runModeInput.value === 'auto') {
    autoFolderResults = autoFolderResults.map(r => ({ ...r, sent: 0, failed: 0, status: 'pending' }));
    recalcAutoSummaryCounts();
    updateAutoSummary();
    renderAutoFolderResults();
    totalPlanned = autoJobs.reduce((sum, job) => sum + job.files.length, 0);
    addLog(`Auto run started: ${autoJobs.length} folder(s), ${totalPlanned} image(s)`, 'info');
    await processAutoJobs(tab.id);
  } else {
    totalPlanned = manualImageFiles.length;
    addLog(`Manual run started: ${totalPlanned} image(s)`, 'info');
    await processFilesForCurrentChat(tab.id, manualImageFiles, 'Manual folder', null, {
      folderName: 'manual',
      chatName: 'current-chat'
    });
  }

  if (isRunning) {
    finishSending();
  }
}

function stopSending() {
  const wasRunning = isRunning;
  isRunning = false;
  isPaused = false;
  activeAutoFolderId = null;
  disableSelectors(false);
  updateActionButtons();

  if (wasRunning && runModeInput.value === 'auto') {
    markPendingFoldersSkipped(0);
    recalcAutoSummaryCounts();
    updateAutoSummary();
    renderAutoFolderResults();
  }

  if (wasRunning) {
    finalizeRunReport('stopped');
    exportRunResult(true);
  }

  addLog('Stopped by user', 'info');
  updateLiveSummary();
}

async function processAutoJobs(tabId) {
  for (let idx = 0; idx < autoJobs.length; idx++) {
    const job = autoJobs[idx];
    const folderResult = autoFolderResults.find(r => r.id === job.id);
    activeAutoFolderId = job.id;
    if (!isRunning) return;

    await waitIfPaused();
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
      if (folderResult) {
        folderResult.failed = folderResult.total;
        folderResult.status = 'incomplete';
      }
      markPendingFoldersSkipped(idx + 1);
      recalcAutoSummaryCounts();
      updateProgress();
      updateAutoSummary();
      renderAutoFolderResults();
      showStatus(`Stopped: chat not opened (${job.chatName})`, 'error');
      stopSending();
      return;
    }

    await sleepWithPause(300);
    const folderOk = await processFilesForCurrentChat(
      tabId,
      job.files,
      `Folder ${job.folderName}`,
      folderResult,
      { folderName: job.folderName, chatName: job.chatName }
    );

    if (folderResult) {
      folderResult.status = folderOk ? 'complete' : 'incomplete';
    }
    recalcAutoSummaryCounts();
    updateAutoSummary();
    renderAutoFolderResults();
    updateLiveSummary();
  }
}

async function processFilesForCurrentChat(tabId, files, contextLabel, folderResult = null, runMeta = null) {
  if (isFastMode()) {
    return processFilesBatchMode(tabId, files, contextLabel, folderResult, runMeta);
  }
  return processFilesSingleMode(tabId, files, contextLabel, folderResult, runMeta);
}

async function processFilesSingleMode(tabId, files, contextLabel, folderResult = null, runMeta = null) {
  let allSuccess = true;
  for (let i = 0; i < files.length; i++) {
    if (!isRunning) return false;
    await waitIfPaused();

    const file = files[i];
    currentImageName.textContent = `${contextLabel}: ${file.name}`;
    const ok = await sendOneFile(tabId, file, contextLabel, folderResult, runMeta);
    if (!ok) allSuccess = false;

    if (!isRunning) return false;
    if (i < files.length - 1) {
      await sleepWithPause(getRandomDelayMs());
    }
  }
  return allSuccess;
}

async function processFilesBatchMode(tabId, files, contextLabel, folderResult = null, runMeta = null) {
  const chunkSize = getBatchSize();
  let allSuccess = true;

  for (let start = 0; start < files.length; start += chunkSize) {
    if (!isRunning) return false;
    await waitIfPaused();

    const end = Math.min(start + chunkSize, files.length);
    const chunk = files.slice(start, end);
    addLog(`${contextLabel}: fast chunk ${start + 1}-${end}`, 'info');

    for (let i = 0; i < chunk.length; i++) {
      if (!isRunning) return false;
      await waitIfPaused();

      const file = chunk[i];
      currentImageName.textContent = `${contextLabel}: ${file.name}`;
      const ok = await sendOneFile(tabId, file, contextLabel, folderResult, runMeta);
      if (!ok) allSuccess = false;

      if (!isRunning) return false;
      if (i < chunk.length - 1) {
        await sleepWithPause(getBatchIntraDelayMs());
      }
    }

    if (!isRunning) return false;
    if (end < files.length) {
      await sleepWithPause(getRandomDelayMs());
    }
  }
  return allSuccess;
}

async function sendOneFile(tabId, file, contextLabel, folderResult = null, runMeta = null) {
  addLog(`Sending ${contextLabel}: ${file.name}`, 'info');
  const captionToUse = buildCaptionForFile(file);

  try {
    const base64 = await fileToBase64(file);

    const response = await Promise.race([
      chrome.tabs.sendMessage(tabId, {
        action: 'sendImage',
        imageData: base64,
        fileName: file.name,
        mimeType: file.type,
        caption: captionToUse
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 30000))
    ]);

    if (response && response.success) {
      sentCount++;
      if (folderResult) folderResult.sent++;
      imageResults.push(buildImageResultRecord(file, runMeta, captionToUse, 'sent', null));
      addLog(`Sent: ${file.name}`, 'success');
      processedCount++;
      updateProgress();
      renderAutoFolderResults();
      updateLiveSummary();
      return true;
    }

    failedCount++;
    if (folderResult) folderResult.failed++;
    imageResults.push(buildImageResultRecord(file, runMeta, captionToUse, 'failed', response?.error || 'Unknown error'));
    failedImages.push(`${contextLabel}/${file.name}`);
    addLog(`Failed: ${file.name} - ${response?.error || 'Unknown error'}`, 'error');
  } catch (err) {
    failedCount++;
    if (folderResult) folderResult.failed++;
    imageResults.push(buildImageResultRecord(file, runMeta, captionToUse, 'failed', err.message));
    failedImages.push(`${contextLabel}/${file.name}`);
    addLog(`Error: ${file.name} - ${err.message}`, 'error');
  }

  processedCount++;
  updateProgress();
  renderAutoFolderResults();
  updateLiveSummary();
  return false;
}

function finishSending() {
  isRunning = false;
  isPaused = false;
  activeAutoFolderId = null;
  disableSelectors(false);
  updateActionButtons();

  addLog('All items processed', 'success');
  showStatus(`Completed. Sent: ${sentCount}, Failed: ${failedCount}`, 'success');

  if (runModeInput.value === 'auto') {
    addLog(`Auto folders -> Total: ${autoTotalFolderCount}, Complete: ${autoCompletedCount}, Incomplete: ${autoIncompleteCount}, Skipped: ${autoSkippedCount}`, 'info');
  }

  if (failedImages.length > 0) {
    addLog(`Failed list: ${failedImages.join(', ')}`, 'error');
  }

  finalizeRunReport('completed');
  exportRunResult(true);
  updateActionButtons();
  updateLiveSummary();
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
  autoFolderResults = [];

  if (!baseFolderHandle || mappingLower.size === 0) {
    autoTotalFolderCount = 0;
    autoStaticSkippedCount = 0;
    autoCompletedCount = 0;
    autoIncompleteCount = 0;
    autoSkippedCount = 0;
    updateAutoSummary();
    renderAutoFolderResults();
    autoJobsInfo.textContent = 'Select base folder and ensure mapping.json is configured';
    updateStartAvailability();
    updateLiveSummary();
    return;
  }

  let totalFolders = 0;
  let mappedFolders = 0;
  let totalImages = 0;
  let jobId = 0;

  for await (const entry of baseFolderHandle.values()) {
    if (entry.kind !== 'directory') continue;
    totalFolders++;

    const folderName = entry.name;
    const chatName = mappingLower.get(folderName.toLowerCase());
    if (!chatName) continue;

    const files = await getImagesFromDirectory(entry);
    if (files.length === 0) continue;

    autoJobs.push({ id: jobId++, folderName, chatName, files });
    mappedFolders++;
    totalImages += files.length;
  }

  autoTotalFolderCount = totalFolders;
  autoStaticSkippedCount = Math.max(0, totalFolders - mappedFolders);
  autoCompletedCount = 0;
  autoIncompleteCount = 0;
  autoSkippedCount = autoStaticSkippedCount;
  autoFolderResults = autoJobs.map(job => ({
    id: job.id,
    folderName: job.folderName,
    chatName: job.chatName,
    total: job.files.length,
    sent: 0,
    failed: 0,
    status: 'pending'
  }));

  updateAutoSummary();
  renderAutoFolderResults();
  autoJobsInfo.textContent = `${mappedFolders}/${totalFolders} folders mapped, ${totalImages} images ready`;
  addLog(`Auto jobs ready: ${mappedFolders} folders, ${totalImages} images`, 'info');
  updateStartAvailability();
  updateLiveSummary();
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
    autoTotalFolderCount = 0;
    autoStaticSkippedCount = 0;
    autoCompletedCount = 0;
    autoIncompleteCount = 0;
    autoSkippedCount = 0;
    autoFolderResults = [];
    updateAutoSummary();
    renderAutoFolderResults();
    mappingInfo.textContent = 'Mapping load failed: check mapping.json';
    addLog(`Failed to load mapping.json: ${err.message}`, 'error');
    updateStartAvailability();
    updateLiveSummary();
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
    if (file.type.startsWith('image/')) files.push(file);
  }
  files.sort((a, b) => a.name.localeCompare(b.name));
  return files;
}

function updateProgress() {
  const pct = totalPlanned > 0 ? (processedCount / totalPlanned) * 100 : 0;
  progressFill.style.width = `${pct}%`;
  progressText.textContent = `${processedCount} / ${totalPlanned}`;
}

function updateAutoSummary() {
  autoTotalFoldersEl.textContent = autoTotalFolderCount;
  autoCompletedFoldersEl.textContent = autoCompletedCount;
  autoIncompleteFoldersEl.textContent = autoIncompleteCount;
  autoSkippedFoldersEl.textContent = autoSkippedCount;
}

function recalcAutoSummaryCounts() {
  const completed = autoFolderResults.filter(r => r.status === 'complete').length;
  const incomplete = autoFolderResults.filter(r => r.status === 'incomplete').length;
  const skippedFromJobs = autoFolderResults.filter(r => r.status === 'skipped').length;

  autoCompletedCount = completed;
  autoIncompleteCount = incomplete;
  autoSkippedCount = autoStaticSkippedCount + skippedFromJobs;
}

function markPendingFoldersSkipped(startIndex = 0) {
  for (let i = startIndex; i < autoJobs.length; i++) {
    const result = autoFolderResults.find(r => r.id === autoJobs[i].id);
    if (result && result.status === 'pending') result.status = 'skipped';
  }
}

function renderAutoFolderResults() {
  if (!autoFolderListEl) return;
  if (autoFolderResults.length === 0) {
    autoFolderListEl.innerHTML = '';
    return;
  }

  const rows = autoFolderResults.map((r) => {
    const statusClass = `auto-status-${r.status}${r.id === activeAutoFolderId ? ' auto-row-active' : ''}`;
    return `<tr>
      <td>${escapeHtml(r.folderName)}</td>
      <td>${escapeHtml(r.chatName)}</td>
      <td>${r.total}</td>
      <td>${r.sent}</td>
      <td>${r.failed}</td>
      <td class="${statusClass}">${r.status}</td>
    </tr>`;
  }).join('');

  autoFolderListEl.innerHTML = `<table class="auto-folder-table">
    <thead>
      <tr>
        <th>Folder</th>
        <th>Chat</th>
        <th>Total</th>
        <th>Sent</th>
        <th>Failed</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function updateStartAvailability() {
  if (isRunning) return;
  if (runModeInput.value === 'auto') {
    startBtn.disabled = autoJobs.length === 0;
  } else {
    startBtn.disabled = manualImageFiles.length === 0;
  }
  updateActionButtons();
}

function disableSelectors(disabled) {
  runModeInput.disabled = disabled;
  selectFolderBtn.disabled = disabled;
  selectBaseFolderBtn.disabled = disabled;
  fastModeToggle.disabled = disabled;
  captionInput.disabled = disabled;
  useImageNameCaptionInput.disabled = disabled;
}

function updateActionButtons() {
  const hasReport = !!lastRunReport;
  const canStart = runModeInput.value === 'auto'
    ? autoJobs.length > 0
    : manualImageFiles.length > 0;

  startBtn.classList.toggle('hidden', isRunning);
  pauseBtn.classList.toggle('hidden', !isRunning);
  stopBtn.classList.toggle('hidden', !isRunning);
  exportBtn.classList.toggle('hidden', isRunning || !hasReport);

  pauseBtn.disabled = !isRunning;
  stopBtn.disabled = !isRunning;
  exportBtn.disabled = !hasReport;
  startBtn.disabled = isRunning || !canStart;
}

function setActionMessage(message) {
  actionMessageEl.textContent = message || '';
}

function getDefaultCaption() {
  return (captionInput.value || '.').trim() || '.';
}

function buildCaptionForFile(file) {
  if (!useImageNameCaptionInput.checked) return getDefaultCaption();
  const name = String(file?.name || '').trim();
  if (!name) return getDefaultCaption();
  const lastDot = name.lastIndexOf('.');
  return lastDot > 0 ? name.slice(0, lastDot) : name;
}

function getBatchSize() {
  return 10;
}

function isFastMode() {
  return !!fastModeToggle.checked;
}

function getRandomDelayMs() {
  const min = 2;
  const max = 10;
  const sec = Math.floor(Math.random() * (max - min + 1)) + min;
  return sec * 1000;
}

function getBatchIntraDelayMs() {
  return 120;
}

async function waitIfPaused() {
  while (isRunning && isPaused) {
    await sleep(150);
  }
}

async function sleepWithPause(ms) {
  const step = 100;
  let elapsed = 0;
  while (isRunning && elapsed < ms) {
    await waitIfPaused();
    const wait = Math.min(step, ms - elapsed);
    await sleep(wait);
    elapsed += wait;
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function buildImageResultRecord(file, runMeta, caption, status, error) {
  return {
    timestamp: new Date().toISOString(),
    mode: runModeInput.value,
    sendMode: isFastMode() ? 'fast' : 'slow',
    folder: runMeta?.folderName || 'manual',
    chat: runMeta?.chatName || 'current-chat',
    fileName: file.name,
    caption,
    status,
    error
  };
}

function finalizeRunReport(runStatus) {
  const finishedAt = new Date();
  const startedAt = currentRunStartedAt || finishedAt;
  const durationMs = Math.max(0, finishedAt.getTime() - startedAt.getTime());

  const folderSummary = runModeInput.value === 'auto'
    ? autoFolderResults.map(r => ({
      folder: r.folderName,
      chat: r.chatName,
      total: r.total,
      sent: r.sent,
      failed: r.failed,
      status: r.status
    }))
    : [{
      folder: 'manual',
      chat: 'current-chat',
      total: totalPlanned,
      sent: sentCount,
      failed: failedCount,
      status: failedCount === 0 ? 'completed' : 'incomplete'
    }];

  lastRunReport = {
    meta: {
      runStatus,
      mode: runModeInput.value,
      sendMode: isFastMode() ? 'fast' : 'slow',
      useImageNameAsCaption: !!useImageNameCaptionInput.checked,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs
    },
    summary: {
      totalPlanned,
      processed: processedCount,
      sent: sentCount,
      failed: failedCount,
      pending: Math.max(0, totalPlanned - processedCount),
      autoFolders: {
        total: autoTotalFolderCount,
        completed: autoCompletedCount,
        incomplete: autoIncompleteCount,
        skipped: autoSkippedCount
      }
    },
    folders: folderSummary,
    images: imageResults
  };

  exportBtn.disabled = false;
}

function exportRunResult(isAutoDownload) {
  if (!lastRunReport) {
    if (!isAutoDownload) showStatus('No run result to export yet', 'error');
    return;
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `wa-sender-result-${ts}.csv`;
  const csv = buildCsvReport(lastRunReport);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  addLog(`Exported result: ${fileName}`, 'success');
}

function buildCsvReport(report) {
  const lines = [];
  lines.push('Section,Key,Value');
  lines.push(...Object.entries(report.meta).map(([k, v]) => csvRow(['meta', k, String(v)])));
  lines.push(...Object.entries(report.summary).flatMap(([k, v]) => {
    if (typeof v === 'object' && v !== null) {
      return Object.entries(v).map(([k2, v2]) => csvRow(['summary', `${k}.${k2}`, String(v2)]));
    }
    return [csvRow(['summary', k, String(v)])];
  }));

  lines.push('');
  lines.push('Folders');
  lines.push(csvRow(['folder', 'chat', 'total', 'sent', 'failed', 'status']));
  for (const f of report.folders) {
    lines.push(csvRow([f.folder, f.chat, f.total, f.sent, f.failed, f.status]));
  }

  lines.push('');
  lines.push('Images');
  lines.push(csvRow(['timestamp', 'mode', 'sendMode', 'folder', 'chat', 'fileName', 'caption', 'status', 'error']));
  for (const img of report.images) {
    lines.push(csvRow([
      img.timestamp,
      img.mode,
      img.sendMode,
      img.folder,
      img.chat,
      img.fileName,
      img.caption,
      img.status,
      img.error || ''
    ]));
  }

  return lines.join('\n');
}

function csvRow(values) {
  return values.map((v) => {
    const s = String(v ?? '');
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replaceAll('"', '""')}"`;
    }
    return s;
  }).join(',');
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

function resetRunData() {
  sentCount = 0;
  failedCount = 0;
  failedImages = [];
  totalPlanned = 0;
  processedCount = 0;
  imageResults = [];
  currentRunStartedAt = null;
  lastRunReport = null;
  activeAutoFolderId = null;

  autoCompletedCount = 0;
  autoIncompleteCount = 0;
  autoSkippedCount = autoStaticSkippedCount;
  autoFolderResults = autoFolderResults.map(r => ({ ...r, sent: 0, failed: 0, status: 'pending' }));

  progressFill.style.width = '0%';
  progressText.textContent = '0 / 0';
  progressSection.classList.add('hidden');
  currentImageName.textContent = '';
  setActionMessage('');
  statusMessage.textContent = '';
  statusMessage.className = 'status-message';

  updateProgress();
  recalcAutoSummaryCounts();
  updateAutoSummary();
  renderAutoFolderResults();
  updateActionButtons();
  updateLiveSummary();
}

function updateLiveSummary() {
  liveSummaryEl.classList.remove('hidden');
  const pending = Math.max(0, totalPlanned - processedCount);
  liveSummaryEl.innerHTML = `
    <div class="live-cards">
      <div class="live-card"><span>Sent</span><strong>${sentCount}</strong></div>
      <div class="live-card"><span>Failed</span><strong>${failedCount}</strong></div>
      <div class="live-card"><span>Pending</span><strong>${pending}</strong></div>
    </div>
  `;
}

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
