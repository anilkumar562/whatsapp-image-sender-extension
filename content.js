// WhatsApp Web Image Sender - Using Text Selectors
if (!window._waFileDialogGuardInstalled) {
  window._waFileDialogGuardInstalled = true;
  window._preventFileDialog = false;

  const nativeInputClick = HTMLInputElement.prototype.click;
  HTMLInputElement.prototype.click = function(...args) {
    if (this.type === 'file' && window._preventFileDialog) {
      log('Blocked file input click');
      return;
    }
    return nativeInputClick.apply(this, args);
  };

  if (typeof window.showOpenFilePicker === 'function') {
    const nativeShowOpenFilePicker = window.showOpenFilePicker.bind(window);
    window.showOpenFilePicker = async function(...args) {
      if (window._preventFileDialog) {
        log('Blocked showOpenFilePicker');
        return [];
      }
      return nativeShowOpenFilePicker(...args);
    };
  }
}

document.addEventListener('click', function(e) {
  // Prevent click on file inputs from opening native file dialog during automation
  if (e.target.tagName === 'INPUT' && e.target.type === 'file') {
    if (window._preventFileDialog) {
      e.preventDefault();
      e.stopPropagation();
    }
  }
}, true);

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'sendImage') {
    sendImageAsPhoto(request.imageData, request.fileName, request.mimeType, request.caption)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === 'openChat') {
    openChatByName(request.chatName)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === 'sendImageBatch') {
    sendImageBatch(request.images || [], request.caption)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
  
  if (request.action === 'ping') {
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'isChatOpen') {
    sendResponse({ success: true, isOpen: isChatOpen() });
    return true;
  }
});

async function openChatByName(chatName) {
  try {
    if (!chatName || !chatName.trim()) {
      throw new Error('Chat name is required');
    }

    const query = chatName.trim();
    log(`Opening chat: ${query}`);
    const openedByScroll = await openChatSmart(query);
    if (!openedByScroll) {
      throw new Error(`Chat not found or not opened: ${query}`);
    }
    await sleep(220);

    return { success: true };
  } catch (error) {
    log('Open chat error: ' + error.message);
    return { success: false, error: error.message };
  }
}

async function openChatSmart(chatName) {
  const sidebar = document.querySelector('#pane-side');
  if (!sidebar) {
    log('Sidebar not found');
    return false;
  }

  sidebar.scrollTop = 0;
  await sleep(900);
  let previousScrollTop = -1;

  while (true) {
    const row = findChatRowByName(chatName);
    if (row) {
      row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const opened = await waitFor(() => isChatOpen() || isChatHeaderMatching(chatName), 2500, 100);
      if (opened) {
        log(`Chat opened: ${chatName}`);
        return true;
      }
    }

    sidebar.scrollTop += 650;
    await sleep(700);

    if (sidebar.scrollTop === previousScrollTop) {
      break;
    }
    previousScrollTop = sidebar.scrollTop;
  }

  return false;
}

async function findChatSearchInput() {
  const selectors = [
    '#side div[contenteditable="true"][data-tab="3"][role="textbox"]',
    '#side div[contenteditable="true"][aria-label="Search input textbox"]',
    '#side div[contenteditable="true"][aria-placeholder="Search or start a new chat"]',
    'div[contenteditable="true"][title="Search input textbox"]',
    'div[contenteditable="true"][aria-label="Search input textbox"]',
    'div[contenteditable="true"][aria-placeholder="Search or start a new chat"]',
    '#side div[contenteditable="true"][role="textbox"]'
  ];

  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el) return el;
  }

  const searchBtn = document.querySelector('button[aria-label="Search or start new chat"]') ||
                    document.querySelector('span[data-icon="chatlist-search"]')?.closest('button') ||
                    document.querySelector('span[data-icon="chatlist-search"]')?.closest('div[role="button"]');
  if (searchBtn) {
    searchBtn.click();
    await sleep(150);
  }

  for (const selector of selectors) {
    const els = Array.from(document.querySelectorAll(selector));
    const el = els.find(node => !!node.closest('#side')) || els[0];
    if (el) return el;
  }

  return null;
}

function findChatTitleElement(chatName) {
  const lowered = chatName.toLowerCase();
  const queryPhone = normalizePhone(chatName);
  const spans = document.querySelectorAll('#pane-side span[title]');

  for (const span of spans) {
    const title = (span.getAttribute('title') || '').trim();
    if (!title) continue;
    const titleLower = title.toLowerCase();
    const titlePhone = normalizePhone(title);
    if (
      titleLower === lowered ||
      titleLower.includes(lowered) ||
      (queryPhone && titlePhone && titlePhone.includes(queryPhone))
    ) {
      return span;
    }
  }

  // Fallback: match list item text (some builds don't keep title on spans).
  const rows = document.querySelectorAll('#pane-side div[role="listitem"]');
  for (const row of rows) {
    const text = (row.innerText || '').toLowerCase();
    if (text.includes(lowered)) {
      return row;
    }
  }

  return null;
}

function findChatRowByName(chatName) {
  const lowered = chatName.toLowerCase();
  const queryPhone = normalizePhone(chatName);
  const titles = document.querySelectorAll('#pane-side span[title]');

  for (const el of titles) {
    const title = (el.getAttribute('title') || '').trim();
    if (!title) continue;
    const titleLower = title.toLowerCase();
    const titlePhone = normalizePhone(title);
    if (
      titleLower === lowered ||
      titleLower.includes(lowered) ||
      (queryPhone && titlePhone && titlePhone.includes(queryPhone))
    ) {
      return el.closest('[role="gridcell"]') ||
             el.closest('div[role="listitem"]') ||
             el.closest('div[tabindex="-1"]') ||
             el;
    }
  }

  return null;
}

function getFirstVisibleChatRow() {
  const rows = document.querySelectorAll('#pane-side div[role="listitem"]');
  for (const row of rows) {
    const rect = row.getBoundingClientRect();
    if (rect.width > 20 && rect.height > 20) {
      return row;
    }
  }
  return null;
}

async function sendImageAsPhoto(base64Data, fileName, mimeType, caption) {
  try {
    // Check if chat is open
    if (!isChatOpen()) {
      throw new Error('No chat is open. Please select a chat first.');
    }

    // Convert base64 to File
    const file = base64ToFile(base64Data, fileName, mimeType);
    
    // Step 1: Click attachment button
    log('Step 1: Clicking Attach button...');
    
    const attachBtn = document.querySelector('div[aria-label="Attach"]') ||
                      document.querySelector('button[aria-label="Attach"]');
    
    if (!attachBtn) {
      throw new Error('Attachment button not found');
    }
    
    window._preventFileDialog = true;
    attachBtn.click();
    await waitFor(() => document.querySelectorAll('input[type="file"]').length > 0, 900, 80);
    
    // Step 2: Find and click "Photos & videos" by TEXT
    log('Step 2: Looking for Photos & videos option...');
    
    let photosOptionClicked = false;
    
    // Method 1: Find span containing "Photos" text
    const allSpans = document.querySelectorAll('span');
    for (const span of allSpans) {
      const text = span.textContent.trim().toLowerCase();
      if (text.includes('photos') && text.includes('video')) {
        log('Found "Photos & videos" span');
        // Click the parent container
        const clickable = span.closest('div[role="button"]') || 
                          span.closest('li') || 
                          span.closest('div[tabindex]') ||
                          span.parentElement.parentElement;
        if (clickable) {
          clickable.click();
          photosOptionClicked = true;
          await sleep(120);
          break;
        }
      }
    }
    
    // Method 2: Find by traversing menu structure
    if (!photosOptionClicked) {
      const menuItems = document.querySelectorAll('div[tabindex="-1"], li');
      for (const item of menuItems) {
        const text = item.textContent.toLowerCase();
        if (text.includes('photos') || (text.includes('photo') && text.includes('video'))) {
          log('Found menu item with photos text');
          item.click();
          photosOptionClicked = true;
          await sleep(120);
          break;
        }
      }
    }
    
    if (!photosOptionClicked) {
      log('WARNING: Could not click Photos & videos option');
    }
    
    // Step 3: Find file input
    log('Step 3: Finding file input...');
    await waitFor(() => document.querySelectorAll('input[type="file"]').length > 0, 900, 80);
    
    // Get all file inputs
    const inputs = document.querySelectorAll('input[type="file"]');
    log(`Found ${inputs.length} file inputs`);
    
    // Log all inputs for debugging
    inputs.forEach((inp, i) => {
      log(`Input ${i}: accept="${inp.getAttribute('accept') || 'none'}"`);
    });
    
    let fileInput = null;
    
    // IMPORTANT: Find the input that accepts BOTH image AND video
    // This is the "Photos & videos" input, NOT the sticker input
    for (const inp of inputs) {
      const accept = inp.getAttribute('accept') || '';
      // Photos & Videos input typically has: image/*,video/*
      if (accept.includes('image/') && accept.includes('video/')) {
        fileInput = inp;
        log('Selected Photos & Videos input');
        break;
      }
    }
    
    // Fallback: accept="image/*,video/*" exactly
    if (!fileInput) {
      fileInput = document.querySelector('input[accept="image/*,video/*"]');
      if (fileInput) log('Selected by exact accept match');
    }
    
    // Fallback: first input that's not sticker-only
    if (!fileInput) {
      for (const inp of inputs) {
        const accept = inp.getAttribute('accept') || '';
        // Skip sticker input (usually just image/webp or image/*)
        if (accept === 'image/webp' || accept === 'image/*') {
          continue;
        }
        fileInput = inp;
        log('Selected non-sticker input');
        break;
      }
    }
    
    // Last resort
    if (!fileInput && inputs.length > 0) {
      // Use the LAST input (often photos is last, sticker is first)
      fileInput = inputs[inputs.length - 1];
      log('Selected last input as fallback');
    }
    
    if (!fileInput) {
      throw new Error('File input not found');
    }
    
    // Step 4: Set file
    log('Step 4: Setting file to input...');
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    fileInput.files = dataTransfer.files;
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    fileInput.dispatchEvent(new Event('input', { bubbles: true }));
    window._preventFileDialog = false;
    
    // Step 5: Wait for preview
    log('Step 5: Waiting for preview...');
    
    let sendBtn = null;
    for (let i = 0; i < 30; i++) {
      sendBtn = document.querySelector('div[aria-label="Send"]') ||
                document.querySelector('span[data-icon="wds-ic-send-filled"]');
      if (sendBtn) break;
      await sleep(180);
    }
    
    if (!sendBtn) {
      throw new Error('Preview did not load');
    }
    
    log('Preview loaded!');
    await sleep(300);
    
    // Step 6: Check if we're in Photo mode (has caption) or Sticker mode
    log('Step 6: Checking mode and adding caption...');
    
    const editables = document.querySelectorAll('div[contenteditable="true"]');
    let captionInput = null;
    
    for (const el of editables) {
      if (el.getAttribute('data-tab') === '10') continue;
      
      const rect = el.getBoundingClientRect();
      if (rect.width > 50 && rect.height > 10) {
        captionInput = el;
        break;
      }
    }
    
    // Check for sticker mode indicators
    const hasStickerTools = document.querySelector('div[aria-label="Crop and rotate"]') ||
                            document.querySelector('div[aria-label="Paint"]');
    
    if (hasStickerTools && !captionInput) {
      log('ERROR: Image opened as sticker (no caption input)');
      await closeDialog();
      throw new Error('Image converted to sticker. The wrong input was used.');
    }
    
    // Add caption
    if (caption && captionInput) {
      log('Adding caption...');
      captionInput.focus();
      await sleep(80);
      captionInput.innerHTML = '';
      document.execCommand('insertText', false, caption);
      captionInput.dispatchEvent(new InputEvent('input', { bubbles: true }));
      await sleep(80);
      log('Caption added: ' + caption);
    } else if (caption && !captionInput) {
      log('Caption input not found, skipping caption');
    }
    
    // Step 7: Send
    log('Step 7: Clicking send...');
    await sleep(120);
    
    const sendButton = document.querySelector('div[aria-label="Send"][role="button"]') ||
                       document.querySelector('button[aria-label="Send"]') ||
                       document.querySelector('span[data-icon="wds-ic-send-filled"]')?.closest('div[role="button"]');
    
    if (!sendButton) {
      throw new Error('Send button not found');
    }
    
    sendButton.click();
    await sleep(700);
    
    // Verify sent
    const stillOpen = document.querySelector('div[aria-label="Send"][role="button"]');
    if (stillOpen) {
      log('Retrying send...');
      stillOpen.click();
      await sleep(500);
    }
    
    log('✓ Image sent as photo!');
    return { success: true };
    
  } catch (error) {
    log('Error: ' + error.message);
    await closeDialog();
    return { success: false, error: error.message };
  } finally {
    window._preventFileDialog = false;
  }
}

async function sendImageBatch(images, caption) {
  try {
    if (!Array.isArray(images) || images.length === 0) {
      throw new Error('No images provided for batch');
    }

    if (!isChatOpen()) {
      throw new Error('No chat is open. Please select a chat first.');
    }

    const files = images.map(img => base64ToFile(img.imageData, img.fileName, img.mimeType));

    log('Batch Step 1: Clicking Attach button...');
    const attachBtn = document.querySelector('div[aria-label="Attach"]') ||
                      document.querySelector('button[aria-label="Attach"]');
    if (!attachBtn) {
      throw new Error('Attachment button not found');
    }

    window._preventFileDialog = true;
    attachBtn.click();
    await waitFor(() => document.querySelectorAll('input[type="file"]').length > 0, 900, 80);

    log('Batch Step 2: Looking for Photos & videos option...');
    let photosOptionClicked = false;
    const allSpans = document.querySelectorAll('span');
    for (const span of allSpans) {
      const text = span.textContent.trim().toLowerCase();
      if (text.includes('photos') && text.includes('video')) {
        const clickable = span.closest('div[role="button"]') ||
                          span.closest('li') ||
                          span.closest('div[tabindex]') ||
                          span.parentElement.parentElement;
        if (clickable) {
          clickable.click();
          photosOptionClicked = true;
          await sleep(120);
          break;
        }
      }
    }

    if (!photosOptionClicked) {
      const menuItems = document.querySelectorAll('div[tabindex="-1"], li');
      for (const item of menuItems) {
        const text = item.textContent.toLowerCase();
        if (text.includes('photos') || (text.includes('photo') && text.includes('video'))) {
          item.click();
          photosOptionClicked = true;
          await sleep(120);
          break;
        }
      }
    }

    log('Batch Step 3: Finding file input...');
    await waitFor(() => document.querySelectorAll('input[type="file"]').length > 0, 900, 80);
    const inputs = document.querySelectorAll('input[type="file"]');
    let fileInput = null;

    for (const inp of inputs) {
      const accept = inp.getAttribute('accept') || '';
      if (accept.includes('image/') && accept.includes('video/')) {
        fileInput = inp;
        break;
      }
    }

    if (!fileInput) {
      fileInput = document.querySelector('input[accept="image/*,video/*"]');
    }

    if (!fileInput && inputs.length > 0) {
      fileInput = inputs[inputs.length - 1];
    }

    if (!fileInput) {
      throw new Error('File input not found');
    }

    log(`Batch Step 4: Setting ${files.length} files...`);
    const dataTransfer = new DataTransfer();
    for (const file of files) {
      dataTransfer.items.add(file);
    }
    fileInput.files = dataTransfer.files;
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    fileInput.dispatchEvent(new Event('input', { bubbles: true }));
    window._preventFileDialog = false;

    log('Batch Step 5: Waiting for preview...');
    let sendBtn = null;
    for (let i = 0; i < 40; i++) {
      sendBtn = document.querySelector('div[aria-label="Send"]') ||
                document.querySelector('span[data-icon="wds-ic-send-filled"]');
      if (sendBtn) break;
      await sleep(200);
    }
    if (!sendBtn) {
      throw new Error('Preview did not load');
    }

    if (caption) {
      const editables = document.querySelectorAll('div[contenteditable="true"]');
      for (const el of editables) {
        if (el.getAttribute('data-tab') === '10') continue;
        const rect = el.getBoundingClientRect();
        if (rect.width > 50 && rect.height > 10) {
          el.focus();
          await sleep(80);
          el.innerHTML = '';
          document.execCommand('insertText', false, caption);
          el.dispatchEvent(new InputEvent('input', { bubbles: true }));
          break;
        }
      }
    }

    const sendButton = document.querySelector('div[aria-label="Send"][role="button"]') ||
                       document.querySelector('button[aria-label="Send"]') ||
                       document.querySelector('span[data-icon="wds-ic-send-filled"]')?.closest('div[role="button"]');
    if (!sendButton) {
      throw new Error('Send button not found');
    }

    sendButton.click();
    await sleep(900);

    const stillOpen = document.querySelector('div[aria-label="Send"][role="button"]');
    if (stillOpen) {
      stillOpen.click();
      await sleep(600);
    }

    log(`Batch sent: ${files.length} images`);
    return { success: true, sentCount: files.length };
  } catch (error) {
    log('Batch error: ' + error.message);
    await closeDialog();
    return { success: false, error: error.message };
  } finally {
    window._preventFileDialog = false;
  }
}

async function closeDialog() {
  try {
    const closeBtn = document.querySelector('div[aria-label="Close"]') ||
                     document.querySelector('div[aria-label="Remove attachment"]') ||
                     document.querySelector('span[data-icon="x-alt"]')?.closest('div[role="button"]');
    
    if (closeBtn) {
      closeBtn.click();
      await sleep(500);
    }
    
    // Press Escape
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(300);
  } catch (e) {}
}

function base64ToFile(base64Data, fileName, mimeType) {
  const arr = base64Data.split(',');
  const mime = mimeType || arr[0].match(/:(.*?);/)[1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  
  return new File([u8arr], fileName, { type: mime });
}

function isChatOpen() {
  const selectors = [
    'footer div[contenteditable="true"][role="textbox"]',
    'footer div[contenteditable="true"][data-tab]',
    'div[contenteditable="true"][aria-label="Type a message"]',
    'div[aria-label="Attach"]',
    'button[aria-label="Attach"]'
  ];
  return selectors.some(sel => !!document.querySelector(sel));
}

function isChatHeaderMatching(chatName) {
  const lowered = chatName.toLowerCase();
  const headers = document.querySelectorAll('header span[title], header h1, header div[dir="auto"]');
  for (const h of headers) {
    const text = (h.getAttribute('title') || h.textContent || '').trim().toLowerCase();
    if (!text) continue;
    if (text === lowered || text.includes(lowered)) return true;
  }
  return false;
}

async function clearEditable(el) {
  el.focus();
  el.click();
  await sleep(60);

  // Try multiple clear strategies because WhatsApp search input can be lexical-managed.
  document.execCommand('selectAll', false, null);
  document.execCommand('delete', false, null);
  document.execCommand('insertText', false, '');
  el.textContent = '';
  el.innerHTML = '';

  el.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    inputType: 'deleteContentBackward',
    data: null
  }));
  await sleep(70);
}

async function typeLikeKeyboard(el, text) {
  el.focus();
  el.click();
  await sleep(50);

  // Lexical in WhatsApp reacts better to full insertText than synthetic key events.
  document.execCommand('insertText', false, text);

  el.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    inputType: 'insertText',
    data: text
  }));

  // Nudge lexical state so chat filter is recalculated immediately.
  document.execCommand('insertText', false, ' ');
  el.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    inputType: 'insertText',
    data: ' '
  }));
  document.execCommand('delete', false, null);
  el.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    inputType: 'deleteContentBackward',
    data: null
  }));

  // Ensure final visible content is exactly the query.
  if ((el.textContent || '').trim() !== text.trim()) {
    el.textContent = text;
    el.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'insertText',
      data: text
    }));
  }

  await sleep(140);
}

function normalizePhone(value) {
  return String(value || '').replace(/[^\d+]/g, '');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitFor(checkFn, timeout = 1000, interval = 80) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (checkFn()) return true;
    await sleep(interval);
  }
  return false;
}

function log(msg) {
  console.log('[WA Sender] ' + msg);
}

console.log('[WA Sender] Content script loaded - v5');
