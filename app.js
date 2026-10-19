/* ============================================================
   REWIND — Wayback Machine compatibility layer
   Public API: https://archive.org/wayback/available
   ============================================================ */

const AVAIL_ENDPOINT = 'https://archive.org/wayback/available';
const ARCHIVE_WEB = 'https://web.archive.org/web';
const HISTORY_KEY = 'rewind.history.v1';
const FIRST_YEAR = 1996;
const CURRENT_YEAR = new Date().getFullYear();
const TRACKER_RE = /^(utm_|gclid$|fbclid$|mc_cid$|mc_eid$|igshid$|ref_src$|_hsenc$|_hsmi$|vero_id$|oly_enc_id$|oly_anon_id$)/i;

const SUGGESTIONS = [
  'example.com',
  'wikipedia.org/wiki/ASCII_art',
  'geocities.com/SiliconValley',
  'apache.org',
  'web.archive.org/web/20100101000000/http://example.com',
];

const $ = (id) => document.getElementById(id);
const els = {
  form: $('rescue-form'),
  url: $('url-input'),
  date: $('date-input'),
  clear: $('clear-btn'),
  submit: $('submit-btn'),
  chips: $('suggest-chips'),
  year: $('stat-year'),
  uplink: $('uplink-status'),
  uplinkLabel: $('uplink-label'),
  resultTitle: $('result-title'),
  resultSub: $('result-sub'),
  open: $('btn-open'),
  copy: $('btn-copy'),
  viewerUrl: $('viewer-url'),
  viewerStatus: $('viewer-status'),
  viewerEmpty: $('viewer-empty'),
  viewerLoading: $('viewer-loading'),
  viewerError: $('viewer-error'),
  loadingText: $('loading-text'),
  errorText: $('error-text'),
  errorRetry: $('error-retry'),
  errorSearch: $('error-search'),
  frame: $('replay-frame'),
  caption: $('viewer-caption'),
  raw: $('btn-raw'),
  refresh: $('btn-refresh'),
  api: $('btn-api'),
  repStatus: $('rep-status'),
  repCanonical: $('rep-canonical'),
  repCapture: $('rep-capture'),
  repResolution: $('rep-resolution'),
  repProtocol: $('rep-protocol'),
  repLatency: $('rep-latency'),
  monthYear: $('month-year-label'),
  monthGrid: $('month-grid'),
  history: $('history-list'),
  clearHistory: $('btn-clear-history'),
  timeline: $('timeline'),
  timelineEmpty: $('timeline-empty'),
  scrub: $('year-scrub'),
  scrubLabel: $('scrub-label'),
  bookmarklet: $('bookmarklet'),
  copyBookmarklet: $('btn-copy-bookmarklet'),
  copyCurl: $('btn-copy-curl'),
  curl: $('curl-code'),
  toasts: $('toast-stack'),
};

const BOOKMARKLET = "javascript:(function(){location.href='https://web.archive.org/web/'+location.href})()";

const state = {
  current: null,
  lookupToken: 0,
  probeUrl: null,
  presence: new Map(),
  selectedYear: null,
  months: [],
  monthToken: 0,
  history: loadHistory(),
  lastApiUrl: null,
  lastRescueRaw: '',
};

/* ---------- utilities ---------- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad = (n) => String(n).padStart(2, '0');

function currentYearMonth() {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

function formatTimestamp(ts, style = 'long') {
  if (!ts || ts.length < 4) return null;
  const year = ts.slice(0, 4);
  const month = ts.slice(4, 6) || '01';
  const day = ts.slice(6, 8) || '01';
  const hour = ts.slice(8, 10) || '00';
  const min = ts.slice(10, 12) || '00';
  const date = new Date(Date.UTC(+year, +month - 1, +day, +hour, +min));
  if (Number.isNaN(date.getTime())) return null;
  if (style === 'short') return `${year}-${month}-${day}`;
  if (style === 'iso') return date.toISOString().replace('.000Z', 'Z');
  return `${date.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
  })} UTC`;
}

function relativeTime(ts) {
  if (!ts || ts.length < 8) return null;
  const then = new Date(Date.UTC(+ts.slice(0, 4), +ts.slice(4, 6) - 1, +ts.slice(6, 8)));
  if (Number.isNaN(then.getTime())) return null;
  const days = Math.round((Date.now() - then.getTime()) / 86400000);
  if (days < 1) return 'today';
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30.44);
  if (months < 12) return `${months}mo ago`;
  const years = (days / 365.25);
  return `${years >= 10 ? Math.round(years) : years.toFixed(1)}y ago`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function setUplink(stateName, label) {
  els.uplink.dataset.state = stateName;
  els.uplinkLabel.textContent = label;
}

function toast(message, kind = 'ok') {
  const node = document.createElement('div');
  node.className = `toast ${kind}`;
  node.textContent = message;
  els.toasts.append(node);
  setTimeout(() => {
    node.classList.add('leaving');
    node.addEventListener('animationend', () => node.remove(), { once: true });
  }, 2600);
}

async function copyText(text, label = 'Copied to clipboard') {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.append(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    toast(label);
    return true;
  } catch {
    toast('Clipboard blocked by the browser', 'err');
    return false;
  }
}

function setBusy(busy) {
  els.form.classList.toggle('is-busy', busy);
  els.submit.disabled = busy;
  els.url.disabled = busy;
  els.date.disabled = busy;
}

/* ---------- URL handling ---------- */

function extractArchiveUrl(value) {
  try {
    const u = new URL(value);
    if (!/(^|\.)(web\.)?archive\.org$/i.test(u.hostname)) return null;
    const m = u.pathname.match(/^\/web\/(\d{4,14})(?:[a-z]{0,4}_)?\/(.*)$/i);
    if (!m) return null;
    let original = m[2];
    if (!/^https?:\/\//i.test(original)) original = 'https://' + original;
    return { url: original, timestamp: m[1] };
  } catch {
    return null;
  }
}

function normalizeUrl(raw) {
  let input = String(raw || '').trim();
  if (!input) throw new Error('Enter a URL to recover.');
  if (input.startsWith('<') && input.endsWith('>')) input = input.slice(1, -1).trim();

  const archive = extractArchiveUrl(input);
  let timestamp = null;
  if (archive) {
    input = archive.url;
    timestamp = archive.timestamp;
  }

  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) input = 'https://' + input;

  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error('That does not parse as a URL.');
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    throw new Error('Only http and https pages can be archived.');
  }

  parsed.hostname = parsed.hostname.toLowerCase();
  parsed.hash = '';

  let stripped = 0;
  for (const key of [...parsed.searchParams.keys()]) {
    if (TRACKER_RE.test(key)) {
      parsed.searchParams.delete(key);
      stripped += 1;
    }
  }

  return {
    url: parsed.toString(),
    host: parsed.hostname,
    protocol: parsed.protocol.replace(':', ''),
    timestamp,
    stripped,
    raw: String(raw).trim(),
  };
}

function buildVariants(canonical) {
  const out = [];
  const add = (value) => { if (value && !out.includes(value)) out.push(value); };
  add(canonical);

  const base = new URL(canonical);
  const flipped = new URL(base);
  flipped.protocol = base.protocol === 'https:' ? 'http:' : 'https:';
  add(flipped.toString());

  if (base.hostname.startsWith('www.')) {
    const bare = new URL(base);
    bare.hostname = base.hostname.slice(4);
    add(bare.toString());
  } else if (base.hostname.includes('.')) {
    const www = new URL(base);
    www.hostname = 'www.' + base.hostname;
    add(www.toString());
  }

  const flippedWww = new URL(flipped);
  if (flippedWww.hostname.startsWith('www.')) {
    flippedWww.hostname = flippedWww.hostname.slice(4);
    add(flippedWww.toString());
  }
  return out;
}

/* ---------- API ---------- */

async function fetchJson(url, { timeout = 15000, retries = 1 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) {
      if (retries > 0 && (res.status === 429 || res.status >= 500)) {
        clearTimeout(timer);
        await sleep(700);
        return fetchJson(url, { timeout, retries: retries - 1 });
      }
      throw new Error(`Archive responded ${res.status}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function availabilityUrl(url, timestamp) {
  const params = new URLSearchParams({ url });
  if (timestamp) params.set('timestamp', String(timestamp).replace(/\D/g, '').slice(0, 14));
  return `${AVAIL_ENDPOINT}?${params.toString()}`;
}

async function availability(url, timestamp) {
  const started = performance.now();
  const data = await fetchJson(availabilityUrl(url, timestamp));
  const closest = data?.archived_snapshots?.closest;
  return {
    hit: closest && closest.available ? closest : null,
    raw: data,
    latency: Math.round(performance.now() - started),
  };
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = await fn(items[index], index);
      } catch (error) {
        results[index] = { error };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

/* ---------- viewer ---------- */

let frameShown = false;

function showEmpty() {
  els.viewerEmpty.hidden = false;
  els.viewerLoading.hidden = true;
  els.viewerError.hidden = true;
  els.frame.hidden = true;
}

function showLoading(text) {
  els.loadingText.textContent = text;
  els.viewerEmpty.hidden = true;
  els.viewerError.hidden = true;
  els.frame.hidden = true;
  els.viewerLoading.hidden = false;
}

function showError(message) {
  els.errorText.textContent = message;
  els.viewerEmpty.hidden = true;
  els.viewerLoading.hidden = true;
  els.frame.hidden = true;
  els.viewerError.hidden = false;
}

function showFrame(src) {
  frameShown = false;
  els.viewerEmpty.hidden = true;
  els.viewerLoading.hidden = false;
  els.viewerError.hidden = true;
  els.frame.hidden = false;
  els.frame.src = 'about:blank';

  const done = () => {
    if (frameShown) return;
    frameShown = true;
    els.viewerLoading.hidden = true;
  };
  setTimeout(() => {
    els.frame.addEventListener('load', done, { once: true });
    els.frame.src = src;
    setTimeout(done, 14000);
  }, 20);
}

function decodeArchiveTarget(archiveUrl) {
  const m = String(archiveUrl).match(/\/web\/\d+[a-z_]*\/(.*)$/i);
  return m ? decodeURIComponent(m[1]) : archiveUrl;
}

function toRawUrl(archiveUrl) {
  return String(archiveUrl).replace(/(\/web\/\d+)(?!id_)/, '$1id_').replace(/^http:/, 'https:');
}

function loadCapture(capture) {
  const replay = String(capture.url).replace(/^http:/, 'https:');
  const target = decodeArchiveTarget(replay);
  const ts = capture.timestamp;

  state.current = { ...state.current, capture, replay };
  showFrame(replay);

  els.viewerUrl.textContent = `web.archive.org/web/${ts}/${target}`;
  els.viewerStatus.textContent = capture.status ? `HTTP ${capture.status}` : 'capture';
  els.viewerStatus.className = `chrome-badge ${capture.status === '200' ? 'ok' : 'warn'}`;
  els.caption.textContent = `Replaying ${formatTimestamp(ts, 'short') || ts} capture of ${target}`;

  els.resultTitle.textContent = target.length > 64 ? target.slice(0, 61) + '…' : target;
  els.resultSub.textContent = `Nearest capture served from the archive: ${formatTimestamp(ts)}.`;

  els.open.setAttribute('aria-disabled', 'false');
  els.copy.disabled = false;
  els.raw.disabled = false;
  els.refresh.disabled = false;
  els.api.disabled = false;

  els.open.href = replay;
  els.open.dataset.url = replay;
  els.raw.dataset.url = toRawUrl(replay);
  els.errorSearch.href = `https://web.archive.org/web/*/${target}`;

  renderReport(state.current);
  renderMonths();
  setUplink('ok', `Archive capture ${ts.slice(0, 4)}`);
}

/* ---------- report ---------- */

function renderReport(ctx) {
  if (!ctx?.capture) return;
  const { capture, requested } = ctx;
  const ts = capture.timestamp;

  els.repStatus.textContent = capture.status === '200' ? 'Capture available' : `Capture (HTTP ${capture.status || '?'})`;
  els.repStatus.className = capture.status === '200' ? 'ok' : 'warn';

  els.repCanonical.textContent = requested.url;
  els.repCanonical.title = requested.url;

  els.repCapture.textContent = `${formatTimestamp(ts)} · ${relativeTime(ts) || 'archived'}`;
  els.repCapture.className = '';

  const matchedVariant = capture.matched && capture.matched !== requested.url;
  els.repResolution.textContent = matchedVariant
    ? `Fallback variant: ${capture.matched}`
    : requested.stripped
      ? `Canonical match · ${requested.stripped} tracking param${requested.stripped > 1 ? 's' : ''} stripped`
      : 'Exact canonical match';
  els.repResolution.className = '';

  els.repProtocol.textContent = requested.protocol === 'https'
    ? 'https (upgraded if needed)'
    : requested.protocol;
  els.repLatency.textContent = `${capture.latency} ms · availability index`;
}

/* ---------- months ---------- */

function renderMonths() {
  const year = state.selectedYear;
  els.monthYear.textContent = year ? String(year) : '—';
  if (!year) {
    els.monthGrid.innerHTML = '<p class="panel-empty">Pick a year on the timeline to probe its months.</p>';
    return;
  }
  if (!state.months.length) {
    els.monthGrid.innerHTML = '<p class="panel-empty">Probing months…</p>';
    return;
  }
  const activeTs = state.current?.capture?.timestamp;
  els.monthGrid.innerHTML = state.months.map((m) => {
    const label = `${pad(m.month)}`;
    const active = m.hit && m.hit.timestamp === activeTs;
    const classes = ['month-cell'];
    if (m.hit) classes.push('hit');
    if (active) classes.push('active');
    const hint = m.hit
      ? `${formatTimestamp(m.hit.timestamp, 'short')} · ${relativeTime(m.hit.timestamp) || ''}`
      : 'no probe hit';
    return `<button type="button" class="${classes.join(' ')}" data-index="${m.month - 1}" ${m.hit ? '' : 'disabled'} title="${escapeHtml(hint)}">
      <span class="m">${m.monthName}</span>
      <span class="y">${m.hit ? m.hit.timestamp.slice(0, 8) : '—'}</span>
    </button>`;
  }).join('');
}

async function probeMonths(year) {
  const url = state.current?.requested?.url;
  if (!url) return;
  const token = ++state.monthToken;
  state.months = [];
  renderMonths();

  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const results = await mapLimit(months, 6, async (month) => {
    const stamp = `${year}${pad(month)}15`;
    const { hit } = await availability(url, stamp);
    return {
      month,
      monthName: new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }),
      hit: hit && hit.timestamp.slice(0, 4) === String(year) ? hit : null,
    };
  });

  if (token !== state.monthToken) return;

  const byMonth = new Map();
  for (const result of results) {
    if (!result || result.error || !result.hit) continue;
    const hit = result.hit;
    if (hit.timestamp.slice(0, 4) !== String(year)) continue;
    const stampMonth = Number(hit.timestamp.slice(4, 6));
    const existing = byMonth.get(stampMonth);
    if (!existing || Math.abs(result.month - stampMonth) < Math.abs(existing.probe - stampMonth)) {
      byMonth.set(stampMonth, { hit, probe: result.month });
    }
  }

  state.months = months.map((month) => ({
    month,
    monthName: new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }),
    hit: byMonth.get(month)?.hit || null,
  }));
  renderMonths();
}

/* ---------- timeline ---------- */

function renderTimeline() {
  const url = state.current?.requested?.url;
  if (!url) {
    els.timeline.innerHTML = '<p class="timeline-empty" id="timeline-empty">Run a lookup to chart archive coverage across the years.</p>';
    return;
  }
  const years = [];
  for (let y = FIRST_YEAR; y <= CURRENT_YEAR; y += 1) years.push(y);
  els.timeline.innerHTML = years.map((year) => {
    const entry = state.presence.get(`${url}|${year}`);
    const classes = ['year-col'];
    let height = 6;
    let tip = `${year} · probing…`;
    if (entry) {
      if (entry.hit) {
        classes.push('hit');
        height = 100;
        tip = `${year} · capture ${entry.hit.timestamp} (${entry.hit.status || '?'})`;
      } else if (entry.error) {
        tip = `${year} · probe failed`;
      } else {
        tip = `${year} · no capture indexed`;
      }
    } else {
      classes.push('pending');
    }
    if (state.selectedYear === year) classes.push('selected');
    return `<button type="button" class="${classes.join(' ')}" data-year="${year}" data-tip="${escapeHtml(tip)}" title="${escapeHtml(tip)}">
      <span class="year-bar" style="height:${height}%"></span>
      <span class="year-label">${year % 5 === 0 || year === FIRST_YEAR || year === CURRENT_YEAR ? year : ''}</span>
    </button>`;
  }).join('');
}

async function probeYears(url) {
  const years = [];
  for (let y = FIRST_YEAR; y <= CURRENT_YEAR; y += 1) years.push(y);

  const pending = years.filter((y) => !state.presence.has(`${url}|${y}`));
  renderTimeline();
  if (!pending.length) return;

  await mapLimit(pending, 6, async (year) => {
    if (state.probeUrl !== url) return;
    try {
      const { hit } = await availability(url, `${year}0701`);
      const inYear = hit && hit.timestamp.slice(0, 4) === String(year);
      state.presence.set(`${url}|${year}`, { hit: inYear ? hit : null, error: false });
      if (state.probeUrl === url) renderTimeline();
    } catch {
      state.presence.set(`${url}|${year}`, { hit: null, error: true });
      if (state.probeUrl === url) renderTimeline();
    }
  });
  if (state.probeUrl === url) {
    setUplink('ok', 'Coverage mapped');
    renderTimeline();
  }
}

function selectYear(year, { load = false } = {}) {
  state.selectedYear = year;
  renderTimeline();
  els.scrub.value = String(year);
  els.scrubLabel.textContent = String(year);
  const entry = state.current?.requested?.url
    ? state.presence.get(`${state.current.requested.url}|${year}`)
    : null;
  probeMonths(year);
  if (load && entry?.hit) {
    loadCapture({ ...entry.hit, matched: state.current.requested.url, latency: state.current.capture?.latency || 0 });
  }
}

/* ---------- history ---------- */

function loadHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.slice(0, 8) : [];
  } catch {
    return [];
  }
}

function saveHistory() {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history.slice(0, 8))); } catch { /* ignore */ }
}

function addHistory(entry) {
  state.history = [entry, ...state.history.filter((h) => h.url !== entry.url)].slice(0, 8);
  saveHistory();
  renderHistory();
}

function renderHistory() {
  if (!state.history.length) {
    els.history.innerHTML = '<li class="panel-empty">Your recent lookups will collect here.</li>';
    return;
  }
  els.history.innerHTML = state.history.map((item) => `
    <li class="history-item" data-url="${escapeHtml(item.url)}" role="button" tabindex="0" title="${escapeHtml(item.url)}">
      <span class="h-url">${escapeHtml(item.url.replace(/^https?:\/\//, ''))}</span>
      <span class="h-ts">${item.ts ? item.ts.slice(0, 4) : '—'}</span>
    </li>`).join('');
}

/* ---------- main rescue flow ---------- */

async function rescue(raw, dateValue) {
  const token = ++state.lookupToken;
  let requested;
  try {
    requested = normalizeUrl(raw);
  } catch (error) {
    toast(error.message, 'err');
    showError(error.message);
    setUplink('error', 'Bad URL');
    return;
  }

  state.lastRescueRaw = requested.raw;
  els.url.value = requested.raw;
  state.probeUrl = requested.url;
  state.current = { requested, capture: null };
  state.selectedYear = null;
  state.months = [];
  state.monthToken += 1;
  renderTimeline();
  renderMonths();

  const targetTs = requested.timestamp || (dateValue ? dateValue.replace(/-/g, '') : '');
  if (requested.timestamp) els.date.value = `${requested.timestamp.slice(0, 4)}-${requested.timestamp.slice(4, 6)}-${requested.timestamp.slice(6, 8)}`;

  setBusy(true);
  setUplink('busy', 'Querying archive…');
  showLoading(`Scanning availability index for ${requested.host}…`);
  els.resultTitle.textContent = `Recovering ${requested.host}`;
  els.resultSub.textContent = 'Normalizing the URL and querying the Wayback availability index.';
  els.viewerStatus.textContent = 'querying';
  els.viewerStatus.className = 'chrome-badge warn';

  const variants = buildVariants(requested.url);
  let capture = null;

  try {
    for (const variant of variants) {
      if (token !== state.lookupToken) return;
      const { hit, latency } = await availability(variant, targetTs);
      if (hit) {
        capture = { ...hit, matched: variant, latency };
        break;
      }
    }
  } catch (error) {
    if (token !== state.lookupToken) return;
    setBusy(false);
    setUplink('error', 'Archive unreachable');
    showError(`Could not reach the Internet Archive: ${error.message}`);
    els.resultTitle.textContent = 'Archive unreachable';
    els.resultSub.textContent = 'The availability index did not answer. Check your connection and retry.';
    els.viewerStatus.textContent = 'offline';
    els.viewerStatus.className = 'chrome-badge err';
    return;
  }

  if (token !== state.lookupToken) return;
  setBusy(false);

  state.lastApiUrl = availabilityUrl(capture?.matched || requested.url, targetTs);
  state.current = { requested, capture };
  state.months = [];
  state.selectedYear = capture ? Number(capture.timestamp.slice(0, 4)) : null;
  els.scrub.value = String(state.selectedYear || CURRENT_YEAR);
  els.scrubLabel.textContent = String(state.selectedYear || CURRENT_YEAR);

  if (!capture) {
    setUplink('error', 'No capture found');
    showError(`The archive has no indexed snapshot for ${requested.host}${targetTs ? ` near ${targetTs}` : ''}. Try a different date or check the variants.`);
    els.resultTitle.textContent = 'No capture found';
    els.resultSub.textContent = `Nothing indexed for ${requested.host}. The Wayback Machine may never have crawled it.`;
    els.viewerStatus.textContent = '404';
    els.viewerStatus.className = 'chrome-badge err';
    els.open.setAttribute('aria-disabled', 'true');
    els.copy.disabled = true;
    els.raw.disabled = true;
    els.refresh.disabled = true;
    els.api.disabled = false;
    els.errorSearch.href = `https://web.archive.org/web/*/${requested.url}`;
    for (let year = FIRST_YEAR; year <= CURRENT_YEAR; year += 1) {
      const key = `${requested.url}|${year}`;
      if (!state.presence.has(key)) state.presence.set(key, { hit: null, error: false });
    }
    state.selectedYear = null;
    renderTimeline();
    renderMonths();
    els.repStatus.textContent = 'No capture indexed';
    els.repStatus.className = 'err';
    els.repCanonical.textContent = requested.url;
    els.repCapture.textContent = '—';
    els.repResolution.textContent = `${variants.length} variants attempted`;
    els.repProtocol.textContent = requested.protocol;
    els.repLatency.textContent = 'availability index';
    addHistory({ url: requested.url, ts: null, at: Date.now() });
    return;
  }

  loadCapture(capture);
  addHistory({ url: requested.url, ts: capture.timestamp, at: Date.now() });
  renderTimeline();
  probeYears(requested.url);
  probeMonths(state.selectedYear);
  if (!state.presence.has(`${requested.url}|${state.selectedYear}`)) {
    state.presence.set(`${requested.url}|${state.selectedYear}`, { hit: capture, error: false });
    renderTimeline();
  }
}

/* ---------- init ---------- */

function init() {
  els.year.textContent = String(CURRENT_YEAR);
  els.scrub.min = String(FIRST_YEAR);
  els.scrub.max = String(CURRENT_YEAR);
  els.scrub.value = String(CURRENT_YEAR);
  els.scrubLabel.textContent = String(CURRENT_YEAR);
  els.date.max = new Date().toISOString().slice(0, 10);

  els.chips.innerHTML = SUGGESTIONS.map((s) => `<button type="button" class="chip" data-url="${escapeHtml(s)}">${escapeHtml(s.length > 34 ? s.slice(0, 31) + '…' : s)}</button>`).join('');

  els.bookmarklet.href = BOOKMARKLET;
  els.curl.textContent = `curl "https://archive.org/wayback/available?url=example.com&timestamp=20100101"`;

  renderHistory();
  renderTimeline();

  els.form.addEventListener('submit', (event) => {
    event.preventDefault();
    rescue(els.url.value, els.date.value);
  });

  els.url.addEventListener('input', () => {
    els.clear.hidden = !els.url.value;
  });

  els.clear.addEventListener('click', () => {
    els.url.value = '';
    els.clear.hidden = true;
    els.url.focus();
  });

  els.chips.addEventListener('click', (event) => {
    const chip = event.target.closest('.chip');
    if (!chip) return;
    els.url.value = chip.dataset.url;
    els.clear.hidden = false;
    els.form.requestSubmit();
  });

  els.errorRetry.addEventListener('click', () => rescue(els.url.value, els.date.value));

  els.open.addEventListener('click', (event) => {
    if (els.open.getAttribute('aria-disabled') === 'true') event.preventDefault();
  });
  els.raw.addEventListener('click', () => {
    if (els.raw.dataset.url) window.open(els.raw.dataset.url, '_blank', 'noopener');
  });
  els.copy.addEventListener('click', () => {
    if (state.current?.replay) copyText(state.current.replay, 'Archive link copied');
  });
  els.refresh.addEventListener('click', () => {
    if (!state.current?.replay) return;
    showFrame(state.current.replay);
    toast('Reloading capture');
  });
  els.api.addEventListener('click', () => {
    if (state.lastApiUrl) window.open(state.lastApiUrl, '_blank', 'noopener');
  });

  els.timeline.addEventListener('click', (event) => {
    const col = event.target.closest('.year-col');
    if (!col) return;
    selectYear(Number(col.dataset.year), { load: true });
  });

  els.monthGrid.addEventListener('click', (event) => {
    const cell = event.target.closest('.month-cell');
    if (!cell || cell.disabled) return;
    const entry = state.months[Number(cell.dataset.index)];
    if (entry?.hit) loadCapture({ ...entry.hit, matched: state.current.requested.url, latency: state.current.capture?.latency || 0 });
  });

  els.history.addEventListener('click', (event) => {
    const item = event.target.closest('.history-item');
    if (!item) return;
    els.url.value = item.dataset.url;
    els.clear.hidden = false;
    els.form.requestSubmit();
  });
  els.history.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const item = event.target.closest('.history-item');
    if (!item) return;
    event.preventDefault();
    els.url.value = item.dataset.url;
    els.form.requestSubmit();
  });

  els.clearHistory.addEventListener('click', () => {
    state.history = [];
    saveHistory();
    renderHistory();
  });

  els.scrub.addEventListener('input', () => {
    els.scrubLabel.textContent = els.scrub.value;
  });
  els.scrub.addEventListener('change', () => {
    const year = Number(els.scrub.value);
    if (!state.current?.requested) return;
    els.date.value = `${year}-01-01`;
    rescue(state.current.requested.url, `${year}-01-01`);
  });

  els.copyBookmarklet.addEventListener('click', () => copyText(BOOKMARKLET, 'Bookmarklet code copied'));
  els.copyCurl.addEventListener('click', () => copyText(els.curl.textContent, 'cURL copied'));

  document.addEventListener('keydown', (event) => {
    const tag = document.activeElement?.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable;
    if (event.key === '/' && !typing) {
      event.preventDefault();
      els.url.focus();
      els.url.select();
    }
  });
}

init();
