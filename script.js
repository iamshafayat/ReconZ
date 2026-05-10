
/* ── CANVAS PARTICLE BG ── */
(function () {
    const c = document.getElementById('bg-canvas');
    const ctx = c.getContext('2d');
    let W, H, particles = [], lines = [];

    function resize() { W = c.width = innerWidth; H = c.height = innerHeight; }
    resize(); window.addEventListener('resize', resize);

    class Particle {
        constructor() {
            this.x = Math.random() * W; this.y = Math.random() * H;
            this.vx = (Math.random() - .5) * .25; this.vy = (Math.random() - .5) * .25;
            this.r = Math.random() * 1.5 + .5;
            this.alpha = Math.random() * .5 + .1;
        }
        update() {
            this.x += this.vx; this.y += this.vy;
            if (this.x < 0 || this.x > W) this.vx *= -1;
            if (this.y < 0 || this.y > H) this.vy *= -1;
        }
        draw() {
            ctx.beginPath(); ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(99,179,255,${this.alpha})`; ctx.fill();
        }
    }

    for (let i = 0; i < 90; i++) particles.push(new Particle());

    function drawLines() {
        for (let i = 0; i < particles.length; i++) {
            for (let j = i + 1; j < particles.length; j++) {
                const dx = particles[i].x - particles[j].x, dy = particles[i].y - particles[j].y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < 130) {
                    ctx.beginPath();
                    ctx.moveTo(particles[i].x, particles[i].y);
                    ctx.lineTo(particles[j].x, particles[j].y);
                    ctx.strokeStyle = `rgba(99,179,255,${.06 * (1 - dist / 130)})`;
                    ctx.lineWidth = .6; ctx.stroke();
                }
            }
        }
    }

    function loop() {
        ctx.clearRect(0, 0, W, H);
        particles.forEach(p => { p.update(); p.draw(); });
        drawLines();
        requestAnimationFrame(loop);
    }
    loop();
})();

/* ── STATE ── */
let allResults = [];
let currentPage = 0;
let sources = { hackertarget: true, urlscan: true, crtsh: true, jldc: true, certspotter: true, rapiddns: true, dnsrepo: true };
let sourceCounts = { hackertarget: 0, urlscan: 0, crtsh: 0, jldc: 0, certspotter: 0, rapiddns: 0, dnsrepo: 0 };

/* ── ENDPOINT RECON STATE ── */
let epResults = [];
let epCurrentPage = 0;
const EP_PAGE_SIZE = 100;

/* ── TAB SWITCHING ── */
function switchTab(tab) {
    const isSub = tab === 'subdomain';
    document.getElementById('tab-subdomain').style.display = isSub ? '' : 'none';
    document.getElementById('tab-endpoint').style.display = isSub ? 'none' : '';
    
    // Sync desktop nav
    document.getElementById('pill-subdomain').classList.toggle('active', isSub);
    document.getElementById('pill-endpoint').classList.toggle('active', !isSub);

    // Sync mobile nav (if elements exist)
    const mSub = document.getElementById('mobileSubdomainBtn');
    const mEp = document.getElementById('mobileEndpointBtn');
    if (mSub) mSub.classList.toggle('active', isSub);
    if (mEp) mEp.classList.toggle('active', !isSub);
    
    // Update Hero Content
    const badge = document.getElementById('hero-badge-text');
    const title = document.getElementById('page-title-text');
    const sub = document.getElementById('page-subtitle-text');

    if (badge) {
        badge.innerHTML = isSub ? 
            '<span class="hero-badge-dot"></span> Passive Subdomain Discovery' : 
            '<span class="hero-badge-dot"></span> Passive Endpoint Harvesting';
    }
    if (title) {
        title.textContent = isSub ? 'Subdomain Reconnaissance' : 'Endpoint Discovery';
    }
    if (sub) {
        sub.textContent = isSub ? 
            'Map your target\'s entire infrastructure footprint using aggregated certificate transparency logs and public DNS archives — zero contact with the target server.' : 
            'Extract API routes, parameters, and hidden paths from web archives like Wayback Machine and Common Crawl — pure passive recon, no packets sent directly.';
    }
}

/* ── CORS PROXY — try multiple, return first success ── */
const PROXY_LIST = [
    url => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
    url => `https://cors.eu.org/${url}`,
    url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    url => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
    url => `https://thingproxy.freeboard.io/fetch/${url}`,
];

// Large-response proxy list — skips corsproxy.io which has a payload size cap (413)
const PROXY_LIST_LARGE = [
    url => `https://cors.eu.org/${url}`,
    url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    url => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
    url => `https://thingproxy.freeboard.io/fetch/${url}`,
    url => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
];

async function proxyFetch(targetUrl, timeoutMs = 13000, large = false) {
    const list = large ? PROXY_LIST_LARGE : PROXY_LIST;
    let lastErr;
    for (const make of list) {
        try {
            const res = await fetch(make(targetUrl), { signal: AbortSignal.timeout(timeoutMs) });
            if (res.ok) return res;
            lastErr = new Error('HTTP ' + res.status);
        } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('All proxies failed');
}

/* ── SOURCE TOGGLE ── */
function toggleSource(el, name) {
    sources[name] = el.checked;
    const label = document.getElementById('toggle-' + name);
    label.classList.toggle('active', el.checked);
}

/* ── ENDPOINT SOURCE TOGGLE ── */
const epSources = { wayback: true, commoncrawl: true, otx: true, urlscan: true };

function toggleEpSource(el, name) {
    epSources[name] = el.checked;
    document.getElementById('ep-toggle-' + name).classList.toggle('active', el.checked);
}

function updateEpToggleCount(name, count) {
    const toggle = document.getElementById('ep-toggle-' + name);
    if (!toggle) return;
    let countEl = toggle.querySelector('.toggle-count');
    if (!countEl) {
        countEl = document.createElement('span');
        countEl.className = 'toggle-count';
        toggle.appendChild(countEl);
    }
    countEl.textContent = count.toLocaleString();
}

/* ── SUBDOMAIN VALIDATOR — strips false positives ── */
function isValidSubdomain(raw, domain) {
    if (!raw) return false;
    const s = raw.trim().toLowerCase();
    // reject emails, paths, protocols, ports, wildcards
    if (s.includes('@') || s.includes('/') || s.includes(':') || s.startsWith('*')) return false;
    // must only contain valid hostname chars
    if (!/^[a-z0-9][a-z0-9.\-]*[a-z0-9]$/.test(s) && s !== domain) return false;
    // must end with .domain (actual subdomain) or equal domain itself
    if (s !== domain && !s.endsWith('.' + domain)) return false;
    // must have at least one label before the registered domain
    if (s === domain) return false;
    // no label longer than 63 chars
    if (s.split('.').some(l => l.length > 63)) return false;
    return true;
}

/* ── SCAN ── */
async function startScan() {
    const domain = document.getElementById('domain-input').value.trim().toLowerCase()
        .replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\/$/, '');
    if (!domain || !/^[a-z0-9][a-z0-9.\-]*\.[a-z]{2,}$/.test(domain)) {
        showToast('Please enter a valid domain name.', 'error'); return;
    }
    if (!sources.hackertarget && !sources.urlscan && !sources.crtsh) {
        showToast('Enable at least one source.', 'error'); return;
    }

    const btn = document.getElementById('scan-btn');
    btn.disabled = true;
    btn.querySelector('.btn-text').innerHTML = '<span class="spinner"></span> Scanning…';

    allResults = [];
    currentPage = 0;
    sourceCounts = { hackertarget: 0, urlscan: 0, crtsh: 0, jldc: 0, certspotter: 0, rapiddns: 0, dnsrepo: 0 };
    ['hackertarget', 'urlscan', 'crtsh', 'jldc', 'certspotter', 'rapiddns', 'dnsrepo'].forEach(s => { const el = document.querySelector(`#toggle-${s} .toggle-count`); if (el) el.remove(); });
    setStats(0, 0, 0, 0);
    document.getElementById('stats-row').style.display = 'grid';
    clearTable();
    document.getElementById('httpx-tip').classList.remove('visible');
    showProgress();
    setProgress(0);

    const activeSources = [];
    if (sources.hackertarget) activeSources.push('hackertarget');
    if (sources.urlscan) activeSources.push('urlscan');
    if (sources.crtsh) activeSources.push('crtsh');
    if (sources.jldc) activeSources.push('jldc');
    if (sources.certspotter) activeSources.push('certspotter');
    if (sources.rapiddns) activeSources.push('rapiddns');
    if (sources.dnsrepo) activeSources.push('dnsrepo');

    initSourceStatus(activeSources);
    setSourceState('hackertarget', sources.hackertarget ? 'pending' : 'none');
    setSourceState('urlscan', sources.urlscan ? 'pending' : 'none');
    setSourceState('crtsh', sources.crtsh ? 'pending' : 'none');
    setSourceState('jldc', sources.jldc ? 'pending' : 'none');
    setSourceState('certspotter', sources.certspotter ? 'pending' : 'none');
    setSourceState('rapiddns', sources.rapiddns ? 'pending' : 'none');
    setSourceState('dnsrepo', sources.dnsrepo ? 'pending' : 'none');

    const promises = [];
    if (sources.hackertarget) {
        setSourceState('hackertarget', 'loading');
        promises.push(
            fetchHackerTarget(domain)
                .then(r => { sourceCounts.hackertarget = r.length; mergeResults(r, 'hackertarget'); setSourceState('hackertarget', 'done', r.length); updateToggleCount('hackertarget', r.length); renderTable(allResults); updateStats(); })
                .catch(e => { if (e.quota) { setSourceState('hackertarget', 'quota'); } else { console.warn('HackerTarget:', e); setSourceState('hackertarget', 'error', 0); } })
        );
    }
    if (sources.urlscan) {
        setSourceState('urlscan', 'loading');
        promises.push(
            fetchURLScan(domain)
                .then(r => { sourceCounts.urlscan = r.length; mergeResults(r, 'urlscan'); setSourceState('urlscan', 'done', r.length); updateToggleCount('urlscan', r.length); renderTable(allResults); updateStats(); })
                .catch(e => { console.warn('URLScan:', e); setSourceState('urlscan', 'error', 0); })
        );
    }
    if (sources.crtsh) {
        setSourceState('crtsh', 'loading');
        promises.push(
            fetchCrtSh(domain)
                .then(r => { sourceCounts.crtsh = r.length; mergeResults(r, 'crtsh'); setSourceState('crtsh', 'done', r.length); updateToggleCount('crtsh', r.length); renderTable(allResults); updateStats(); })
                .catch(e => { console.warn('crt.sh:', e); setSourceState('crtsh', 'error', 0); })
        );
    }
    if (sources.jldc) {
        setSourceState('jldc', 'loading');
        promises.push(
            fetchJLDC(domain)
                .then(r => { sourceCounts.jldc = r.length; mergeResults(r, 'jldc'); setSourceState('jldc', 'done', r.length); updateToggleCount('jldc', r.length); renderTable(allResults); updateStats(); })
                .catch(e => { console.warn('JLDC:', e); setSourceState('jldc', 'error', 0); })
        );
    }
    if (sources.certspotter) {
        setSourceState('certspotter', 'loading');
        promises.push(
            fetchCertSpotter(domain)
                .then(r => { sourceCounts.certspotter = r.length; mergeResults(r, 'certspotter'); setSourceState('certspotter', 'done', r.length); updateToggleCount('certspotter', r.length); renderTable(allResults); updateStats(); })
                .catch(e => { console.warn('CertSpotter:', e); setSourceState('certspotter', 'error', 0); })
        );
    }
    if (sources.rapiddns) {
        setSourceState('rapiddns', 'loading');
        promises.push(
            fetchRapidDNS(domain)
                .then(r => { sourceCounts.rapiddns = r.length; mergeResults(r, 'rapiddns'); setSourceState('rapiddns', 'done', r.length); updateToggleCount('rapiddns', r.length); renderTable(allResults); updateStats(); })
                .catch(e => { console.warn('RapidDNS:', e); setSourceState('rapiddns', 'error', 0); })
        );
    }
    if (sources.dnsrepo) {
        setSourceState('dnsrepo', 'loading');
        promises.push(
            fetchDNSRepo(domain)
                .then(r => { sourceCounts.dnsrepo = r.length; mergeResults(r, 'dnsrepo'); setSourceState('dnsrepo', 'done', r.length); updateToggleCount('dnsrepo', r.length); renderTable(allResults); updateStats(); })
                .catch(e => { console.warn('DNSRepo:', e); setSourceState('dnsrepo', 'error', 0); })
        );
    }

    let done = 0;
    const total = promises.length;
    promises.forEach(p => p.finally(() => { done++; setProgress(Math.round(done / total * 100)); }));

    await Promise.allSettled(promises);

    // ── RETRY on 0 results ──────────────────────────────────────────
    if (allResults.length === 0) {
        document.querySelector('.progress-title').innerHTML =
            '<div class="spinner" style="width:14px;height:14px;border-width:2px;margin-right:8px;"></div> No results yet — retrying with longer timeout…';
        setProgress(0);
        await new Promise(r => setTimeout(r, 2500));

        const retry = [];
        if (sources.hackertarget) {
            setSourceState('hackertarget', 'loading');
            retry.push(
                fetchHackerTarget(domain, 22000)
                    .then(r => { mergeResults(r, 'hackertarget'); setSourceState('hackertarget', 'done', r.length); updateToggleCount('hackertarget', r.length); renderTable(allResults); updateStats(); })
                    .catch(e => { if (e.quota) { setSourceState('hackertarget', 'quota'); } else { setSourceState('hackertarget', 'error', 0); } })
            );
        }
        if (sources.urlscan) {
            setSourceState('urlscan', 'loading');
            retry.push(
                fetchURLScan(domain, 22000)
                    .then(r => { mergeResults(r, 'urlscan'); setSourceState('urlscan', 'done', r.length); updateToggleCount('urlscan', r.length); renderTable(allResults); updateStats(); })
                    .catch(() => setSourceState('urlscan', 'error', 0))
            );
        }
        if (sources.crtsh) {
            setSourceState('crtsh', 'loading');
            retry.push(
                fetchCrtSh(domain, 30000)
                    .then(r => { mergeResults(r, 'crtsh'); setSourceState('crtsh', 'done', r.length); updateToggleCount('crtsh', r.length); renderTable(allResults); updateStats(); })
                    .catch(() => setSourceState('crtsh', 'error', 0))
            );
        }
        if (sources.jldc) {
            setSourceState('jldc', 'loading');
            retry.push(
                fetchJLDC(domain, 22000)
                    .then(r => { mergeResults(r, 'jldc'); setSourceState('jldc', 'done', r.length); updateToggleCount('jldc', r.length); renderTable(allResults); updateStats(); })
                    .catch(() => setSourceState('jldc', 'error', 0))
            );
        }
        if (sources.certspotter) {
            setSourceState('certspotter', 'loading');
            retry.push(
                fetchCertSpotter(domain, 22000)
                    .then(r => { mergeResults(r, 'certspotter'); setSourceState('certspotter', 'done', r.length); updateToggleCount('certspotter', r.length); renderTable(allResults); updateStats(); })
                    .catch(() => setSourceState('certspotter', 'error', 0))
            );
        }
        if (sources.rapiddns) {
            setSourceState('rapiddns', 'loading');
            retry.push(
                fetchRapidDNS(domain, 22000)
                    .then(r => { mergeResults(r, 'rapiddns'); setSourceState('rapiddns', 'done', r.length); updateToggleCount('rapiddns', r.length); renderTable(allResults); updateStats(); })
                    .catch(() => setSourceState('rapiddns', 'error', 0))
            );
        }
        if (sources.dnsrepo) {
            setSourceState('dnsrepo', 'loading');
            retry.push(
                fetchDNSRepo(domain, 22000)
                    .then(r => { mergeResults(r, 'dnsrepo'); setSourceState('dnsrepo', 'done', r.length); updateToggleCount('dnsrepo', r.length); renderTable(allResults); updateStats(); })
                    .catch(() => setSourceState('dnsrepo', 'error', 0))
            );
        }
        let rd = 0;
        retry.forEach(p => p.finally(() => { rd++; setProgress(Math.round(rd / retry.length * 100)); }));
        await Promise.allSettled(retry);
    }
    // ────────────────────────────────────────────────────────────────

    setProgress(100);
    setTimeout(() => hideProgress(), 700);

    try { renderTable(allResults); updateStats(); } catch (e) { console.error('render error:', e); }

    btn.disabled = false;
    btn.querySelector('.btn-text').innerHTML = 'Initiate Scout';
    btn.querySelector('.btn-icon').innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>';

    playDoneSound();
    showWnToast('subdomain', allResults.length);
}

/* ── FETCH: HackerTarget ── */
async function fetchHackerTarget(domain, timeoutMs = 13000) {
    const htUrl = `https://api.hackertarget.com/hostsearch/?q=${domain}`;
    let text;
    // HackerTarget sends Access-Control-Allow-Origin:* — always try direct first
    // (each user's browser IP gets 21 free calls/day; shared proxy IPs are always exhausted)
    try {
        const res = await fetch(htUrl, { signal: AbortSignal.timeout(timeoutMs) });
        text = await res.text();
    } catch (e) {
        try {
            const res2 = await proxyFetch(htUrl, timeoutMs + 5000);
            text = await res2.text();
        } catch (e2) { return []; }
    }
    if (!text) return [];
    if (text.includes('API count exceeded') || text.includes('API Key Required') || text.includes('Increase Quota')) {
        const err = new Error('quota'); err.quota = true; throw err;
    }
    if (text.startsWith('error') || text.startsWith('<') || !text.includes(',')) return [];
    return text.trim().split('\n')
        .filter(l => l.includes(','))
        .map(l => { const [sub, ip] = l.split(','); return { subdomain: sub.trim().toLowerCase(), ip: ip?.trim() || '', source: 'hackertarget' }; })
        .filter(r => isValidSubdomain(r.subdomain, domain));
}

/* ── FETCH: URLScan.io (via CORS proxy) ── */
async function fetchURLScan(domain, timeoutMs = 13000) {
    const res = await proxyFetch(`https://urlscan.io/api/v1/search/?q=page.domain:${domain}&size=100`, timeoutMs);
    let data;
    try { data = await res.json(); } catch (e) { return []; }
    const seen = new Set();
    const out = [];
    for (const r of (data.results || [])) {
        const sub = (r?.page?.domain || '').toLowerCase();
        if (sub && isValidSubdomain(sub, domain) && !seen.has(sub)) {
            seen.add(sub);
            out.push({ subdomain: sub, ip: r?.page?.ip || '', source: 'urlscan' });
        }
    }
    return out;
}

/* ── FETCH: crt.sh ── */
async function fetchCrtSh(domain, timeoutMs = 40000) {
    // crt.sh is slow (PostgreSQL) — can take 30s+ for large domains
    // It sends Access-Control-Allow-Origin: * so direct fetch always works
    const directUrl = `https://crt.sh/?q=%.${domain}&output=json`;
    const crtUrl = `https://crt.sh/?q=%25.${domain}&output=json`;
    let res = null;

    // Direct fetch — crt.sh supports CORS natively, no proxy needed
    try {
        const r = await fetch(directUrl, { signal: AbortSignal.timeout(timeoutMs) });
        if (r.ok) res = r;
    } catch (e) { }

    // Proxy fallback — only corsproxy.io (skip allorigins: 30s cap < crt.sh response time)
    if (!res) {
        try {
            const r = await fetch(`https://corsproxy.io/?url=${encodeURIComponent(crtUrl)}`, { signal: AbortSignal.timeout(timeoutMs) });
            if (r.ok) res = r;
        } catch (e) { }
    }

    if (!res) return [];
    let text;
    try { text = await res.text(); } catch (e) { return []; }
    // Ensure we got JSON, not an HTML error page
    if (!text || text.trimStart()[0] !== '[') return [];
    let data;
    try { data = JSON.parse(text); } catch (e) { return []; }
    if (!Array.isArray(data)) return [];
    const seen = new Set();
    const out = [];
    for (const entry of data) {
        for (const name of (entry.name_value || '').split('\n')) {
            const sub = name.trim().replace(/^\*\./, '').toLowerCase();
            if (sub && isValidSubdomain(sub, domain) && !seen.has(sub)) {
                seen.add(sub);
                out.push({ subdomain: sub, ip: '', source: 'crtsh' });
            }
        }
    }
    return out;
}

/* ── FETCH: JLDC / Anubis ── */
async function fetchJLDC(domain, timeoutMs = 15000) {
    // jldc.me redirects (301) → jonlu.ca → anubisdb.com; no CORS headers at any step → go straight to proxy
    const url = `https://anubisdb.com/anubis/subdomains/${domain}`;
    let res;
    try { res = await proxyFetch(url, timeoutMs); } catch (e) { return []; }
    let data;
    try { data = await res.json(); } catch (e) { return []; }
    if (!Array.isArray(data)) return [];
    const seen = new Set();
    const out = [];
    for (const sub of data) {
        const s = String(sub).trim().toLowerCase();
        if (s && isValidSubdomain(s, domain) && !seen.has(s)) {
            seen.add(s);
            out.push({ subdomain: s, ip: '', source: 'jldc' });
        }
    }
    return out;
}

/* ── FETCH: CertSpotter ── */
async function fetchCertSpotter(domain, timeoutMs = 13000) {
    const url = `https://api.certspotter.com/v1/issuances?domain=${domain}&include_subdomains=true&expand=dns_names`;
    const res = await proxyFetch(url, timeoutMs);
    let data;
    try { data = await res.json(); } catch (e) { return []; }
    if (!Array.isArray(data)) return [];
    const seen = new Set();
    const out = [];
    for (const entry of data) {
        for (const name of (entry.dns_names || [])) {
            const sub = String(name).trim().replace(/^\*\./, '').toLowerCase();
            if (sub && isValidSubdomain(sub, domain) && !seen.has(sub)) {
                seen.add(sub);
                out.push({ subdomain: sub, ip: '', source: 'certspotter' });
            }
        }
    }
    return out;
}

/* ── FETCH: RapidDNS ── */
async function fetchRapidDNS(domain, timeoutMs = 15000) {
    const url = `https://rapiddns.io/subdomain/${domain}?full=1`;
    let res;
    try { res = await proxyFetch(url, timeoutMs); } catch (e) { return []; }
    let html;
    try { html = await res.text(); } catch (e) { return []; }
    const seen = new Set();
    const out = [];
    const re = new RegExp(`<td>([a-z0-9][a-z0-9\\-\\.]*\\.${domain.replace(/\./g, '\\.')})<\\/td>`, 'gi');
    let m;
    while ((m = re.exec(html)) !== null) {
        const sub = m[1].trim().toLowerCase();
        if (isValidSubdomain(sub, domain) && !seen.has(sub)) {
            seen.add(sub);
            out.push({ subdomain: sub, ip: '', source: 'rapiddns' });
        }
    }
    return out;
}

/* ── FETCH: DNSRepo ── */
async function fetchDNSRepo(domain, timeoutMs = 15000) {
    const url = `https://dnsrepo.noc.org/?domain=${domain}`;
    let res;
    try { res = await proxyFetch(url, timeoutMs); } catch (e) { return []; }
    let html;
    try { html = await res.text(); } catch (e) { return []; }
    const seen = new Set();
    const out = [];
    const re = new RegExp(`([a-z0-9][a-z0-9\\-\\.]*\\.${domain.replace(/\./g, '\\.')})`, 'gi');
    let m;
    while ((m = re.exec(html)) !== null) {
        const sub = m[1].trim().toLowerCase();
        if (isValidSubdomain(sub, domain) && !seen.has(sub)) {
            seen.add(sub);
            out.push({ subdomain: sub, ip: '', source: 'dnsrepo' });
        }
    }
    return out;
}

/* ── MERGE RESULTS ── */
function mergeResults(incoming, sourceName) {
    for (const item of incoming) {
        const existing = allResults.find(r => r.subdomain === item.subdomain);
        if (existing) {
            if (existing.source !== sourceName) existing.source = 'both'; // 'both' = multiple sources
            if (!existing.ip && item.ip) existing.ip = item.ip;
        } else {
            allResults.push({ ...item });
        }
    }
    allResults.sort((a, b) => {
        if (!!a.ip !== !!b.ip) return a.ip ? -1 : 1; // resolved first
        return a.subdomain.localeCompare(b.subdomain); // then alphabetical within each group
    });
}

/* ── PAGINATION ── */
const PAGE_SIZE = 100;

/* ── RENDER TABLE ── */
function renderTable(data) {
    const tbody = document.getElementById('results-tbody');
    const filter = document.getElementById('filter-input').value.toLowerCase();
    const filtered = filter
        ? data.filter(r => r.subdomain.includes(filter) || (r.ip && r.ip.includes(filter)))
        : data;

    const shown = filtered.slice(0, (currentPage + 1) * PAGE_SIZE);
    const remaining = filtered.length - shown.length;

    document.getElementById('result-count').textContent = filtered.length
        ? `— ${shown.length} of ${filtered.length}` : '';

    if (!filtered.length) {
        tbody.innerHTML = `<tr class="visible"><td colspan="6"><div style="padding: 3rem 2rem; text-align: center; opacity: 0.4;"><div style="font-size: 3rem; margin-bottom: 1rem;">🛰</div><p>${data.length ? 'No intelligence matches your current filter.' : 'Awaiting target parameters...'}</p></div></td></tr>`;
        renderShowMore(0);
        return;
    }

    tbody.innerHTML = shown.map((r, i) => rowHTML(r, i)).join('');
    requestAnimationFrame(() => {
        tbody.querySelectorAll('tr').forEach((tr, i) => {
            setTimeout(() => tr.classList.add('visible'), Math.min(i, 40) * 15);
        });
    });
    renderShowMore(remaining);
}

function rowHTML(r, i) {
    const ipContent = r.ip ? `<span class="ip-badge">${r.ip}</span>` : '<span style="opacity:0.2">—</span>';
    const statusContent = r.ip 
        ? '<span class="status-badge resolved"><span class="dot"></span>Resolved</span>'
        : '<span class="status-badge passive"><span class="dot"></span>Passive</span>';

    return `<tr>
    <td>${String(i + 1).padStart(2, '0')}</td>
    <td>${formatSub(r.subdomain)}</td>
    <td>${ipContent}</td>
    <td>${sourceBadge(r.source)}</td>
    <td>${statusContent}</td>
  </tr>`;
}

function renderShowMore(remaining) {
    const existing = document.getElementById('show-more-row');
    if (existing) existing.remove();
    if (remaining <= 0) return;
    const tbody = document.getElementById('results-tbody');
    const tr = document.createElement('tr');
    tr.id = 'show-more-row';
    tr.className = 'visible';
    tr.innerHTML = `<td colspan="6" style="text-align:center;padding:3rem;">
    <button class="btn-secondary" onclick="loadMore()" style="margin:0 auto; padding: 0.8rem 4rem; border-color: var(--primary); color: var(--primary); background: rgba(0,242,255,0.05);">
      Load More Intel
      <span style="opacity:0.5;font-weight:400;margin-left:0.5rem">(${remaining} remaining)</span>
    </button>
  </td>`;
    tbody.appendChild(tr);
}

function loadMore() {
    currentPage++;
    renderTable(allResults);
}

/* ── FILTER ── */
function filterTable() { currentPage = 0; renderTable(allResults); }


function formatSub(sub) {
    const parts = sub.split('.');
    let inner;
    if (parts.length <= 2) {
        inner = `<span class="highlight">${sub}</span>`;
    } else {
        const prefix = parts.slice(0, -2).join('.');
        const base = parts.slice(-2).join('.');
        inner = `<span class="highlight">${prefix}</span> <span class="base">.${base}</span>`;
    }
    return `<a class="sub-link" href="https://${sub}" target="_blank" rel="noopener noreferrer">${inner}</a>`;
}

function sourceBadge(src) {
    const label = SOURCE_LABELS[src] || 'Multiple';
    return `<span class="intel-badge">${label.toUpperCase()}</span>`;
}



/* ── STATS ── */
function updateEpStats(domain) {
    const total = epResults.length;
    const sources = new Set(epResults.map(r => r.source)).size;
    animateCount('ep-stat-total', total);
    animateCount('ep-stat-sources', sources);
    if (domain) document.getElementById('ep-stat-domain').textContent = domain;
}

function updateStats() {
    const total = allResults.length;
    const resolved = allResults.filter(r => r.ip).length;
    const sourcesHit = Object.values(sourceCounts).filter(v => v > 0).length;
    const uniqueIPs = new Set(allResults.filter(r => r.ip).map(r => r.ip)).size;
    animateCount('stat-total', total);
    animateCount('stat-resolved', resolved);
    animateCount('stat-sources', sourcesHit);
    animateCount('stat-unique-ips', uniqueIPs);
}

function setStats(a, b, c, d) {
    document.getElementById('stat-total').textContent = a;
    document.getElementById('stat-resolved').textContent = b;
    document.getElementById('stat-sources').textContent = c;
    document.getElementById('stat-unique-ips').textContent = d;
}

function animateCount(id, target) {
    const el = document.getElementById(id);
    if (!el) return;
    const start = parseInt(el.textContent.replace(/,/g, '')) || 0;
    const dur = 800;
    const t0 = performance.now();
    function step(t) {
        const p = Math.min((t - t0) / dur, 1);
        const val = Math.round(start + (target - start) * easeOut(p));
        el.textContent = val.toLocaleString();
        if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
}
function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

/* ── PROGRESS ── */
function showProgress() { document.getElementById('progress-wrap').classList.add('visible'); }
function hideProgress() { document.getElementById('progress-wrap').classList.remove('visible'); }
function setProgress(pct) {
    document.getElementById('progress-bar').style.width = pct + '%';
    document.getElementById('progress-pct').textContent = pct + '%';
}

const SOURCE_LABELS = { hackertarget: 'HackerTarget', urlscan: 'URLScan.io', crtsh: 'crt.sh', jldc: 'JLDC', certspotter: 'CertSpotter', rapiddns: 'RapidDNS', dnsrepo: 'DNSRepo' };
const EP_SOURCE_LABELS = { wayback: 'Wayback Machine', commoncrawl: 'Common Crawl', otx: 'AlienVault OTX', urlscan: 'URLScan.io' };

function initSourceStatus(active) {
    const el = document.getElementById('source-status');
    el.innerHTML = active.map(s => `
    <div class="src-item pending" id="src-${s}">
      <div class="src-dot"></div>
      <span id="src-label-${s}">${SOURCE_LABELS[s]}</span>
    </div>
  `).join('');
}

function setSourceState(name, state, count) {
    const el = document.getElementById('src-' + name);
    if (!el) return;
    el.className = 'src-item ' + state;
    const lbl = document.getElementById('src-label-' + name);
    if (!lbl) return;
    if (state === 'done' && count !== undefined)
        lbl.textContent = `${SOURCE_LABELS[name]} (${count})`;
    else if (state === 'error')
        lbl.textContent = `${SOURCE_LABELS[name]} — failed`;
    else if (state === 'quota')
        lbl.textContent = `${SOURCE_LABELS[name]} — rate limited`;
}

function initEpSourceStatus(active) {
    const el = document.getElementById('ep-source-status');
    el.innerHTML = active.map(s => `
    <div class="src-item pending" id="ep-src-${s}">
      <div class="src-dot"></div>
      <span id="ep-src-label-${s}">${EP_SOURCE_LABELS[s]}</span>
    </div>
  `).join('');
}

function setEpSourceState(name, state, count) {
    const el = document.getElementById('ep-src-' + name);
    if (!el) return;
    el.className = 'src-item ' + state;
    const lbl = document.getElementById('ep-src-label-' + name);
    if (!lbl) return;
    if (state === 'done' && count !== undefined)
        lbl.textContent = `${EP_SOURCE_LABELS[name]} (${count})`;
    else if (state === 'error')
        lbl.textContent = `${EP_SOURCE_LABELS[name]} — failed`;
    else if (state === 'loading')
        lbl.textContent = EP_SOURCE_LABELS[name];
}

function updateToggleCount(name, count) {
    const toggle = document.getElementById('toggle-' + name);
    if (!toggle) return;
    let countEl = toggle.querySelector('.toggle-count');
    if (!countEl) {
        countEl = document.createElement('span');
        countEl.className = 'toggle-count';
        toggle.appendChild(countEl);
    }
    countEl.textContent = count.toLocaleString();
}

/* ── CLEAR TABLE ── */
function clearTable() {
    document.getElementById('results-tbody').innerHTML = '';
    document.getElementById('result-count').textContent = '';
}

/* ── COPY ── */
function copyAll() {
    if (!allResults.length) { showToast('Nothing to copy.', 'error'); return; }
    const text = allResults.map(r => `${r.subdomain}${r.ip ? '\t' + r.ip : ''}`).join('\n');
    navigator.clipboard.writeText(text).then(() => showToast('Copied to clipboard!', 'success'));
}

/* ── EXPORT TXT ── */
function exportTxt() {
    if (!allResults.length) { showToast('Nothing to export.', 'error'); return; }
    const domain = document.getElementById('domain-input').value.trim()
        .replace(/^https?:\/\//, '').replace(/\/.*$/, '') || 'subdomains';
    showExportModal(domain);
}

function doExport(domain, type) {
    const list = type === 'resolved' ? allResults.filter(r => r.ip) : allResults;
    if (!list.length) { showToast('No resolved subdomains to export.', 'error'); return; }
    const filename = type === 'resolved' ? `${domain}_resolved.txt` : `${domain}_subdomains.txt`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([list.map(r => r.subdomain).join('\n')], { type: 'text/plain' }));
    a.download = filename;
    a.click();
    showToast(`Exported ${list.length} subdomains`, 'success');
}

function openReconModal() {
    const domain = document.getElementById('domain-input').value.trim() ||
        document.getElementById('ep-domain-input').value.trim() ||
        'target.com';
    showExportModal(domain.replace(/^https?:\/\//, '').replace(/\/.*$/, ''));
}

function showExportModal(domain) {
    const filename = `${domain}_subdomains.txt`;
    const live = `${domain}_live.txt`;
    const resolvedCount = allResults.filter(r => r.ip).length;

    const steps = [
        {
            num: '1', name: 'Live Host Detection', tool: 'httpx',
            desc: 'Filter to only responding hosts',
            info: 'httpx probes each subdomain over HTTP/HTTPS and returns status codes, page titles, and tech stacks. Essential first step to reduce attack surface.',
            cmd: `httpx -l ${filename} -sc -title -tech-detect -o ${live}`,
            art: { label: 'Intigriti — 8 Essential Recon Tools', url: 'https://blog.intigriti.com/hacking-tools/recon-for-bug-bounty-8-essential-tools-for-performing-effective-reconnaissance', src: 'Intigriti' }
        },
        {
            num: '2', name: 'Port Scanning', tool: 'naabu',
            desc: 'Find open ports on live hosts',
            info: 'naabu fast-scans targets for open ports. Non-standard ports often expose admin panels or debug endpoints.',
            cmd: `naabu -list ${live} -top-ports 1000 -o ${domain}_ports.txt`,
            art: { label: 'YesWeHack — Port Scanning', url: 'https://www.yeswehack.com/learn-bug-bounty/recon-port-scanning-attack-vectors', src: 'YesWeHack' }
        },
        {
            num: '3', name: 'Directory Fuzzing', tool: 'ffuf',
            desc: 'Discover hidden paths & endpoints',
            info: 'ffuf brute-forces URL paths to uncover hidden admin panels, backup files, and undocumented API routes.',
            cmd: `ffuf -w ~/SecLists/Discovery/Web-Content/common.txt -u https://FUZZ.${domain} -mc 200,301,302,403`,
            art: { label: 'Intigriti — ffuf Deep Dive', url: 'https://blog.intigriti.com/hacking-tools/hacker-tools-ffuf-fuzz-faster-u-fool-2', src: 'Intigriti' }
        },
        {
            num: '4', name: 'Vulnerability Scan', tool: 'nuclei',
            desc: 'Detect CVEs & misconfigurations',
            info: 'nuclei runs thousands of templates against live hosts to catch known CVEs and exposures.',
            cmd: `nuclei -list ${live} -severity medium,high,critical -o ${domain}_vulns.txt`,
            art: { label: 'Intigriti — nuclei Tool Guide', url: 'https://blog.intigriti.com/hacking-tools/hacker-tools-nuclei', src: 'Intigriti' }
        },
    ];

    const copyIcon = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
    const extIcon = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`;

    document.querySelector('.rm-body').innerHTML = `
    <div style="margin-bottom:24px;">
      <div class="rm-steps-label">Data Export</div>
      <div class="export-grid">
        <button class="export-btn primary" onclick="doExport('${domain}','all')">
          Download All
          <span class="export-btn-sub">${allResults.length} subdomains</span>
        </button>
        <button class="export-btn" onclick="doExport('${domain}','resolved')">
          Download Resolved
          <span class="export-btn-sub">${resolvedCount} with IPs</span>
        </button>
      </div>
    </div>
    <div class="rm-steps-label">Post-Recon Workflow</div>
    <div class="rm-steps">
      ${steps.map(s => `
        <div class="rm-step" id="rmstep-${s.num}">
          <div class="rm-step-header" onclick="toggleStep('${s.num}')">
            <div class="rm-step-num">${s.num}</div>
            <div class="rm-step-meta">
              <div class="rm-step-name">${s.name}<span class="rm-step-tool">${s.tool}</span></div>
              <div class="rm-step-desc">${s.desc}</div>
            </div>
            <span class="rm-chevron">›</span>
          </div>
          <div class="rm-step-info">
            <p>${s.info}</p>
            <div class="rm-step-code-wrap">
              <div class="rm-step-code" id="rmcode-${s.num}">${s.cmd}</div>
              <button class="rm-step-copy" onclick="copyRmCode('${s.num}')" title="Copy command">
                ${copyIcon}
              </button>
            </div>
            ${s.art ? `
            <a href="${s.art.url}" target="_blank" class="rm-step-link">
              ${extIcon}
              <span>Reference: ${s.art.label}</span>
            </a>` : ''}
          </div>
        </div>
      `).join('')}
    </div>
  `;

    document.getElementById('httpx-tip').classList.add('visible');
}

function toggleStep(num) {
    const el = document.getElementById('rmstep-' + num);
    const isOpen = el.classList.contains('open');
    document.querySelectorAll('.rm-body .rm-step').forEach(s => s.classList.remove('open'));
    if (!isOpen) el.classList.add('open');
}

function copyRmCode(num) {
    const code = document.getElementById('rmcode-' + num).textContent;
    navigator.clipboard.writeText(code).then(() => {
        showToast('Command copied');
    });
}

function copyCmd(btn) {
    const cmd = btn.dataset.cmd;
    navigator.clipboard.writeText(cmd).then(() => {
        const orig = btn.innerHTML;
        btn.innerHTML = 'Copied!';
        setTimeout(() => { btn.innerHTML = orig; }, 1800);
    });
}

/* ── TOAST ── */
let toastTimer;
function showToast(msg, type = 'success') {
    const t = document.getElementById('toast');
    const icon = type === 'success' ? '✓' : '✕';
    t.innerHTML = `<span style="color:${type === 'success' ? 'var(--green)' : 'var(--red)'}; font-weight:700;">${icon}</span> ${msg}`;
    t.className = `toast show ${type}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

/* ── WHAT NEXT TOAST + MODAL ── */
let wnToastTimer;

function playDoneSound() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const t = ctx.currentTime;
        // Three quick ascending chime notes
        [[523.25, 0], [659.25, 0.13], [783.99, 0.26]].forEach(([freq, delay]) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain); gain.connect(ctx.destination);
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, t + delay);
            gain.gain.setValueAtTime(0, t + delay);
            gain.gain.linearRampToValueAtTime(0.18, t + delay + 0.03);
            gain.gain.exponentialRampToValueAtTime(0.001, t + delay + 0.55);
            osc.start(t + delay);
            osc.stop(t + delay + 0.6);
        });
    } catch (e) { }
}

let wnCurrentMode = 'subdomain';

function showWnToast(mode = 'subdomain', count = 0) {
    wnCurrentMode = mode;
    if (mode === 'endpoint') {
        document.getElementById('wn-toast-icon').textContent = '🔗';
        document.getElementById('wn-toast-title').textContent = 'Endpoint Recon Done!';
        document.getElementById('wn-toast-sub').textContent = count > 0
            ? `${count} endpoint${count > 1 ? 's' : ''} collected — what should you do next?`
            : 'Scan complete — see what to do next as a bug bounty hunter.';
    } else {
        document.getElementById('wn-toast-icon').textContent = '🎯';
        document.getElementById('wn-toast-title').textContent = 'Enumeration Done!';
        document.getElementById('wn-toast-sub').textContent = count > 0
            ? `${count} subdomain${count > 1 ? 's' : ''} found — what should you do next?`
            : 'Scan complete — see what to do next as a bug bounty hunter.';
    }
    const el = document.getElementById('wn-toast');
    el.classList.add('show');
    clearTimeout(wnToastTimer);
    wnToastTimer = setTimeout(hideWnToast, 12000);
}

function hideWnToast() {
    document.getElementById('wn-toast').classList.remove('show');
    clearTimeout(wnToastTimer);
}

function renderWnSteps(steps, intro) {
    const copyIcon = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
    const extIcon = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`;
    document.getElementById('wn-steps-container').innerHTML = `
    ${intro ? `<div class="wn-intro">${intro}</div>` : ''}
    <div class="rm-steps-label">Post-recon workflow — click a step to expand</div>
    <div class="rm-steps">
      ${steps.map(s => `
        <div class="rm-step" id="wnstep-${s.num}">
          <div class="rm-step-header" onclick="toggleWnStep('${s.num}')">
            <div class="rm-step-num">${s.num}</div>
            <div class="rm-step-meta">
              <div class="rm-step-name">${s.name}<span class="rm-step-tool">${s.tool}</span></div>
              <div class="rm-step-desc">${s.desc}</div>
            </div>
            <span class="rm-chevron">›</span>
          </div>
          <div class="rm-step-info">
            <p>${s.info}</p>
            <div class="rm-step-code-wrap">
              <div class="rm-step-code" id="rmcode-${s.num}">${s.cmd}</div>
              <button class="rm-step-copy" onclick="copyRmCode('${s.num}')" title="Copy command">
                ${copyIcon}
              </button>
            </div>
            ${s.art ? `
            <a href="${s.art.url}" target="_blank" class="rm-step-link">
              ${extIcon}
              <span>Read: ${s.art.label} (${s.art.src})</span>
            </a>` : ''}
          </div>
        </div>
      `).join('')}
    </div>`;
}

function openWhatNext() {
    hideWnToast();
    if (wnCurrentMode === 'endpoint') {
        const domain = (document.getElementById('ep-domain-input').value.trim() || 'target.com').replace(/^https?:\/\//, '').replace(/\/.*/, '');
        const epFile = `${domain}_endpoints.txt`;
        document.getElementById('wn-modal-icon').textContent = '🔗';
        document.getElementById('wn-modal-title').textContent = 'What to do after Endpoint Recon?';
        document.getElementById('wn-modal-sub').textContent = 'Bug bounty endpoint workflow — step by step';
        renderWnSteps([
            {
                num: '1', name: 'Probe Live Endpoints', tool: 'httpx',
                desc: 'Verify which URLs still respond',
                info: 'Historical endpoints may be dead. httpx probes each URL and returns current status codes, page titles, and content lengths. This narrows your list to only active targets before you spend time on deeper testing.',
                cmd: `httpx -l ${epFile} -sc -title -mc 200,301,302,403,405 -o ${domain}_live_endpoints.txt`,
                art: { label: 'Intigriti — 8 Essential Recon Tools', url: 'https://blog.intigriti.com/hacking-tools/recon-for-bug-bounty-8-essential-tools-for-performing-effective-reconnaissance', src: 'Intigriti' }
            },
            {
                num: '2', name: 'Parameter Discovery', tool: 'Arjun',
                desc: 'Find hidden GET/POST parameters',
                info: 'Most bugs live in parameters developers forgot to document. Arjun fuzzes each endpoint with thousands of common parameter names and detects when the response changes — revealing hidden inputs that could be vulnerable to XSS, SQLi, SSRF, or IDOR.',
                cmd: `arjun -i ${domain}_live_endpoints.txt -oT ${domain}_params.txt`,
                art: { label: 'Intigriti — Parameter Discovery Guide', url: 'https://blog.intigriti.com/hacking-tools/hacker-tools-arjun', src: 'Intigriti' }
            },
            {
                num: '3', name: 'JavaScript Secret Hunting', tool: 'SecretFinder',
                desc: 'Extract API keys & tokens from JS files',
                info: 'JS files served by your target often contain hardcoded API keys, JWT secrets, internal service URLs, AWS credentials, and OAuth tokens. SecretFinder scans JS content with regex patterns and surfaces anything that looks like a credential or sensitive value.',
                cmd: `cat ${epFile} | grep "\\.js$" | while read u; do python3 SecretFinder.py -i "$u" -o cli; done`,
                art: { label: 'Intigriti — JavaScript Recon Guide', url: 'https://blog.intigriti.com/hacking-tools/hacker-tools-linkfinder', src: 'Intigriti' }
            },
            {
                num: '4', name: 'Vulnerability Scan', tool: 'nuclei',
                desc: 'Run templates against live endpoints',
                info: 'nuclei has URL-level templates that check for exposed admin panels, API debug endpoints, path traversal, open redirects, SSRF, and hundreds of CVEs. Running it directly against your endpoint list (not just hostnames) gives more specific and accurate results.',
                cmd: `nuclei -l ${domain}_live_endpoints.txt -severity medium,high,critical -o ${domain}_ep_vulns.txt`,
                art: { label: 'Intigriti — nuclei Tool Guide', url: 'https://blog.intigriti.com/hacking-tools/hacker-tools-nuclei', src: 'Intigriti' }
            },
            {
                num: '5', name: '403 Bypass', tool: 'byp4xx',
                desc: 'Bypass forbidden endpoints with header tricks',
                info: 'A 403 Forbidden response does not mean the content is unreachable — it means the server rejected your specific request. Techniques like adding X-Forwarded-For, X-Original-URL, or path normalization tricks (/admin/%2e, /./admin) often bypass WAF and ACL rules.',
                cmd: `byp4xx -u https://${domain}/admin`,
                art: { label: 'YesWeHack — Access Control Bypass', url: 'https://www.yeswehack.com/learn-bug-bounty/http-header-exploitation', src: 'YesWeHack' }
            },
            {
                num: '6', name: 'Fuzzing Parameters', tool: 'ffuf',
                desc: 'Fuzz interesting endpoints for hidden behavior',
                info: 'Once you have a list of interesting endpoints from your recon, ffuf can fuzz their parameters with wordlists. This surfaces backup files, debug modes, hidden admin actions, and injection points that normal crawling would never find.',
                cmd: `ffuf -w ~/SecLists/Discovery/Web-Content/burp-parameter-names.txt -u https://${domain}/api/FUZZ -mc 200,301,302`,
                art: { label: 'Intigriti — ffuf Deep Dive', url: 'https://blog.intigriti.com/hacking-tools/hacker-tools-ffuf-fuzz-faster-u-fool-2', src: 'Intigriti' }
            },
        ], 'You\'ve mapped the endpoint surface — now it\'s time to find what\'s vulnerable. Here\'s the proven workflow top hunters use after collecting endpoints.');
    } else {
        const domain = (document.getElementById('domain-input').value.trim() || 'target.com').replace(/^https?:\/\//, '').replace(/\/.*/, '');
        const filename = `${domain}_subdomains.txt`;
        const live = `${domain}_live.txt`;
        document.getElementById('wn-modal-icon').textContent = '🎯';
        document.getElementById('wn-modal-title').textContent = 'What to do after Subdomain Enumeration?';
        document.getElementById('wn-modal-sub').textContent = 'Bug bounty recon workflow — step by step';
        renderWnSteps([
            {
                num: '1', name: 'Live Host Detection', tool: 'httpx',
                desc: 'Filter to only responding hosts',
                info: 'httpx probes each subdomain over HTTP/HTTPS and returns status codes, page titles, and tech stacks. This is the essential first step — it reduces your attack surface to only hosts that are actually alive, saving time on every subsequent step.',
                cmd: `httpx -l ${filename} -sc -title -tech-detect -o ${live}`,
                art: { label: 'Intigriti — 8 Essential Recon Tools', url: 'https://blog.intigriti.com/hacking-tools/recon-for-bug-bounty-8-essential-tools-for-performing-effective-reconnaissance', src: 'Intigriti' }
            },
            {
                num: '2', name: 'Port Scanning', tool: 'naabu',
                desc: 'Find open ports on live hosts',
                info: 'naabu fast-scans live targets for open ports beyond 80/443. Non-standard ports often expose admin panels, dev/staging servers, internal APIs, or debug endpoints that dramatically expand your attack surface.',
                cmd: `naabu -list ${live} -top-ports 1000 -o ${domain}_ports.txt`,
                art: { label: 'YesWeHack — Port Scanning & Attack Vectors', url: 'https://www.yeswehack.com/learn-bug-bounty/recon-port-scanning-attack-vectors', src: 'YesWeHack' }
            },
            {
                num: '3', name: 'Directory Fuzzing', tool: 'ffuf',
                desc: 'Discover hidden paths & endpoints',
                info: 'ffuf brute-forces URL paths on each live host using wordlists. Uncovers hidden admin panels, backup files (.env, config.bak), undocumented API routes, and legacy endpoints that often hold sensitive data or exploitable vulnerabilities.',
                cmd: `ffuf -w ~/SecLists/Discovery/Web-Content/common.txt -u https://FUZZ.${domain} -mc 200,301,302,403`,
                art: { label: 'Intigriti — ffuf Deep Dive', url: 'https://blog.intigriti.com/hacking-tools/hacker-tools-ffuf-fuzz-faster-u-fool-2', src: 'Intigriti' }
            },
            {
                num: '4', name: 'Vulnerability Scan', tool: 'nuclei',
                desc: 'Detect CVEs, misconfigs & exposures',
                info: 'nuclei runs 9,000+ community-maintained templates against live hosts — catching known CVEs, exposed admin panels, default credentials, misconfigured headers, SSRF vectors, open redirects, and more. Produces quick wins in nearly every bug bounty program.',
                cmd: `nuclei -list ${live} -severity medium,high,critical -o ${domain}_vulns.txt`,
                art: { label: 'Intigriti — nuclei Tool Guide', url: 'https://blog.intigriti.com/hacking-tools/hacker-tools-nuclei', src: 'Intigriti' }
            },
            {
                num: '5', name: 'JavaScript Recon', tool: 'gau + linkfinder',
                desc: 'Extract endpoints from JS files',
                info: 'JS files often contain hardcoded API keys, hidden endpoints, internal service URLs, and auth tokens. gau fetches all known URLs for a domain; LinkFinder then parses JS files to extract routes and endpoints not visible in the HTML.',
                cmd: `gau ${domain} | grep "\\.js$" | tee ${domain}_js.txt`,
                art: { label: 'Intigriti — JavaScript Recon Guide', url: 'https://blog.intigriti.com/hacking-tools/hacker-tools-linkfinder', src: 'Intigriti' }
            },
            {
                num: '6', name: 'Subdomain Takeover Check', tool: 'subzy',
                desc: 'Find dangling DNS pointing to unclaimed services',
                info: 'Subdomain takeover happens when a DNS record points to a cloud service (S3, Heroku, GitHub Pages, etc.) that has been deleted. Claiming that service lets you control the subdomain. subzy automates this check across your entire list.',
                cmd: `subzy run --targets ${filename} --concurrency 50 --output ${domain}_takeover.txt`,
                art: { label: 'Intigriti — Subdomain Takeover Guide', url: 'https://blog.intigriti.com/hacking-tools/hacker-tools-subjack', src: 'Intigriti' }
            },
        ], 'You\'ve mapped the attack surface — now it\'s time to dig deeper. Below is the proven post-recon workflow used by top bug bounty hunters to find real vulnerabilities from a subdomain list.');
    }
    document.getElementById('wn-overlay').classList.add('visible');
}

function closeWhatNext() {
    document.getElementById('wn-overlay').classList.remove('visible');
}

function toggleWnStep(num) {
    const el = document.getElementById('wnstep-' + num);
    const isOpen = el.classList.contains('open');
    document.querySelectorAll('#wn-steps-container .rm-step').forEach(s => s.classList.remove('open'));
    if (!isOpen) el.classList.add('open');
}

/* ── ENDPOINT PROGRESS ── */
function showEpProgress() { document.getElementById('ep-progress-wrap').style.display = ''; }
function hideEpProgress() { document.getElementById('ep-progress-wrap').style.display = 'none'; }
function setEpProgress(pct) {
    document.getElementById('ep-progress-bar').style.width = pct + '%';
    document.getElementById('ep-progress-pct').textContent = pct + '%';
}


/* ── ENDPOINT MERGE ── */
/* ── URL CLEANING UTILS ── */
function normalizeEpUrl(url) {
    // Strip default ports :80 and :443 that Wayback embeds
    return url
        .replace(/^(https?:\/\/[^/]+):80(\/|$)/, '$1$2')
        .replace(/^(https?:\/\/[^/]+):443(\/|$)/, '$1$2');
}

function isJunkEpUrl(url) {
    if (!url || url.length > 1000) return true;
    const u = url.toLowerCase();
    // Embedded data URIs (SVG, images, etc embedded directly in URL)
    if (/data:(image|text|application|audio|video)/i.test(url)) return true;
    // SVG / XML content embedded
    if (/%3csvg|%3cxml|<svg|<xml/i.test(url)) return true;
    // Encoded HTML angle brackets (garbage content in URL)
    if ((url.match(/%3c/gi) || []).length > 2) return true;
    // Starts with quote (malformed Wayback entry)
    if (url.includes('"data:') || url.includes("'data:")) return true;
    // Contains unencoded angle brackets
    if (url.includes('<') || url.includes('>')) return true;
    return false;
}

function epPathKey(url) {
    // Deduplicate by host + path + sorted query string (keeps param variations, drops fragment)
    try {
        const u = new URL(url);
        // Sort query params so ?a=1&b=2 and ?b=2&a=1 don't double-count
        const params = Array.from(u.searchParams.entries()).sort().toString();
        return u.host + u.pathname + (params ? '?' + params : '');
    } catch (e) {
        return url.split('#')[0];
    }
}

function mergeEpResults(items, source) {
    const existing = new Set(epResults.map(r => epPathKey(r.url)));
    for (const item of items) {
        const clean = normalizeEpUrl(item.url);
        if (isJunkEpUrl(clean)) continue;
        const key = epPathKey(clean);
        if (!existing.has(key)) {
            existing.add(key);
            epResults.push({ ...item, url: clean, source: source });
        } else {
            const r = epResults.find(x => epPathKey(x.url) === key);
            if (r && r.source !== source) r.source = 'multiple';
        }
    }
}

/* ── ENDPOINT TABLE ── */
function epStatusBadge(status) {
    if (!status || status === '-') return '<span style="color:var(--muted);font-size:11px">—</span>';
    const code = parseInt(status);
    let cls = '';
    if (code >= 200 && code < 300) cls = 'status-2xx';
    else if (code >= 300 && code < 400) cls = 'status-3xx';
    else if (code >= 400 && code < 500) cls = 'status-4xx';
    else if (code >= 500) cls = 'status-5xx';
    return `<span class="status-badge ${cls}">${status}</span>`;
}

function epSourceBadge(src) {
    const labels = { wayback: 'Wayback', commoncrawl: 'CommonCrawl', otx: 'OTX', urlscan: 'URLScan.io' };
    const label = labels[src] || src;
    return `<span style="font-family:var(--font-mono);font-size:0.7rem;font-weight:800;color:var(--secondary);opacity:0.8;">${label.toUpperCase()}</span>`;
}

function epRowHTML(r, i) {
    const escaped = r.url.replace(/"/g, '&quot;');
    const statusContent = r.status && r.status !== '-' 
        ? epStatusBadge(r.status) 
        : '<span style="opacity:0.2">—</span>';

    return `<tr>
    <td>${String(i + 1).padStart(2, '0')}</td>
    <td style="font-family:var(--font-mono);max-width:600px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
        <a href="${escaped}" target="_blank" rel="noopener" style="color:#e2e8f0;text-decoration:none;transition:color 0.2s; font-size: 0.85rem; font-weight: 500;" onmouseover="this.style.color='var(--primary)'" onmouseout="this.style.color='#e2e8f0'">${r.url}</a>
    </td>
    <td>${statusContent}</td>
    <td><span class="intel-badge">${r.source.toUpperCase()}</span></td>
  </tr>`;
}

/* ── ENDPOINT FILTER DEFINITIONS ── */
const EP_FILTER_DEFS = {
    js: url => /\.js(\?|$|#|:)/i.test(url),
    config: url => /\.(env|bak|old|backup|config|cfg|conf|ini|sql|sqlite|db|log|xml|yaml|yml|toml|properties|pem|key|crt|p12|pfx)(\?|$)/i.test(url)
        || /web\.config|dockerfile|\.htaccess|\.htpasswd|\.gitignore|\.git\/|composer\.(json|lock)|package\.json|Makefile/i.test(url),
    redirect: url => /[?&][^=&]+=(\/?\/|https?)/i.test(url),
    upload: url => /upload|file[_-]?upload|attach|attachment|multipart|import[_-]?file|document[_-]?upload|image[_-]?upload|photo|avatar|thumb|thumbnail|media[_-]?upload|blob|chunk|resume[_-]?upload|dropzone/i.test(url),
    auth: url => /\/login|\/log-in|\/logout|\/log-out|\/signin|\/sign-in|\/signout|\/sign-out|\/signup|\/sign-up|\/register|\/registration|\/oauth|\/authorize|\/token|\/auth[\/\?#]|\/sso|\/saml|\/ldap|\/password|\/forgot|\/reset[_-]?pass|\/change[_-]?pass|\/verify|\/confirm|\/2fa|\/mfa|\/otp|\/session|\/account[\/\?]|\/profile[\/\?]/i.test(url),
    admin: url => /\/admin|\/administrator|\/administration|\/dashboard|\/manage|\/manager|\/management|\/panel|\/cpanel|\/control[_-]?panel|\/console|\/backoffice|\/back-office|\/backend|\/back-end|\/\/cp\/|\/moderator|\/superuser|\/super[_-]?admin|\/staff|\/internal|\/private|\/restricted|\/secure|\/portal|\/cms|\/wp-admin|\/phpmyadmin|\/adminer/i.test(url),
    api: url => /\/api\/|\/api\?|\/api#|\/v\d+\/|\/graphql|\/gql|\/rest\/|\/rest\?|\/rpc\/|\/rpc\?|\/swagger|\/openapi|\/api-docs|\/api-explorer|\/jsonrpc|\/xmlrpc|\.json(\?|$)|\.xml(\?|$)/i.test(url),
    params: url => url.includes('?') && /[?&][^=]+=/.test(url),
};

const epChips = Object.fromEntries(Object.keys(EP_FILTER_DEFS).map(k => [k, false]));

function toggleEpFilterMenu(e) {
    e.stopPropagation();
    const menu = document.getElementById('ep-filter-menu');
    const chevron = document.getElementById('ep-filter-chevron');
    const isOpen = menu.classList.contains('open');
    menu.classList.toggle('open', !isOpen);
    chevron.classList.toggle('open', !isOpen);
}

document.addEventListener('click', e => {
    const wrap = document.getElementById('ep-filter-wrap');
    if (wrap && !wrap.contains(e.target)) {
        document.getElementById('ep-filter-menu')?.classList.remove('open');
        document.getElementById('ep-filter-chevron')?.classList.remove('open');
    }
});

function syncEpFilterBtn() {
    const count = Object.values(epChips).filter(Boolean).length;
    const badge = document.getElementById('ep-filter-badge');
    const btn = document.getElementById('ep-filter-btn');
    badge.textContent = count;
    badge.style.display = count ? '' : 'none';
    btn.classList.toggle('has-active', count > 0);
}

function toggleEpChip(name) {
    epChips[name] = !epChips[name];
    document.getElementById('chip-' + name).classList.toggle('active', epChips[name]);
    syncEpFilterBtn();
    epCurrentPage = 0;
    renderEpTable(epResults);
}

function clearEpChips() {
    Object.keys(epChips).forEach(k => {
        epChips[k] = false;
        document.getElementById('chip-' + k)?.classList.remove('active');
    });
    syncEpFilterBtn();
    epCurrentPage = 0;
    renderEpTable(epResults);
}

function getEpFiltered() {
    const q = (document.getElementById('ep-filter-input')?.value || '').toLowerCase().trim();
    const activeFilters = Object.entries(epChips).filter(([, v]) => v).map(([k]) => k);
    return epResults.filter(r => {
        const url = r.url;
        if (q && !url.toLowerCase().includes(q)) return false;
        for (const f of activeFilters) {
            if (!EP_FILTER_DEFS[f](url)) return false;
        }
        return true;
    });
}

function renderEpTable(data) {
    const tbody = document.getElementById('ep-results-tbody');
    const filtered = getEpFiltered();
    const shown = filtered.slice(0, (epCurrentPage + 1) * EP_PAGE_SIZE);
    const remaining = filtered.length - shown.length;
    const total = data.length;
    const isFiltered = filtered.length !== total;
    document.getElementById('ep-result-count').textContent = total
        ? isFiltered
            ? `— ${filtered.length.toLocaleString()} of ${total.toLocaleString()}`
            : `— ${shown.length.toLocaleString()} of ${total.toLocaleString()}`
        : '';
    if (!filtered.length) {
        tbody.innerHTML = `<tr class="visible"><td colspan="5"><div style="padding: 3rem 2rem; text-align: center; opacity: 0.4;"><div style="font-size: 3rem; margin-bottom: 1rem;">📡</div><p>${total ? 'No intelligence matches your current filter.' : 'Awaiting harvest initiation...'}</p></div></td></tr>`;
        renderEpShowMore(0); return;
    }
    tbody.innerHTML = shown.map((r, i) => epRowHTML(r, i)).join('');
    requestAnimationFrame(() => { tbody.querySelectorAll('tr').forEach((tr, i) => { setTimeout(() => tr.classList.add('visible'), Math.min(i, 40) * 15); }); });
    renderEpShowMore(remaining);
}

function renderEpShowMore(remaining) {
    const existing = document.getElementById('ep-show-more-row');
    if (existing) existing.remove();
    if (remaining <= 0) return;
    const tbody = document.getElementById('ep-results-tbody');
    const tr = document.createElement('tr');
    tr.id = 'ep-show-more-row'; tr.className = 'visible';
    tr.innerHTML = `<td colspan="5" style="text-align:center;padding:3rem"><button class="btn-secondary" onclick="epCurrentPage++;renderEpTable(epResults)" style="margin:0 auto; padding: 0.8rem 4rem; border-color: var(--secondary); color: var(--secondary); background: rgba(188,19,254,0.05);">Load More Intel <span style="opacity:0.5;font-weight:400;margin-left:0.5rem">(${remaining} remaining)</span></button></td>`;
    tbody.appendChild(tr);
}

/* ── ENDPOINT COPY / EXPORT ── */
function copyAllEp() {
    const list = getEpFiltered();
    if (!list.length) { showToast('Nothing to copy.', 'error'); return; }
    navigator.clipboard.writeText(list.map(r => r.url).join('\n')).then(() => showToast(`Copied ${list.length.toLocaleString()} endpoints!`, 'success'));
}
function copyApiPaths() {
    const apiList = epResults.filter(r => EP_FILTER_DEFS.api(r.url));
    if (!apiList.length) { showToast('No API endpoints found.', 'error'); return; }
    const paths = apiList.map(r => { try { return new URL(r.url).pathname; } catch { return r.url; } });
    navigator.clipboard.writeText(paths.join('\n')).then(() => showToast(`Copied ${paths.length.toLocaleString()} API paths!`, 'success'));
}
function exportEpTxt() {
    const list = getEpFiltered();
    if (!list.length) { showToast('Nothing to export.', 'error'); return; }
    const domain = document.getElementById('ep-domain-input').value.trim();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([list.map(r => r.url).join('\n')], { type: 'text/plain' }));
    a.download = `${domain}_endpoints.txt`;
    a.click();
    showToast(`Exported ${list.length.toLocaleString()} endpoints`, 'success');
}

/* ── START ENDPOINT SCAN ── */
async function startEpScan() {
    const domain = document.getElementById('ep-domain-input').value.trim().replace(/^https?:\/\//, '').replace(/\/.*/, '').toLowerCase();
    if (!domain || !/^[a-z0-9][a-z0-9\-\.]+\.[a-z]{2,}$/.test(domain)) {
        showToast('Please enter a valid domain name.', 'error'); return;
    }

    const btn = document.getElementById('ep-scan-btn');
    btn.disabled = true;
    btn.querySelector('.btn-text').innerHTML = '<span class="spinner"></span> Scanning…';

    epResults = []; epCurrentPage = 0;

    // Clear filter and chips
    const epFilterEl = document.getElementById('ep-filter-input');
    if (epFilterEl) epFilterEl.value = '';
    Object.keys(epChips).forEach(k => { epChips[k] = false; document.getElementById('chip-' + k)?.classList.remove('active'); });
    syncEpFilterBtn();
    document.getElementById('ep-filter-menu')?.classList.remove('open');
    document.getElementById('ep-filter-chevron')?.classList.remove('open');

    // Reset toggle count badges
    ['wayback', 'commoncrawl', 'otx', 'urlscan'].forEach(s => {
        const el = document.querySelector(`#ep-toggle-${s} .toggle-count`);
        if (el) el.remove();
    });

    // Stats row
    document.getElementById('ep-stats-row').style.display = '';
    document.getElementById('ep-stat-total').textContent = '0';
    document.getElementById('ep-stat-sources').textContent = '0';
    document.getElementById('ep-stat-domain').textContent = domain;

    showEpProgress(); setEpProgress(0);
    document.getElementById('ep-progress-title').innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px"></div> Scanning sources…';
    renderEpTable([]);

    const EP_SOURCES = ['wayback', 'commoncrawl', 'otx', 'urlscan'].filter(s => epSources[s]);
    initEpSourceStatus(EP_SOURCES);
    EP_SOURCES.forEach(s => setEpSourceState(s, 'loading'));

    let done = 0;
    function tick() { done++; setEpProgress(Math.round(done / EP_SOURCES.length * 100)); }

    const promises = [];
    if (epSources.wayback) promises.push(
        fetchWayback(domain)
            .then(r => { mergeEpResults(r, 'wayback'); setEpSourceState('wayback', 'done', r.length); updateEpToggleCount('wayback', r.length); updateEpStats(domain); renderEpTable(epResults); })
            .catch(e => { console.warn('Wayback:', e); setEpSourceState('wayback', 'error'); })
            .finally(tick)
    );
    if (epSources.commoncrawl) promises.push(
        fetchCommonCrawl(domain)
            .then(r => { mergeEpResults(r, 'commoncrawl'); setEpSourceState('commoncrawl', 'done', r.length); updateEpToggleCount('commoncrawl', r.length); updateEpStats(domain); renderEpTable(epResults); })
            .catch(e => { console.warn('CommonCrawl:', e); setEpSourceState('commoncrawl', 'error'); })
            .finally(tick)
    );
    if (epSources.otx) promises.push(
        fetchOTX(domain)
            .then(r => { mergeEpResults(r, 'otx'); setEpSourceState('otx', 'done', r.length); updateEpToggleCount('otx', r.length); updateEpStats(domain); renderEpTable(epResults); })
            .catch(e => { console.warn('OTX:', e); setEpSourceState('otx', 'error'); })
            .finally(tick)
    );
    if (epSources.urlscan) promises.push(
        fetchURLScanEP(domain)
            .then(r => { mergeEpResults(r, 'urlscan'); setEpSourceState('urlscan', 'done', r.length); updateEpToggleCount('urlscan', r.length); updateEpStats(domain); renderEpTable(epResults); })
            .catch(e => { console.warn('URLScan:', e); setEpSourceState('urlscan', 'error'); })
            .finally(tick)
    );
    await Promise.allSettled(promises);

    setEpProgress(100);
    document.getElementById('ep-progress-title').textContent = `Done — ${epResults.length} endpoints found`;
    setTimeout(hideEpProgress, 1500);
    renderEpTable(epResults);

    btn.disabled = false;
    btn.querySelector('.btn-text').innerHTML = 'Harvest Endpoints';
    btn.querySelector('.btn-icon').innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>';

    playDoneSound();
    showWnToast('endpoint', epResults.length);
}

/* ── ENDPOINT UTILS ── */


function updateEpToggleCount(name, count) {
    const toggle = document.getElementById('ep-toggle-' + name);
    if (!toggle) return;
    let countEl = toggle.querySelector('.toggle-count');
    if (!countEl) {
        countEl = document.createElement('span');
        countEl.className = 'toggle-count';
        toggle.appendChild(countEl);
    }
    countEl.textContent = count;
}



function normalizeEpUrl(u) {
    try {
        const url = new URL(u);
        return url.origin + url.pathname + url.search;
    } catch (e) { return u; }
}

function isJunkEpUrl(u) {
    const junk = /\.(jpg|jpeg|png|gif|svg|woff|woff2|ttf|eot|css|ico|pdf|zip|gz|exe|bin|apk|dmg|iso|mp4|mp3|avi|mov|wmv|flv|swf)(\?|$)/i;
    return junk.test(u);
}

function epPathKey(u) {
    try {
        const url = new URL(u);
        return url.hostname + url.pathname;
    } catch (e) { return u; }
}

/* ── FETCH: Wayback Machine CDX ── */
async function fetchWayback(domain, timeoutMs = 25000) {
    const url = `https://web.archive.org/cdx/search/cdx?url=*.${domain}/*&output=json&fl=original,statuscode&collapse=urlkey&limit=50000`;
    let res;
    // Wayback CDX does not send CORS headers — use large-payload proxy list (skips corsproxy.io 413)
    try { res = await proxyFetch(url, timeoutMs, true); } catch (e) { return []; }
    let data;
    try { data = await res.json(); } catch (e) { return []; }
    if (!Array.isArray(data) || data.length < 2) return [];
    // First row is headers ["original","statuscode"]
    const out = [];
    const seen = new Set();
    const staticExts = /\.(ico|png|jpg|jpeg|gif|css|woff|woff2|ttf|svg|eot|mp4|mp3|webp|pdf|zip|gz|map)(\?|$)/i;
    for (let i = 1; i < data.length; i++) {
        const row = data[i];
        let u = row[0];
        if (!u) continue;
        u = normalizeEpUrl(u);
        if (isJunkEpUrl(u)) continue;
        if (staticExts.test(u)) continue;
        if (u.includes('robots.txt')) continue;
        const key = epPathKey(u);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ url: u, status: row[1] || '-', source: 'wayback' });
    }
    return out;
}

/* ── FETCH: Common Crawl ── */
async function fetchCommonCrawl(domain, timeoutMs = 25000) {
    // Common Crawl has no CORS headers — use proxy for everything
    let indexId = 'CC-MAIN-2025-18'; // fallback
    try {
        const infoRes = await proxyFetch('https://index.commoncrawl.org/collinfo.json', 8000);
        if (infoRes.ok) {
            const indexes = await infoRes.json();
            if (Array.isArray(indexes) && indexes.length > 0) indexId = indexes[0].id;
        }
    } catch (e) { }

    // matchType=domain — no wildcard * in URL (avoids proxy encoding issues that cause 520s)
    const url = `https://index.commoncrawl.org/${indexId}-index?url=${domain}&matchType=domain&output=json&limit=15000`;
    let res;
    try { res = await proxyFetch(url, timeoutMs); } catch (e) { return []; }
    let text;
    try { text = await res.text(); } catch (e) { return []; }
    if (!text) return [];
    // NDJSON — one JSON object per line
    const out = [];
    const seen = new Set();
    const staticExts = /\.(ico|png|jpg|jpeg|gif|css|woff|woff2|ttf|svg|eot|mp4|mp3|webp|pdf|zip|gz|map)(\?|$)/i;
    for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try {
            const entry = JSON.parse(line);
            let u = entry.url;
            if (!u) continue;
            u = normalizeEpUrl(u);
            if (isJunkEpUrl(u) || staticExts.test(u)) continue;
            const key = epPathKey(u);
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({ url: u, status: entry.status || '-', source: 'commoncrawl' });
        } catch (e) { }
    }
    return out;
}

/* ── FETCH: AlienVault OTX ── */
async function fetchOTX(domain, timeoutMs = 15000) {
    const seen = new Set();
    const out = [];
    let totalPages = 1;

    for (let page = 1; page <= totalPages; page++) {
        const url = `https://otx.alienvault.com/api/v1/indicators/domain/${domain}/url_list?limit=500&page=${page}`;
        let res;
        try {
            res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
            if (!res.ok) throw new Error('HTTP ' + res.status);
        } catch (e) {
            try { res = await proxyFetch(url, timeoutMs); } catch (e2) { break; }
        }
        let data;
        try { data = await res.json(); } catch (e) { break; }
        if (data.detail || data.error) break;
        const list = data.url_list || [];
        if (!list.length) break;
        // On first page, calculate total pages from full_size
        if (page === 1 && data.full_size) {
            totalPages = Math.min(Math.ceil(data.full_size / 500), 10); // cap at 10 pages (5000 URLs)
        }
        for (const entry of list) {
            const u = entry.url;
            if (!u || seen.has(u)) continue;
            seen.add(u);
            const status = entry?.result?.urlworker?.http_code ? String(entry.result.urlworker.http_code) : '-';
            out.push({ url: u, status, source: 'otx' });
        }
        if (list.length < 500) break;
    }
    return out;
}

/* ── FETCH: URLScan.io Endpoints ── */
async function fetchURLScanEP(domain, timeoutMs = 13000) {
    const apiUrl = `https://urlscan.io/api/v1/search/?q=page.domain:${domain}&size=100`;
    let res;
    // URLScan does not send CORS headers — go straight to proxy
    try { res = await proxyFetch(apiUrl, timeoutMs); } catch (e) { return []; }
    let data;
    try { data = await res.json(); } catch (e) { return []; }
    // Handle rate-limit or error responses
    if (!data || data.status === 429 || data.message) return [];
    const seen = new Set();
    const out = [];
    for (const r of (data.results || [])) {
        const u = r?.page?.url;
        if (!u || seen.has(u)) continue;
        seen.add(u);
        out.push({ url: u, status: r?.page?.status ? String(r.page.status) : '-', source: 'urlscan' });
    }
    return out;
}

/* ── ENTER KEY ── */
document.getElementById('domain-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') startScan();
});
document.getElementById('ep-domain-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') startEpScan();
});

/* ── MOBILE MENU HANDLER ── */
(function() {
    const btn = document.getElementById('mobileMenuBtn');
    const menu = document.getElementById('mobileMenu');
    if (!btn || !menu) return;

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isActive = btn.classList.toggle('active');
        menu.classList.toggle('active');
        btn.setAttribute('aria-expanded', isActive);
    });

    document.addEventListener('click', (e) => {
        if (menu.classList.contains('active') && !menu.contains(e.target) && !btn.contains(e.target)) {
            btn.classList.remove('active');
            menu.classList.remove('active');
            btn.setAttribute('aria-expanded', 'false');
        }
    });

    menu.querySelectorAll('button, a').forEach(el => {
        el.addEventListener('click', () => {
            btn.classList.remove('active');
            menu.classList.remove('active');
            btn.setAttribute('aria-expanded', 'false');
        });
    });
})();
