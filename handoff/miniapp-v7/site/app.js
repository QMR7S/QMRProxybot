/* QMR Proxy v5 — public-site-only runtime. Community endpoints are third-party; promo status must not be guessed. Saved user nodes never leave the device. */
(() => {
  'use strict';

  const STORAGE_KEY = 'qmrproxy.personal.v3';
  const MAX_NODES = 30;
  const MAX_PUBLIC = 60;
  const REMOTE_FEED = 'https://iwizard7.github.io/MTProxy_list/endpoints.json';
  const MAX_FEED_AGE_MS = 36 * 60 * 60 * 1000;
  const MAX_FILE_BYTES = 128 * 1024;
  const root = document;
  const $ = id => root.getElementById(id);
  const publicList = $('public-list');
  const savedList = $('saved-list');
  const toast = $('toast');
  const form = $('proxy-form');
  const formError = $('form-error');
  let publicNodes = [];
  let showAllPublic = false;
  let onlyConfirmedNoAds = false;
  let publicSearch = '';
  let lastFeedSource = 'local snapshot';
  let savedNodes = readSaved();
  let installPrompt = null;
  let toastTimer = null;
  let lastRefresh = null;

  function notify(message) {
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 3200);
  }

  function nodeElement(tag, className, content) {
    const element = root.createElement(tag);
    if (className) element.className = className;
    if (content !== undefined) element.textContent = content;
    return element;
  }

  function icon(name) {
    const svg = root.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('icon');
    svg.setAttribute('aria-hidden', 'true');
    const use = root.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', './assets/icons.svg#' + name);
    svg.append(use);
    return svg;
  }

  function normalizeHost(value) {
    return String(value || '').trim().toLowerCase();
  }

  // Restrict to normal DNS names or dotted IPv4. Browsers never probe TCP proxy availability.
  function isHost(value) {
    if (typeof value !== 'string' || value.length > 253 || value.length < 1) return false;
    if (!/^[a-zA-Z0-9.-]+$/.test(value)) return false;
    if (value.startsWith('.') || value.endsWith('.') || value.includes('..')) return false;
    return value.split('.').every(label => label.length > 0 && label.length <= 63 && !label.startsWith('-') && !label.endsWith('-'));
  }

  function isSecret(value) {
    if (typeof value !== 'string') return false;
    // MTProto standard/fake-TLS hex secrets and common URL-safe base64 secret encodings.
    return (/^[a-fA-F0-9]{32,512}$/.test(value) && value.length % 2 === 0)
      || /^[A-Za-z0-9_-]{22,684}={0,2}$/.test(value);
  }

  function validateNode(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    return isHost(value.server)
      && Number.isInteger(value.port) && value.port >= 1 && value.port <= 65535
      && isSecret(value.secret)
      && value.enabled !== false;
  }

  function normalizeNode(value) {
    return {
      name: typeof value.name === 'string' && value.name.trim() ? value.name.trim().slice(0, 60) : 'بروكسي MTProto',
      server: normalizeHost(value.server),
      port: value.port,
      secret: value.secret,
      region: typeof value.region === 'string' ? value.region.trim().slice(0, 60) : '',
      source: value.source === 'third_party' ? 'third_party' : 'unspecified',
      ads_status: ['none', 'present', 'unknown'].includes(value.ads_status) ? value.ads_status : 'unknown',
      median_rtt_ms: Number.isFinite(value.median_rtt_ms) ? Math.round(value.median_rtt_ms) : null,
      success_rate: Number.isFinite(value.success_rate) ? value.success_rate : null,
      samples: Number.isInteger(value.samples) ? value.samples : null
    };
  }

  function dedupeKey(node) {
    return [normalizeHost(node.server), node.port, node.secret].join('|');
  }

  function readSaved() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      if (!Array.isArray(parsed)) return [];
      const unique = new Set();
      return parsed.filter(validateNode).map(normalizeNode).filter(node => {
        const key = dedupeKey(node);
        if (unique.has(key)) return false;
        unique.add(key);
        return true;
      }).slice(0, MAX_NODES);
    } catch { return []; }
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(savedNodes));
      return true;
    } catch {
      notify('تعذر حفظ البيانات في هذا المتصفح. استخدم تصدير نسخة احتياطية.');
      return false;
    }
  }

  function makeUrl(node, scheme = 'tg://proxy') {
    return scheme + '?server=' + encodeURIComponent(node.server)
      + '&port=' + encodeURIComponent(node.port)
      + '&secret=' + encodeURIComponent(node.secret);
  }

  async function copyLink(node) {
    const text = makeUrl(node, 'https://t.me/proxy');
    try {
      await navigator.clipboard.writeText(text);
      notify('تم نسخ رابط البروكسي');
    } catch {
      window.prompt('انسخ هذا الرابط:', text);
    }
  }

  function button(label, type, onClick, iconName) {
    const b = nodeElement('button', 'button ' + type);
    b.type = 'button';
    if (iconName) b.append(icon(iconName));
    b.append(nodeElement('span', '', label));
    b.addEventListener('click', onClick);
    return b;
  }

  function emptyCard(title, message) {
    const box = nodeElement('div', 'empty');
    box.append(nodeElement('div', 'empty-symbol', '◇'));
    box.append(nodeElement('strong', '', title));
    box.append(nodeElement('p', '', message));
    return box;
  }

  function confirmDelete(index) {
    const dialog = $('delete-dialog');
    if (!dialog || typeof dialog.showModal !== 'function') {
      if (window.confirm('هل تريد حذف هذا البروكسي من متصفحك؟')) removeSaved(index);
      return;
    }
    dialog.showModal();
    dialog.addEventListener('close', () => {
      if (dialog.returnValue === 'confirm') removeSaved(index);
    }, { once: true });
  }

  function removeSaved(index) {
    savedNodes.splice(index, 1);
    persist();
    render();
    notify('تم حذف البروكسي من هذا الجهاز');
  }

  function serverCard(node, personal, index) {
    const card = nodeElement('article', 'server-card');
    const top = nodeElement('div', 'server-top');
    const title = nodeElement('div', 'server-title');
    const mark = nodeElement('span', 'server-bullet');
    mark.append(icon('server'));
    title.append(mark, nodeElement('h4', '', node.name));
    top.append(title, nodeElement('span', 'server-type', personal ? 'محفوظ محلياً' : (node.source === 'third_party' ? 'مشغّل خارجي' : 'مدرج عام')));
    card.append(top);
    card.append(nodeElement('p', 'server-host', node.server + ':' + node.port));
    if (!personal && node.source === 'third_party') {
      const adText = node.ads_status === 'none'
        ? 'القناة الدعائية: لم تُرصد في آخر فحص (قد تتغيّر)'
        : 'القناة الدعائية: غير مؤكدة وقد تظهر قناة خارجية';
      const metric = Number.isFinite(node.median_rtt_ms)
        ? ' · زمن المصدر الوسيط ' + node.median_rtt_ms + 'ms (ليس من العراق)' : '';
      card.append(nodeElement('p', 'server-desc', adText + metric + ' · مشغّل خارجي قد يرى IP ووقت الاتصال.'));
    } else {
      card.append(nodeElement('p', 'server-desc', personal
        ? 'هذا اتصال أضفته بنفسك. حفظه لا يثبت أنه آمن أو يعمل حالياً.'
        : 'رابط مدرج؛ لم نختبر حالته من داخل العراق.'));
    }

    const actions = nodeElement('div', 'server-actions');
    const open = nodeElement('a', 'button button--primary');
    open.href = makeUrl(node);
    open.append(icon('send'), nodeElement('span', '', 'فتح في تيليجرام'));
    open.setAttribute('aria-label', 'فتح إعداد بروكسي ' + node.name + ' في تيليجرام');
    const web = nodeElement('a', 'button button--outline');
    web.href = makeUrl(node, 'https://t.me/proxy');
    web.target = '_blank';
    web.rel = 'noopener noreferrer';
    web.append(nodeElement('span', '', 'رابط بديل'));
    actions.append(open, web, button('نسخ', 'button--outline', () => { void copyLink(node); }, 'copy'));
    if (personal) actions.append(button('حذف', 'button--outline', () => confirmDelete(index), 'trash'));
    card.append(actions);
    return card;
  }

  function visiblePublicNodes() {
    const filtered = publicNodes.filter(node => {
      if (onlyConfirmedNoAds && node.ads_status !== 'none') return false;
      if (publicSearch && !(node.server + ' ' + node.name + ' ' + node.port).toLowerCase().includes(publicSearch)) return false;
      return true;
    });
    return filtered.slice(0, showAllPublic ? MAX_PUBLIC : 20);
  }

  function render() {
    publicList.replaceChildren();
    savedList.replaceChildren();
    const display = visiblePublicNodes();
    if (!display.length) {
      if (onlyConfirmedNoAds) publicList.append(emptyCard('لا توجد نتائج مؤكدة بلا قناة ترويجية', 'لم يُكمل المصدر فحص القنوات الترويجية بعد. لا يمكننا ضمان خلو بروكسي خارجي من الإعلانات.'));
      else publicList.append(emptyCard('لا توجد خوادم تطابق البحث', 'غيّر البحث أو حدّث القائمة. لا تُعرض خوادم غير موجودة.'));
    } else display.forEach((node, index) => publicList.append(serverCard(node, false, index)));
    if (!savedNodes.length) savedList.append(emptyCard('ما حفظت أي بروكسي بعد', 'لديك رابط MTProto؟ اضغط «إضافة بروكسي» في الأعلى، واحفظه على جهازك.'));
    else savedNodes.forEach((node, index) => savedList.append(serverCard(node, true, index)));
    $('public-count').textContent = String(publicNodes.length);
    $('public-label').textContent = String(publicNodes.length);
    $('saved-count').textContent = String(savedNodes.length);
    $('saved-label').textContent = String(savedNodes.length);
    $('public-notice').hidden = false;
    $('public-updated').textContent = lastRefresh
      ? 'فحص المصدر: ' + lastRefresh + ' · ' + (lastFeedSource === 'remote' ? 'بيانات محدثة' : 'نسخة احتياطية')
      : 'لم يتم تحميل النتائج';
    const more = $('toggle-public');
    if (more) {
      more.hidden = publicNodes.length <= 20;
      more.textContent = showAllPublic ? 'عرض أفضل 20 فقط' : 'عرض حتى 60 بروكسي';
    }
    const num = $('shown-public');
    if (num) num.textContent = 'المعروض ' + display.length + ' من ' + publicNodes.length;
  }

  function fromRemoteFeed(payload) {
    if (!payload || !Array.isArray(payload.endpoints)) throw new Error('Invalid live feed');
    const updated = Date.parse(payload.updated_at || '');
    if (!Number.isFinite(updated) || updated > Date.now() + 600000 || Date.now() - updated > MAX_FEED_AGE_MS) {
      throw new Error('Source report is stale or invalid');
    }
    const unique = new Set();
    const candidates = payload.endpoints.filter(node => {
      return node && node.verified === true && node.ads?.status !== 'present'
        && Number(node.success_rate) >= 0.8 && Number(node.samples) >= 5
        && Number.isFinite(node.median_rtt_ms) && validateNode(node);
    }).sort((a, b) => b.success_rate - a.success_rate || a.median_rtt_ms - b.median_rtt_ms);
    const selected = candidates.filter(node => {
      const key = node.server.toLowerCase() + ':' + node.port;
      if (unique.has(key)) return false;
      unique.add(key);
      return true;
    }).slice(0, MAX_PUBLIC).map((node, index) => normalizeNode({
      ...node,
      id: 'community-live-' + String(index + 1),
      name: 'مجتمعي ' + String(index + 1).padStart(2, '0') + ' — خارجي',
      ads_status: node.ads?.status || 'unknown',
      source: 'third_party',
      enabled: true
    }));
    if (selected.length < 20) throw new Error('Too few healthy candidates');
    return {nodes: selected, updated_at: payload.updated_at};
  }

  function fromLocalData(data) {
    if (!data || !Array.isArray(data.nodes)) throw new Error('Invalid nodes.json');
    const unique = new Set();
    const nodes = data.nodes.filter(node => validateNode(node) && node.enabled === true && node.ads_status !== 'present')
      .map(normalizeNode).filter(node => {
        const key = dedupeKey(node);
        if (unique.has(key)) return false;
        unique.add(key);
        return true;
      }).slice(0, MAX_PUBLIC);
    return {nodes, updated_at: data.source_checked_at || data.updated_at};
  }

  async function refreshPublic(silent = false) {
    const refresh = $('refresh');
    refresh.disabled = true;
    let usedLocal = false;
    try {
      let data;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);
        try {
          const response = await fetch(REMOTE_FEED, {cache:'no-store',signal:controller.signal});
          if (!response.ok) throw new Error('Remote status ' + response.status);
          data = fromRemoteFeed(await response.json());
          lastFeedSource = 'remote';
        } finally { clearTimeout(timeoutId); }
      } catch {
        usedLocal = true;
        const local = await fetch('./nodes.json', {cache:'no-store'});
        if (!local.ok) throw new Error('Snapshot unavailable');
        data = fromLocalData(await local.json());
        lastFeedSource = 'local snapshot';
      }
      publicNodes = data.nodes;
      const stamp = Date.parse(data.updated_at || '');
      lastRefresh = Number.isFinite(stamp) ? new Date(stamp).toLocaleString('ar-IQ', {timeZone:'UTC'}) + ' UTC' : 'غير معروف';
      if (!silent) notify(usedLocal ? 'تعذر الاتصال بالمصدر؛ عُرضت نسخة قائمة سابقة' : 'تحدّثت القائمة من مصدرها الخارجي');
    } catch {
      if (!silent) notify('تعذر تحديث البروكسيات العامة؛ المحفوظة على جهازك لم تتأثر');
    } finally {
      refresh.disabled = false;
      render();
    }
  }

  function parseProxyLink(raw) {
    let url;
    try { url = new URL(String(raw || '').trim()); }
    catch { throw new Error('الصق رابط MTProto كاملاً، مثل https://t.me/proxy?...'); }
    const tg = url.protocol === 'tg:' && url.hostname.toLowerCase() === 'proxy';
    const web = url.protocol === 'https:'
      && ['t.me', 'www.t.me', 'telegram.me'].includes(url.hostname.toLowerCase())
      && url.pathname.replace(/\/$/, '').toLowerCase() === '/proxy';
    if (!tg && !web) throw new Error('صيغة الرابط غير معروفة؛ استخدم tg://proxy أو https://t.me/proxy فقط');
    const portText = url.searchParams.get('port') || '';
    if (!/^\d{1,5}$/.test(portText)) throw new Error('المنفذ غير صحيح في الرابط');
    const candidate = {
      name: 'بروكسي مستورد',
      server: normalizeHost(url.searchParams.get('server')),
      port: Number(portText),
      secret: url.searchParams.get('secret') || ''
    };
    if (!validateNode(candidate)) throw new Error('الرابط لا يحتوي على بيانات اتصال MTProto صحيحة');
    return candidate;
  }

  function showError(text) {
    formError.textContent = text;
    formError.hidden = false;
  }
  function hideError() { formError.textContent = ''; formError.hidden = true; }

  $('parse-link').addEventListener('click', () => {
    hideError();
    try {
      const node = parseProxyLink($('proxy-link').value);
      $('proxy-name').value = node.name;
      $('proxy-host').value = node.server;
      $('proxy-port').value = String(node.port);
      $('proxy-secret').value = node.secret;
      notify('تم استخراج البيانات؛ راجعها ثم اضغط حفظ');
    } catch (error) { showError(error.message || 'تعذر قراءة الرابط'); }
  });

  form.addEventListener('submit', event => {
    event.preventDefault();
    hideError();
    const rawPort = $('proxy-port').value.trim();
    const candidate = {
      name: $('proxy-name').value.trim() || 'بروكسي خاص بي',
      server: normalizeHost($('proxy-host').value),
      port: /^\d{1,5}$/.test(rawPort) ? Number(rawPort) : NaN,
      secret: $('proxy-secret').value.trim()
    };
    if (!validateNode(candidate)) {
      showError('تأكد من عنوان الخادم والمنفذ (1–65535) ومفتاح MTProto: 32 رمزاً سداسياً على الأقل أو Base64 صالحاً.');
      return;
    }
    if (savedNodes.some(node => dedupeKey(node) === dedupeKey(candidate))) {
      showError('هذا البروكسي محفوظ عندك مسبقاً.');
      return;
    }
    if (savedNodes.length >= MAX_NODES) { showError('الحد الأقصى 30 بروكسي. احذف واحداً قبل الإضافة.'); return; }
    savedNodes.unshift(normalizeNode(candidate));
    persist();
    form.reset();
    $('proxy-link').value = '';
    render();
    notify('تم حفظ البروكسي على جهازك');
    $('saved-list').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  $('refresh').addEventListener('click', () => { void refreshPublic(); });
  $('toggle-public').addEventListener('click', () => { showAllPublic = !showAllPublic; render(); });
  $('public-search').addEventListener('input', event => { publicSearch = event.target.value.trim().toLowerCase(); render(); });
  $('only-no-ads').addEventListener('change', event => { onlyConfirmedNoAds = event.target.checked; render(); });
  $('export-btn').addEventListener('click', () => {
    if (!savedNodes.length) { notify('لا توجد بروكسيات شخصية لتصديرها'); return; }
    const data = { schema: 'qmrproxy.saved.v1', exported_at: new Date().toISOString(), nodes: savedNodes };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = nodeElement('a');
    a.href = url;
    a.download = 'QMRProxy-backup.json';
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 6000);
    notify('تم تجهيز نسخة JSON على جهازك');
  });

  $('import-file-btn').addEventListener('click', () => { $('backup-file').click(); });
  $('backup-file').addEventListener('change', async event => {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) { notify('ملف النسخة كبير جداً (الحد 128KB)'); return; }
    try {
      const data = JSON.parse(await file.text());
      if (!data || data.schema !== 'qmrproxy.saved.v1' || !Array.isArray(data.nodes)) throw new Error('Invalid format');
      if (data.nodes.length > MAX_NODES) throw new Error('Too many nodes');
      if (!data.nodes.every(validateNode)) throw new Error('Invalid node');
      const existing = new Set(savedNodes.map(dedupeKey));
      const newNodes = data.nodes.map(normalizeNode).filter(node => {
        const key = dedupeKey(node);
        if (existing.has(key)) return false;
        existing.add(key);
        return true;
      });
      const room = MAX_NODES - savedNodes.length;
      const added = newNodes.slice(0, room);
      savedNodes = savedNodes.concat(added);
      persist();
      render();
      notify(added.length ? 'تم استيراد ' + added.length + ' بروكسي' : 'لم توجد بروكسيات جديدة للاستيراد');
    } catch { notify('النسخة الاحتياطية غير صالحة. لم نغيّر بياناتك.'); }
  });

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
  });
  $('install-top').addEventListener('click', async () => {
    if (installPrompt) {
      await installPrompt.prompt();
      installPrompt = null;
    } else {
      notify('من قائمة المتصفح ⋮ اختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية»');
    }
  });

  render();
  void refreshPublic(true);
  setInterval(() => { if (!document.hidden) void refreshPublic(true); }, 30 * 60 * 1000);
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  }
})();
