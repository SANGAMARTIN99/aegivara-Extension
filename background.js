const MAX_LOGS = 1000;

let cachedUserEmail  = null;
let cachedDeviceId   = null;
let cachedPairingToken = null;

const getDeviceId = async () => {
  if (cachedDeviceId) return cachedDeviceId;
  const result = await chrome.storage.local.get(['deviceId']);
  if (result.deviceId) {
    cachedDeviceId = result.deviceId;
  } else {
    cachedDeviceId = 'Aegis-' + Math.random().toString(36).substr(2, 4).toUpperCase() + '-' + Date.now().toString(36).toUpperCase();
    await chrome.storage.local.set({ deviceId: cachedDeviceId });
  }
  return cachedDeviceId;
};

/** Retrieve the pairing token the user saved in the popup. */
const getPairingToken = async () => {
  if (cachedPairingToken) return cachedPairingToken;
  const result = await chrome.storage.local.get(['pairingToken']);
  cachedPairingToken = result.pairingToken || null;
  return cachedPairingToken;
};

const getDeviceName = async () => {
  const result = await chrome.storage.local.get(['deviceName']);
  if (result.deviceName) return result.deviceName;
  
  // Detect OS for a pretty default name
  const platform = await chrome.runtime.getPlatformInfo();
  const osName = platform.os.charAt(0).toUpperCase() + platform.os.slice(1);
  return `${osName} Station`;
};

const getChromeUser = async () => {
  if (cachedUserEmail) return cachedUserEmail;
  try {
    const userInfo = await chrome.identity.getProfileUserInfo();
    if (userInfo && userInfo.email) {
      cachedUserEmail = userInfo.email;
    } else {
      cachedUserEmail = 'Internal User';
    }
  } catch (e) {
    cachedUserEmail = 'Internal User';
  }
  return cachedUserEmail;
};


// Helper to save logs
const saveLog = async (logEntry) => {
  const settings = await chrome.storage.local.get(['trackingEnabled']);
  const trackingEnabled = settings.trackingEnabled !== false; // Default to true

  if (!trackingEnabled) return;

  // Prevent infinite tracking loop of our own GraphQL backend endpoints
  if (logEntry.url && (logEntry.url.includes('127.0.0.1:8000') || logEntry.url.includes('localhost:8000') || logEntry.url.includes('aegisbrowse.tarxemo.com'))) {
    return;
  }
  
  // Optional: Ignore noisy automated assets. ONLY track pure navigations and main requests.
  if (logEntry.type === 'request' && logEntry.resourceType !== 'main_frame') {
    return;
  }

  const result = await chrome.storage.local.get(['activityLogs']);
  let logs = result.activityLogs || [];
  
  const enrichedLog = {
    id: Date.now() + Math.random().toString(36).substr(2, 9),
    timestamp: new Date().toISOString(),
    ...logEntry
  };

  logs.unshift(enrichedLog);

  // Maintain limit
  if (logs.length > MAX_LOGS) {
    logs = logs.slice(0, MAX_LOGS);
  }

  await chrome.storage.local.set({ activityLogs: logs });
  
  // Dispatch to Django Backend directly
  syncToDjango(logEntry);

  // Optional: Notify popup if open (via runtime message)
  chrome.runtime.sendMessage({ type: 'NEW_LOG', log: logs[0] }).catch(() => {
    // Popup might be closed, ignore error
  });
};

let activeBackendHost = null;

// --- RESILIENT BACKEND FETCH HELPER ---
const fetchBackend = async (query, variables = {}, timeoutMs = 5000) => {
  // If we found a working host, try it first
  // const hosts = activeBackendHost 
  //   ? [activeBackendHost, "http://127.0.0.1:8000", "https://aegisbrowse.tarxemo.com"] 
  //   : ["http://127.0.0.1:8000", "http://localhost:8000", "https://aegisbrowse.tarxemo.com"];
  const hosts = activeBackendHost 
    ? [activeBackendHost, "https://aegisbrowse.tarxemo.com"] 
    : ["https://aegisbrowse.tarxemo.com"];
  // Remove duplicates
  const uniqueHosts = [...new Set(hosts)];

  const pairingToken = await getPairingToken();
  let lastError = null;

  for (const host of uniqueHosts) {
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (pairingToken) headers['X-Device-Token'] = pairingToken;

      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(`${host}/graphql/`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query, variables }),
        signal: controller.signal
      });
      clearTimeout(id);

      const result = await response.json();

      if (!response.ok) {
        lastError = `HTTP ${response.status}`;
        continue;
      }

      if (result.errors) {
        // Still counts as a reachable host, just a bad GraphQL query
        activeBackendHost = host;
        console.warn(`AegisBrowse: GraphQL Errors from ${host}:`, JSON.stringify(result.errors, null, 2));
        return result; 
      }

      // Success! Cache this host so we don't ping dead ones anymore
      activeBackendHost = host;
      return result;
    } catch (e) {
      lastError = e.message;
      continue;
    }
  }

  // If we get here, all hosts failed. Clear the cache so we try from scratch next time
  activeBackendHost = null;
  throw new Error(`Critical: All backend hosts unreachable. Last error: ${lastError}`);
};

const sendHeartbeat = async () => {
  const settings = await chrome.storage.local.get(['trackingEnabled']);
  if (settings.trackingEnabled === false) return;

  const deviceId     = await getDeviceId();
  const deviceName   = await getDeviceName();
  const platform     = await chrome.runtime.getPlatformInfo();
  const pairingToken = await getPairingToken();

  const tabs      = await chrome.tabs.query({ active: true, currentWindow: true });
  const activeTab = tabs[0] || {};

  const query = `
    mutation DeviceHeartbeat($input: HeartbeatInput!) {
      heartbeat(input: $input) { success }
    }
  `;

  const account = await getChromeUser();
  const variables = {
    input: {
      deviceId, deviceName,
      osInfo: platform.os,
      currentUrl:   activeTab.url   || "",
      currentTitle: activeTab.title || "Idle",
      chromeAccount: account,
      pairingToken:  pairingToken   // ← links this device to the user on first heartbeat
    }
  };

  try {
    await fetchBackend(query, variables);
  } catch (err) {}
};

const syncToDjango = async (logEntry) => {
  const account      = await getChromeUser();
  const deviceId     = await getDeviceId();
  const pairingToken = await getPairingToken();

  const query = `
    mutation RecordActivity($input: URLLogInput!) {
      recordActivity(input: $input) { success }
    }
  `;

  let status = "Safe";
  if (logEntry.url && logEntry.url.includes('blocked.html')) status = "Blocked";

  let extractedTitle = logEntry.title || "Unknown Title";
  if (extractedTitle === "Unknown Title" || extractedTitle === "Page Navigation") {
    try {
      const urlObj = new URL(logEntry.url);
      extractedTitle = urlObj.hostname.replace(/^www\./, '');
      extractedTitle = extractedTitle.charAt(0).toUpperCase() + extractedTitle.slice(1);
    } catch(e) {}
  }

  const variables = {
    input: {
      url:           logEntry.url || "unknown",
      title:         extractedTitle,
      chromeAccount: account,
      deviceId,
      status,
      pairingToken,  // ← ensures backend can link ownership even on activity records
      activities: [{
        activityType: logEntry.type || "browser_event",
        details: JSON.stringify(logEntry)
      }]
    }
  };

  try {
    await fetchBackend(query, variables);
  } catch (err) {
    console.error("AegisBrowse: Backend Sync Failed. Details:", err.message);
  }
};

// Track Navigations
chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId === 0) { // Only main frame
    saveLog({
      type: 'navigation',
      url: details.url,
      transitionType: details.transitionType,
      title: 'Page Navigation' // Titles are harder to get here, content scripts or tabs API needed
    });
  }
});

// Capture URL Requests
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    // PULSE INTERCEPTION: Real-time sync trigger from Dashboard
    if (details.url.includes('aegis-pulse.local')) {
      console.log("AegisBrowse: Real-time pulse received! Syncing...");
      syncBlockedDomains();
      return; 
    }

    // Ignore internal extension requests
    if (details.url.startsWith('chrome-extension://')) return;

    saveLog({
      type: 'request',
      url: details.url,
      method: details.method,
      resourceType: details.type
    });
  },
  { urls: ["<all_urls>"] }
);

// Get Tab updates for titles
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
     saveLog({
       type: 'page_load',
       url: tab.url,
       title: tab.title || 'Unknown Title'
     });
  }
});

// --- ENFORCEMENT ENGINE ---

/**
 * Scans all open tabs and redirects any that are now on a blocked domain.
 * This ensures that when a policy is updated, existing sessions are terminated immediately.
 */
const enforcePolicyOnExistingTabs = async (blockedDomains) => {
  if (!blockedDomains || blockedDomains.length === 0) return;

  const settings = await chrome.storage.local.get(['trackingEnabled']);
  if (settings.trackingEnabled === false) return;

  console.log("AegisBrowse: Enforcing policy on existing tabs...");
  
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.url || tab.url.includes('blocked.html')) continue;

    try {
      const url = new URL(tab.url);
      const hostname = url.hostname.toLowerCase();

      const isBlocked = blockedDomains.some(domain => 
        hostname === domain || hostname.endsWith('.' + domain)
      );

      if (isBlocked) {
        console.warn("AegisBrowse: Terminating existing session for:", tab.url);
        chrome.tabs.update(tab.id, { 
          url: chrome.runtime.getURL('blocked.html') + '?url=' + encodeURIComponent(tab.url) 
        }).catch(() => {});
      }
    } catch (e) {
      // URL parsing might fail for internal chrome:// pages, ignore them
    }
  }
};

// --- NEW BLOCKING MECHANISM ---

const updateBlockingRules = async (blockedData) => {
  try {
    const settings = await chrome.storage.local.get(['trackingEnabled']);
    if (settings.trackingEnabled === false) {
       // Surveillance is deactivated, remove all rules
       const oldRules = await chrome.declarativeNetRequest.getDynamicRules();
       await chrome.declarativeNetRequest.updateDynamicRules({
         removeRuleIds: oldRules.map(r => r.id)
       });
       console.log("AegisBrowse: Surveillance OFF - Rules Cleared");
       return;
    }

    const rules = blockedData.map((item, index) => ({
      id: index + 100,
      priority: 1,
      action: { 
        type: 'redirect', 
        redirect: { 
          url: chrome.runtime.getURL('blocked.html') + 
               '?url=' + encodeURIComponent(item.domain) + 
               '&reason=' + encodeURIComponent(item.reason || "Security Policy")
        } 
      },
      condition: { 
        urlFilter: `||${item.domain}^`, 
        resourceTypes: ['main_frame'] 
      }
    }));

    const oldRules = await chrome.declarativeNetRequest.getDynamicRules();
    const oldIds = oldRules.map(r => r.id);

    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: oldIds,
      addRules: rules
    });
    
    console.log("AegisBrowse: Enhanced Rules Updated", rules.length);
    
    // ENFORCEMENT: Immediately scan existing tabs and redirect if they match the new policy
    const blockedDomains = blockedData.map(d => d.domain);
    enforcePolicyOnExistingTabs(blockedDomains);

  } catch (err) {
    console.error("AegisBrowse: Failed to update declarative rules:", err);
  }
};

const syncBlockedDomains = async (retryCount = 0) => {
  // The X-Device-Token header in fetchBackend tells the backend which user's
  // domains to return — so this query is automatically per-user scoped.
  const query = `
    query GetBlockedDomains {
      allBlockedDomains {
        id
        domain
        reason
      }
    }
  `;

  try {
    const result = await fetchBackend(query);

    if (result && result.data && result.data.allBlockedDomains) {
      const blockedData = result.data.allBlockedDomains.map(d => ({
        domain: d.domain.toLowerCase().trim(),
        reason: d.reason
      }));
      await chrome.storage.local.set({
        blockedData,
        blockedDomains: blockedData.map(d => d.domain)
      });
      console.log("AegisBrowse: Policy data updated", blockedData.length);
      await updateBlockingRules(blockedData);
    }
  } catch (err) {
    if (retryCount < 5) {
      const delay = Math.pow(2, retryCount) * 2000;
      console.warn(`AegisBrowse: Policy sync failed (${err.message}). Retrying in ${delay/1000}s...`);
      setTimeout(() => syncBlockedDomains(retryCount + 1), delay);
    } else {
      console.error("AegisBrowse: Sync failed permanently. Detailed Error:", err.message);
      console.info("AegisBrowse: Action required -> Ensure your backend server is active (Local: http://127.0.0.1:8000 or Production: https://aegisbrowse.tarxemo.com) and that your Pairing Token is valid.");
    }
  }
};

// Initial delayed sync
setTimeout(() => {
  syncBlockedDomains();
  sendHeartbeat();
}, 2000);

// Listen for alarms
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'syncBlockedDomains') {
    syncBlockedDomains();
  }
  if (alarm.name === 'heartbeat') {
    sendHeartbeat();
  }
});

// Periodic sync every 5 minutes
chrome.alarms.create('syncBlockedDomains', { periodInMinutes: 5 });

// Heartbeat every 30 seconds
chrome.alarms.create('heartbeat', { periodInMinutes: 0.5 });

// Domain blocking listener (Backup for declarativeNetRequest)
chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  if (details.frameId !== 0) return; 

  const { trackingEnabled, blockedDomains } = await chrome.storage.local.get(['trackingEnabled', 'blockedDomains']);
  if (trackingEnabled === false) return; // Surveillance is deactivated
  if (!blockedDomains || blockedDomains.length === 0) return;

  try {
    const url = new URL(details.url);
    const hostname = url.hostname.toLowerCase();

    const isBlocked = blockedDomains.some(domain => 
      hostname === domain || hostname.endsWith('.' + domain)
    );

    if (isBlocked && !details.url.includes('blocked.html')) {
      console.warn("AegisBrowse: Redirection active for:", details.url);
      chrome.tabs.update(details.tabId, { 
        url: chrome.runtime.getURL('blocked.html') + '?url=' + encodeURIComponent(details.url) 
      });
    }
  } catch (e) {}
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'STATUS_UPDATE') {
    console.log("AegisBrowse: Status Changed to", msg.enabled);
    chrome.storage.local.get(['blockedData'], ({ blockedData }) => {
      updateBlockingRules(blockedData || []);
    });
  }
  if (msg.type === 'TOKEN_UPDATED') {
    // Reset cached token so next heartbeat uses the new value
    cachedPairingToken = msg.token || null;
    console.log("AegisBrowse: Pairing token updated, triggering heartbeat...");
    // Immediately send a heartbeat to claim the token
    sendHeartbeat();
    syncBlockedDomains();
  }
});

console.log('Premium Tracker Background Service Worker Active');
