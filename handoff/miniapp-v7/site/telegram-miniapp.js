/* QMR Proxy Mini App integration — safe no-op outside Telegram, no initData exfiltration. */
(() => {
  'use strict';
  function init() {
    const tg=window.Telegram && window.Telegram.WebApp;
    if (!tg || !tg.initData || !tg.platform || tg.platform === 'unknown') return;
    document.documentElement.classList.add('qmr-inside-telegram');
    try { tg.ready(); } catch (_) {}
    try { tg.expand(); } catch (_) {}
    try { if (typeof tg.setHeaderColor === 'function') tg.setHeaderColor('#100b25'); } catch (_) {}
    try { if (typeof tg.setBackgroundColor === 'function') tg.setBackgroundColor('#090714'); } catch (_) {}
    const install=document.getElementById('install-top');
    if (install && typeof tg.addToHomeScreen === 'function') {
      install.addEventListener('click', event => {
        event.preventDefault();
        event.stopImmediatePropagation();
        try { tg.addToHomeScreen(); } catch (_) {}
      },true);
    }
    document.addEventListener('click', event => {
      if (!event.target || !event.target.closest) return;
      const b=event.target.closest('button, .button');
      if (b && tg.HapticFeedback && typeof tg.HapticFeedback.impactOccurred==='function') {
        try { tg.HapticFeedback.impactOccurred('light'); } catch (_) {}
      }
    }, {passive:true});
    // A static link-directory Mini App does not need or store the Telegram identity.
    // NEVER trust initDataUnsafe on the site for authentication or subscription checks.
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();
