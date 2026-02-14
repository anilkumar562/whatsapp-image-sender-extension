function isWhatsAppUrl(url) {
  return typeof url === 'string' && url.startsWith('https://web.whatsapp.com/');
}

async function updatePanelForTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    await chrome.sidePanel.setOptions({
      tabId,
      path: 'sidepanel.html',
      enabled: isWhatsAppUrl(tab.url)
    });
  } catch (e) {}
}

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  await updatePanelForTab(tabId);
});

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status === 'complete' || typeof info.url === 'string') {
    await chrome.sidePanel.setOptions({
      tabId,
      path: 'sidepanel.html',
      enabled: isWhatsAppUrl(tab.url || info.url)
    });
  }
});
