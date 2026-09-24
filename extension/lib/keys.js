// Shared key-combo helpers. Classic script (not a module) so it also loads as a content script.
// Combos use physical keys (e.code), so "Shift+/" works regardless of what character Shift+/ types.
globalThis.SipKeys = (() => {
  const MODIFIERS = new Set(['Control', 'Alt', 'Shift', 'Meta', 'AltGraph', 'CapsLock', 'OS']);
  const NAMES = {
    Slash: '/', Backslash: '\\', Period: '.', Comma: ',', Semicolon: ';', Quote: "'",
    BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=', Backquote: '`',
    Escape: 'Esc', NumpadEnter: 'Enter',
  };

  function keyName(code) {
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit\d$/.test(code)) return code.slice(5);
    if (/^Numpad\d$/.test(code)) return 'Num' + code.slice(6);
    return NAMES[code] || code;
  }

  /** @param {KeyboardEvent} e @returns {string|null} e.g. "Ctrl+Shift+/", or null for a lone modifier */
  function fromEvent(e) {
    if (MODIFIERS.has(e.key) || !e.code) return null;
    const parts = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    if (e.metaKey) parts.push('Meta');
    parts.push(keyName(e.code));
    return parts.join('+');
  }

  return { fromEvent, keyName };
})();
