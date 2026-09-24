// In-page shortcuts. Runs on normal web pages only (browsers block content scripts on
// their internal pages). Ignores keys while you're typing and on excluded sites.
(() => {
  const DEFAULT_IN_PAGE = { enabled: true, open: ['Shift+/'], log: [], undo: [] };
  let inPage = DEFAULT_IN_PAGE;
  let excluded = [];

  const load = () =>
    chrome.storage.sync.get('settings').then(({ settings = {} }) => {
      inPage = { ...DEFAULT_IN_PAGE, ...settings.inPage };
      excluded = settings.excludedSites || [];
    }).catch(() => {});
  load();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.settings) load();
  });

  const isExcluded = () => {
    const h = location.hostname;
    return excluded.some((x) => h === x || h.endsWith('.' + x));
  };

  const NON_TEXT_INPUTS = /^(button|checkbox|radio|submit|reset|range|color|file|image)$/;
  const isTyping = (e) => {
    const el = e.composedPath()[0];
    if (!(el instanceof Element)) return false;
    if (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
    return el.tagName === 'INPUT' && !NON_TEXT_INPUTS.test(el.type);
  };

  const ACTIONS = { open: 'open-popup', log: 'add', undo: 'undo' };

  window.addEventListener('keydown', (e) => {
    if (!inPage.enabled || e.repeat || isTyping(e) || isExcluded()) return;
    const combo = globalThis.SipKeys.fromEvent(e);
    if (!combo) return;
    const action = Object.keys(ACTIONS).find((a) => inPage[a]?.includes(combo));
    if (!action) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    try {
      chrome.runtime.sendMessage({ type: ACTIONS[action] })
        .then((res) => res?.ok && action !== 'open' && toast(action, res.result))
        .catch(() => {});
    } catch {
      // Extension was reloaded; this page's copy of the script is orphaned.
    }
  }, true);

  // Small confirmation toast, isolated from the page's styles in a shadow root.
  let host;
  function toast(action, { entry, today }) {
    const vol = (ml) => today.unit === 'oz' ? `${+(ml / 29.5735).toFixed(1)} oz`
      : ml >= 1000 ? `${+(ml / 1000).toFixed(2)} L` : `${ml} ml`;
    const text = action === 'undo'
      ? (entry ? `Removed ${vol(entry.ml)} · ${vol(today.ml)} today` : 'Nothing to undo')
      : `+${vol(entry.ml)} · ${vol(today.ml)} of ${vol(today.goalMl)} today`;

    if (!host) {
      host = document.createElement('div');
      host.attachShadow({ mode: 'open' }).innerHTML = `<style>
        div { position: fixed; z-index: 2147483647; right: 20px; bottom: 20px; padding: 10px 14px;
          font: 600 14px/1.3 system-ui, "Segoe UI", sans-serif; color: #fff; background: #0369a1;
          border-radius: 10px; box-shadow: 0 6px 24px rgba(0,0,0,.25); opacity: 0;
          transform: translateY(8px); transition: opacity .2s, transform .2s; pointer-events: none; }
        div.show { opacity: 1; transform: none; }
      </style><div role="status"></div>`;
    }
    if (!host.isConnected) document.documentElement.append(host);
    const el = host.shadowRoot.querySelector('div');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 1800);
  }
})();
