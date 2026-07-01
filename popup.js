// ─────────────────────────────────────────
// TRANSLATIONS
// ─────────────────────────────────────────
const translations = {
    EN: {
        app_title:       'AegisBrowse',
        tab_dashboard:   'Dashboard',
        tab_feed:        'Activity Feed',
        tab_link:        'Link Device',
        nav_count:       'Navigations',
        req_count:       'Requests',
        total_count:     'Total Logs',
        recent_activity: 'Recent Activity',
        secure_status:   '● System Secure',
        no_activity:     'No activity yet. Browse a little!',
        link_title:      'Pair This Device',
        link_sub:        'Enter the token from your AegisBrowse dashboard to link this browser to your account.',
        link_placeholder:'Paste token here (xxxxxxxx-xxxx-...)',
        link_save:       'Save & Pair',
        link_clear:      'Unlink Device',
        link_device_id:  'Device Fingerprint',
        link_status_ok:  '✔ Device Linked',
        link_status_no:  '✘ Not Linked'
    },
    SW: {
        app_title:       'AegisBrowse',
        tab_dashboard:   'Dashibodi',
        tab_feed:        'Mlisho',
        tab_link:        'Unganisha Kifaa',
        nav_count:       'Urambazaji',
        req_count:       'Maombi',
        total_count:     'Jumla ya Kumbukumbu',
        recent_activity: 'Shughuli za Hivi Karibuni',
        secure_status:   '● Mfumo Salama',
        no_activity:     'Hakuna shughuli bado. Vinjari kidogo!',
        link_title:      'Oanisha Kifaa Hiki',
        link_sub:        'Weka tokeni kutoka dashibodi yako kuunganisha kivinjari hiki.',
        link_placeholder:'Bandika tokeni hapa (xxxxxxxx-xxxx-...)',
        link_save:       'Hifadhi & Oanisha',
        link_clear:      'Ondoa Kifaa',
        link_device_id:  'Alama ya Kifaa',
        link_status_ok:  '✔ Kifaa Kimeunganishwa',
        link_status_no:  '✘ Hakijaunganishwa'
    }
};

// ─────────────────────────────────────────
// STATE
// ─────────────────────────────────────────
let currentLang   = 'EN';
let currentView   = 'dashboard';
let currentPage   = 1;
let logs          = [];
const ITEMS_PER_PAGE = 12;

// ─────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────
const t  = (key) => translations[currentLang][key] || key;
const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const getTypeClass = (type) => {
    if (type === 'navigation') return 'nav';
    if (type === 'request')    return 'req';
    return 'tab';
};

const getTypeIcon = (type) => {
    if (type === 'navigation') return 'compass';
    if (type === 'request')    return 'globe';
    return 'layout-grid';
};

const shortTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fullTime  = (iso) => new Date(iso).toLocaleTimeString();

/** Build a DOM element safely — never uses innerHTML, so untrusted log data
 * (URLs) can never be interpreted as markup. */
const createEl = (tag, { className, text, title, attrs } = {}) => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    if (title !== undefined) el.title = title;
    if (attrs) Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    return el;
};

// ─────────────────────────────────────────
// ICONS — re-render Lucide icons
// ─────────────────────────────────────────
const renderIcons = () => lucide.createIcons();

// ─────────────────────────────────────────
// GSAP BACKGROUND ANIMATION
// ─────────────────────────────────────────
const animateBlobs = () => {
    gsap.to('.blob-1', { x: 40, y: 30, duration: 8, yoyo: true, repeat: -1, ease: 'sine.inOut' });
    gsap.to('.blob-2', { x: -40, y: -20, duration: 10, yoyo: true, repeat: -1, ease: 'sine.inOut' });
    gsap.to('.blob-3', { x: -30, y: 40, duration: 7, yoyo: true, repeat: -1, ease: 'sine.inOut' });
};

// ─────────────────────────────────────────
// RENDER: STATS
// ─────────────────────────────────────────
const renderStats = () => {
    const navs   = logs.filter(l => l.type === 'navigation').length;
    const reqs   = logs.filter(l => l.type === 'request').length;
    const total  = logs.length;

    // Animate count with GSAP
    gsap.to({ val: parseInt($('#count-nav').textContent) || 0 }, {
        val: navs, duration: 0.8, ease: 'power2.out',
        onUpdate: function() { $('#count-nav').textContent = Math.round(this.targets()[0].val); }
    });
    gsap.to({ val: parseInt($('#count-req').textContent) || 0 }, {
        val: reqs, duration: 0.8, ease: 'power2.out',
        onUpdate: function() { $('#count-req').textContent = Math.round(this.targets()[0].val); }
    });
    gsap.to({ val: parseInt($('#count-total').textContent) || 0 }, {
        val: total, duration: 0.8, ease: 'power2.out',
        onUpdate: function() { $('#count-total').textContent = Math.round(this.targets()[0].val); }
    });
};

// ─────────────────────────────────────────
// RENDER: DASHBOARD RECENT LOGS
// ─────────────────────────────────────────
const renderDashboard = () => {
    renderStats();
    const list = $('#recent-list');
    list.innerHTML = '';

    if (!logs.length) {
        list.appendChild(createEl('div', { className: 'empty-state', text: t('no_activity') }));
        return;
    }

    logs.slice(0, 8).forEach((log, i) => {
        const cls  = getTypeClass(log.type);
        const icon = getTypeIcon(log.type);
        const item = document.createElement('div');
        item.className = 'log-item';

        const iconWrap = createEl('div', { className: `log-icon ${cls}` });
        iconWrap.appendChild(createEl('i', { attrs: { 'data-lucide': icon } }));

        const body = createEl('div', { className: 'log-body' });
        body.appendChild(createEl('div', { className: `log-type ${cls}`, text: log.type }));
        body.appendChild(createEl('div', { className: 'log-url', text: log.url, title: log.url }));

        item.appendChild(iconWrap);
        item.appendChild(body);
        item.appendChild(createEl('div', { className: 'log-time', text: shortTime(log.timestamp) }));

        list.appendChild(item);
        // Stagger animation
        gsap.fromTo(item, { autoAlpha: 0, x: -10 }, { autoAlpha: 1, x: 0, duration: 0.3, delay: i * 0.05 });
    });
    renderIcons();
};

// ─────────────────────────────────────────
// RENDER: ACTIVITY FEED (PAGINATED)
// ─────────────────────────────────────────
const renderFeed = () => {
    const container  = $('#feed-container');
    const totalPages = Math.max(1, Math.ceil(logs.length / ITEMS_PER_PAGE));

    if (currentPage > totalPages) currentPage = totalPages;

    container.innerHTML = '';
    if (!logs.length) {
        container.appendChild(createEl('div', { className: 'empty-state', text: t('no_activity') }));
    } else {
        const start    = (currentPage - 1) * ITEMS_PER_PAGE;
        const pageLogs = logs.slice(start, start + ITEMS_PER_PAGE);

        pageLogs.forEach((log, i) => {
            const cls  = getTypeClass(log.type);
            const item = document.createElement('div');
            item.className = 'feed-item';

            const header = createEl('div', { className: 'feed-item-header' });
            header.appendChild(createEl('span', { className: `feed-badge ${cls}`, text: log.type }));
            header.appendChild(createEl('span', { className: 'feed-time', text: fullTime(log.timestamp) }));

            item.appendChild(header);
            item.appendChild(createEl('div', { className: 'feed-url', text: log.url, title: log.url }));

            container.appendChild(item);
            gsap.fromTo(item, { autoAlpha: 0, y: 6 }, { autoAlpha: 1, y: 0, duration: 0.25, delay: i * 0.03 });
        });
    }

    // Update pagination controls
    $('#page-info').textContent = `${currentPage} / ${totalPages}`;
    $('#prev-page').disabled    = (currentPage === 1);
    $('#next-page').disabled    = (currentPage === totalPages);
};

// ─────────────────────────────────────────
// VIEW SWITCHING
// ─────────────────────────────────────────
const switchView = (viewId) => {
    if (currentView === viewId) return;
    currentView = viewId;

    $$('.view').forEach(v => v.classList.add('hidden'));
    $$('.tab-btn').forEach(b => b.classList.remove('active'));

    const active = $(`#view-${viewId}`);
    active.classList.remove('hidden');
    $(`#tab-${viewId}`).classList.add('active');

    gsap.fromTo(active, { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: 0.3 });

    if (viewId === 'feed')      renderFeed();
    if (viewId === 'dashboard') renderDashboard();
};

// ─────────────────────────────────────────
// THEME TOGGLE
// ─────────────────────────────────────────
const toggleTheme = () => {
    const body  = document.body;
    const isLight = body.classList.toggle('light');
    body.classList.toggle('dark', !isLight);

    const icon = $('#theme-icon');
    icon.setAttribute('data-lucide', isLight ? 'sun' : 'moon');
    renderIcons();
};

// ─────────────────────────────────────────
// LANGUAGE TOGGLE
// ─────────────────────────────────────────
const applyTranslations = () => {
    $$('[data-i18n]').forEach(el => {
        const key = el.dataset.i18n;
        if (translations[currentLang][key]) el.textContent = translations[currentLang][key];
    });
    $('#lang-text').textContent = currentLang;
    if (currentView === 'dashboard') renderDashboard();
    if (currentView === 'feed')      renderFeed();
};

// ─────────────────────────────────────────
// LIVE CLOCK
// ─────────────────────────────────────────
const startClock = () => {
    const tick = () => { $('#live-time').textContent = new Date().toLocaleTimeString(); };
    tick();
    setInterval(tick, 1000);
};

// ─────────────────────────────────────────
// INIT
// ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {

    // Init icons & GSAP
    renderIcons();
    animateBlobs();
    startClock();

    // Load logs from storage
    const data = await chrome.storage.local.get(['activityLogs']);
    logs = data.activityLogs || [];

    // Initial render
    renderDashboard();

    // Tab buttons
    $$('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchView(btn.dataset.tab));
    });

    // Theme toggle
    $('#theme-toggle').addEventListener('click', toggleTheme);

    // Language toggle
    $('#lang-toggle').addEventListener('click', () => {
        currentLang = currentLang === 'EN' ? 'SW' : 'EN';
        applyTranslations();
    });

    // Pagination
    $('#prev-page').addEventListener('click', () => {
        if (currentPage > 1) { currentPage--; renderFeed(); }
    });
    $('#next-page').addEventListener('click', () => {
        const total = Math.ceil(logs.length / ITEMS_PER_PAGE);
        if (currentPage < total) { currentPage++; renderFeed(); }
    });

    // --- ADMIN AUTH & TRACKING LOCK LOGIC ---
    
    const trackingToggle = $('#tracking-toggle');
    const authOverlay = $('#auth-overlay');
    const authCancel = $('#auth-cancel');
    const authConfirm = $('#auth-confirm');
    const adminPasswordInput = $('#admin-password');
    const authError = $('#auth-error');
    const statusText = $('#status-text');

    // Load initial tracking state
    const settings = await chrome.storage.local.get(['trackingEnabled']);
    const isTracking = settings.trackingEnabled !== false;
    trackingToggle.checked = isTracking;
    updateStatusUI(isTracking);

    function updateStatusUI(active) {
        statusText.textContent = active ? 'Active & Encrypted' : 'Surveillance Paused';
        statusText.style.color = active ? 'var(--accent-green)' : '#ef4444';
        document.body.classList.toggle('tracking-off', !active);
    }

    trackingToggle.addEventListener('click', (e) => {
        const currentlyActive = trackingToggle.checked;
        
        // If trying to turn OFF, intercept and ask for password
        if (!currentlyActive) {
            e.preventDefault(); // Stop the check from actually toggling
            authOverlay.classList.remove('hidden');
            adminPasswordInput.value = '';
            adminPasswordInput.focus();
            authError.classList.add('hidden');
        } else {
            // Turning ON is always allowed
            saveTrackingState(true);
        }
    });

    authCancel.addEventListener('click', () => {
        authOverlay.classList.add('hidden');
    });

    authConfirm.addEventListener('click', async () => {
        const password = adminPasswordInput.value;
        if (!password) return;

        authConfirm.disabled = true;
        authConfirm.textContent = 'Verifying...';
        authError.classList.add('hidden');

        try {
            // Validate via Backend Login Mutation
            // We assume 'admin' as the primary account for this simple check
            const query = `
                mutation AdminVerify($password: String!) {
                  tokenAuth(username: "admin", password: $password) {
                    token
                  }
                }
            `;

            const response = await fetch("https://aegisbrowse.tarxemo.com/graphql/", {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query, variables: { password } })
            });

            const result = await response.json();

            if (result.data?.tokenAuth?.token) {
                // Success! Deactivate surveillance
                saveTrackingState(false);
                authOverlay.classList.add('hidden');
            } else {
                authError.classList.remove('hidden');
            }
        } catch (err) {
            console.error("Auth Fail:", err);
            authError.textContent = "Network error. Try again.";
            authError.classList.remove('hidden');
        } finally {
            authConfirm.disabled = false;
            authConfirm.textContent = 'Deactivate';
        }
    });

    async function saveTrackingState(enabled) {
        await chrome.storage.local.set({ trackingEnabled: enabled });
        trackingToggle.checked = enabled;
        updateStatusUI(enabled);
        
        // Notify background script to stop/start immediately
        chrome.runtime.sendMessage({ type: 'STATUS_UPDATE', enabled });
    }

    // --- END AUTH LOGIC ---

    // Listen for new logs from background
    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.type === 'NEW_LOG') {
            logs.unshift(msg.log);
            renderStats();
            if (currentView === 'dashboard') renderDashboard();
            if (currentView === 'feed')      renderFeed();
        }
    });

    // ─────────────────────────────────────
    // LINK DEVICE (PAIRING TOKEN) PANEL
    // ─────────────────────────────────────
    const linkTokenInput  = $('#link-token-input');
    const linkSaveBtn     = $('#link-save-btn');
    const linkClearBtn    = $('#link-clear-btn');
    const linkStatusEl    = $('#link-status');
    const linkDeviceIdEl  = $('#link-device-id-value');

    if (linkTokenInput && linkSaveBtn) {
        // Populate device fingerprint
        const deviceId = await getStoredDeviceId();
        if (linkDeviceIdEl) linkDeviceIdEl.textContent = deviceId || '—';

        // Load existing token
        const stored = await chrome.storage.local.get(['pairingToken']);
        if (stored.pairingToken) {
            linkTokenInput.value = stored.pairingToken;
            _setLinkStatus(true);
        } else {
            _setLinkStatus(false);
        }

        linkSaveBtn.addEventListener('click', async () => {
            const val = linkTokenInput.value.trim();
            if (!val) return;
            // Basic UUID format check
            const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            if (!uuidRe.test(val)) {
                linkStatusEl.textContent = '⚠ Invalid token format';
                linkStatusEl.style.color = '#f59e0b';
                return;
            }
            await chrome.storage.local.set({ pairingToken: val });
            // Invalidate cache in background
            chrome.runtime.sendMessage({ type: 'TOKEN_UPDATED', token: val }).catch(() => {});
            _setLinkStatus(true);
            gsap.fromTo(linkSaveBtn, { scale: 0.95 }, { scale: 1, duration: 0.3, ease: 'back.out(2)' });
        });

        linkClearBtn.addEventListener('click', async () => {
            await chrome.storage.local.remove(['pairingToken']);
            linkTokenInput.value = '';
            chrome.runtime.sendMessage({ type: 'TOKEN_UPDATED', token: null }).catch(() => {});
            _setLinkStatus(false);
        });
    }

    function _setLinkStatus(linked) {
        if (!linkStatusEl) return;
        linkStatusEl.textContent = linked ? t('link_status_ok') : t('link_status_no');
        linkStatusEl.style.color = linked ? 'var(--accent-green)' : '#ef4444';
    }

    async function getStoredDeviceId() {
        const r = await chrome.storage.local.get(['deviceId']);
        return r.deviceId || null;
    }
});
