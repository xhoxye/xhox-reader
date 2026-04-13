// ==UserScript==
// @name         沉浸式小说阅读器
// @namespace    https://github.com/xhoxye/xhox-reader
// @version      3.0.0
// @description  沉浸式小说阅读模式 - 智能提取、自动翻页、自定义样式、目录导航、保存为TXT
// @author       xhox and AI
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const THEMES = [
        { name: '默认', bg: '#F5F5F5', text: '#191919', title: '#222222' },
        { name: '护眼绿', bg: '#E0EEE1', text: '#161716', title: '#1a3a1a' },
        { name: '绿色二', bg: '#d8e2c8', text: '#000000', title: '#1a3a1a' },
        { name: '羊皮纸', bg: '#EFE2C0', text: '#171613', title: '#3e2e1e' },
        { name: '淡蓝', bg: '#dce8f5', text: '#2c3e50', title: '#1a252f' },
        { name: '夜间', bg: '#111111', text: '#A0A0A0', title: '#d4d4d4' }
    ];

    const FONT_OPTIONS = [
        { name: '雅黑', value: "'Microsoft YaHei', 'PingFang SC', sans-serif" },
        { name: '启体', value: "'FZQiTi-S14S', 'KaiTi', 'STKaiti', serif" },
        { name: '宋体', value: "'SimSun', 'Songti SC', serif" }
    ];

    const FONT_SIZES = [18, 22, 26, 30, 34];
    const CONTENT_WIDTHS = [800, 1200, 1600];
    const LINE_HEIGHTS = [1.2, 1.4, 1.6, 1.8, 2.0, 2.2];

    const DEFAULT_CONFIG = {
        styles: {
            themeIndex: 0,
            bgColor: '#f5f0e8',
            textColor: '#333333',
            titleColor: '#222222',
            contentWidth: 800,
            fontFamily: FONT_OPTIONS[0].value,
            fontSize: 22,
            lineHeight: 1.8
        },
        extractors: {
            titleSelector: 'h1,h2,h3',
            contentSelector: '#content,#chapter-content,#BookText,.chapter-content,.read-content,.bookreadercontent,#nr1,.p-content',
            contentIdPattern: 'content|chapter|booktext|nr1|article',
            contentClassPattern: 'content|chapter-content|read-content|bookreadercontent|p-content|article-content',
            minBrCount: 3,
            minPCount: 3,
            cleanSelectors: 'script,style,nav,header,footer,aside,iframe,.ad,.ads,.advertisement,.sidebar,.comment,.related,.recommend,.share,.social,.widget,.banner,.promotion',
            replaceRules: '笔趣阁| ,ba王|霸王',
            nextPagerSelector: 'a[rel=next],a.next,a.next-page,a.nextpage',
            nextKeywords: '下一页,下一章,下一章阅读,继续访问,翻页,next,next page,后一章'
        }
    };

    class ConfigManager {
        constructor() {
            this.config = this._load();
        }

        _load() {
            try {
                const saved = GM_getValue('novel_reader_config');
                if (saved) {
                    return this._merge(JSON.parse(JSON.stringify(DEFAULT_CONFIG)), JSON.parse(saved));
                }
            } catch (e) { /* ignore */ }
            return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
        }

        _merge(target, source) {
            for (const key in source) {
                if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                    target[key] = target[key] || {};
                    this._merge(target[key], source[key]);
                } else if (source[key] !== undefined) {
                    target[key] = source[key];
                }
            }
            return target;
        }

        get(path) {
            return path.split('.').reduce((obj, key) => (obj && obj[key] !== undefined) ? obj[key] : undefined, this.config);
        }

        set(path, value) {
            const keys = path.split('.');
            let current = this.config;
            for (let i = 0; i < keys.length - 1; i++) {
                if (!current[keys[i]]) current[keys[i]] = {};
                current = current[keys[i]];
            }
            current[keys[keys.length - 1]] = value;
            this._save();
        }

        _save() {
            try {
                GM_setValue('novel_reader_config', JSON.stringify(this.config));
            } catch (e) { /* ignore */ }
        }

        reset() {
            this.config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
            this._save();
        }
    }

    class ContentExtractor {
        constructor(config) {
            this.config = config;
        }

        extractTitle(doc) {
            doc = doc || document;
            const selector = this.config.get('extractors.titleSelector');
            if (selector) {
                const el = this._querySelectorByPriority(doc, selector);
                if (el) return this._cleanText(el.textContent);
            }

            const patterns = [/第[一二三四五六七八九十百千万\d]+章/, /第\d+[章节幕回卷]/, /^第.*章.*$/, /chapter\s+\d+/i];
            for (let i = 1; i <= 3; i++) {
                for (const h of doc.querySelectorAll(`h${i}`)) {
                    const text = this._cleanText(h.textContent);
                    if (text && text.length < 100 && patterns.some(p => p.test(text))) {
                        return text;
                    }
                }
            }

            const titleEl = doc.querySelector('title');
            if (titleEl) {
                return titleEl.textContent.replace(/[-_|,，·].*$/, '').trim() || '未知章节';
            }
            return '未知章节';
        }

        extractNovelName(doc, chapterTitle) {
            doc = doc || document;
            chapterTitle = this._cleanText(chapterTitle || '');

            const metaName = this._findMetaNovelName(doc, chapterTitle);
            if (metaName) return metaName;

            const breadcrumbName = this._findBreadcrumbNovelName(doc, chapterTitle);
            if (breadcrumbName) return breadcrumbName;

            const titleName = this._findTitleNovelName(doc, chapterTitle);
            if (titleName) return titleName;

            return '\u5c0f\u8bf4\u540d\u79f0';
        }

        _findMetaNovelName(doc, chapterTitle) {
            const selectors = [
                'meta[property="og:novel:book_name"]',
                'meta[name="og:novel:book_name"]',
                'meta[property="book_name"]',
                'meta[name="book_name"]',
                'meta[property="og:title"]',
                'meta[name="og:title"]'
            ];

            for (const selector of selectors) {
                const meta = doc.querySelector(selector);
                const name = meta ? this._normalizeNovelName(meta.getAttribute('content')) : '';
                if (this._isNovelNameCandidate(name, chapterTitle)) return name;
            }

            return '';
        }

        _findBreadcrumbNovelName(doc, chapterTitle) {
            const links = doc.querySelectorAll('.breadcrumb a,.breadcrumbs a,.crumb a,.crumbs a,.path a,.position a,.booknav a,#BookCon a');
            const names = Array.from(links)
                .map(link => this._normalizeNovelName(link.textContent))
                .filter(name => this._isNovelNameCandidate(name, chapterTitle));

            return names.length ? names[names.length - 1] : '';
        }

        _findTitleNovelName(doc, chapterTitle) {
            const titleEl = doc.querySelector('title');
            if (!titleEl) return '';

            let title = this._normalizeNovelName(titleEl.textContent);
            if (chapterTitle) title = title.replace(chapterTitle, '');
            title = title.replace(/[\uFF0C\uFF1A:]/g, ',');
            title = title.replace(/[_\-|]/g, ',');

            const parts = title.split(/[_\-|,，:：]/)
                .map(part => this._normalizeNovelName(part))
                .filter(part => this._isNovelNameCandidate(part, chapterTitle));

            return parts.length ? parts[0] : '';
        }

        _normalizeNovelName(text) {
            return this._cleanText(text || '')
                .replace(/[\u300a\u300b]/g, '')
                .replace(/(\u5168\u6587\u9605\u8bfb|\u6700\u65b0\u7ae0\u8282|\u65e0\u5f39\u7a97|\u514d\u8d39\u9605\u8bfb|\u7b14\u8da3\u9601|book|novel)$/i, '')
                .trim();
        }

        _isNovelNameCandidate(name, chapterTitle) {
            if (!name || name.length < 2 || name.length > 80) return false;
            if (chapterTitle && (name === chapterTitle || chapterTitle.includes(name) || name.includes(chapterTitle))) return false;
            return !/(\u9996\u9875|\u76ee\u5f55|\u76ee\u9304|\u4e0a\u4e00\u7ae0|\u4e0b\u4e00\u7ae0|\u4e0b\u4e00\u9875|\u8fd4\u56de|home|catalog|contents|index|next|prev)/i.test(name);
        }

        extractContent(doc) {
            doc = doc || document;

            const selector = this.config.get('extractors.contentSelector');
            if (selector) {
                const el = this._querySelectorByPriority(doc, selector);
                if (el) {
                    const content = this._processContent(el);
                    if (content) return content;
                }
            }

            const idPattern = this.config.get('extractors.contentIdPattern');
            const classPattern = this.config.get('extractors.contentClassPattern');
            const minBr = this.config.get('extractors.minBrCount') || 3;
            const minP = this.config.get('extractors.minPCount') || 3;

            if (idPattern || classPattern) {
                const candidates = doc.querySelectorAll('div,article,section,main,td');
                for (const el of candidates) {
                    const matchId = !idPattern || (el.id && new RegExp(idPattern, 'i').test(el.id));
                    const matchClass = !classPattern || ([].concat(...el.classList).some(c => new RegExp(classPattern, 'i').test(c)));

                    if (matchId || matchClass) {
                        const pCount = el.querySelectorAll('p').length;
                        const brCount = el.querySelectorAll('br').length;
                        if (pCount >= minP || brCount >= minBr) {
                            const content = this._processContent(el);
                            if (content && content.length > 200) return content;
                        }
                    }
                }
            }

            return this._smartExtract(doc);
        }

        _smartExtract(doc) {
            const minBr = this.config.get('extractors.minBrCount') || 3;
            const minP = this.config.get('extractors.minPCount') || 3;
            let best = null, bestScore = 0;

            for (const container of doc.querySelectorAll('div,article,section,main,td')) {
                if (this._isNonContent(container)) continue;

                const pCount = container.querySelectorAll('p').length;
                const brCount = container.querySelectorAll('br').length;
                const textLen = container.textContent.replace(/\s/g, '').length;
                const linkDensity = this._getLinkDensity(container);

                let score = 0;
                if (pCount >= minP) score += pCount * 15;
                if (brCount >= minBr) score += Math.min(brCount, 30) * 3;
                score += (textLen > 500 ? 60 : textLen / 8);
                score -= linkDensity * 30;

                if ((pCount >= minP || brCount >= minBr) && textLen > 500) score += 120;

                const directP = Array.from(container.children).filter(c => c.tagName === 'P').length;
                if (directP >= minP) score += 50;

                if (score > bestScore && textLen > 300) {
                    bestScore = score;
                    best = container;
                }
            }

            return best ? this._processContent(best) : '';
        }

        _isNonContent(el) {
            const badTags = ['script', 'style', 'nav', 'header', 'footer', 'aside', 'iframe', 'noscript', 'form'];
            const badKeywords = ['ad', 'ads', 'advertisement', 'sidebar', 'nav', 'header', 'footer', 'comment', 'related', 'recommend', 'menu', 'widget', 'banner', 'promotion', 'share', 'social', 'copyright', 'license'];

            if (badTags.includes(el.tagName.toLowerCase())) return true;

            const str = `${el.className || ''} ${el.id || ''}`.toLowerCase();
            return badKeywords.some(kw => str.includes(kw));
        }

        _getLinkDensity(container) {
            const textLen = container.textContent.length;
            if (!textLen) return 1;
            let linkLen = 0;
            container.querySelectorAll('a').forEach(a => { linkLen += a.textContent.length; });
            return linkLen / textLen;
        }

        _processContent(el) {
            const clone = el.cloneNode(true);

            const cleanSels = this.config.get('extractors.cleanSelectors');
            if (cleanSels) {
                cleanSels.split(',').map(s => s.trim()).filter(Boolean).forEach(sel => {
                    try { clone.querySelectorAll(sel).forEach(node => node.remove()); } catch (e) { /* ignore */ }
                });
            }

            let html = clone.innerHTML;

            try {
                const rulesStr = this.config.get('extractors.replaceRules') || '';
                rulesStr.split(',').filter(Boolean).forEach(rule => {
                    const sepIdx = rule.indexOf('|');
                    if (sepIdx > 0) {
                        const find = rule.substring(0, sepIdx);
                        const replace = rule.substring(sepIdx + 1);
                        html = html.replace(new RegExp(find, 'gi'), replace);
                    }
                });
            } catch (e) { /* ignore */ }

            const temp = document.createElement('div');
            temp.innerHTML = html;

            return this._formatText(temp);
        }

        _formatText(container) {
            let text = '';
            const process = (node) => {
                if (node.nodeType === Node.TEXT_NODE) {
                    text += node.textContent;
                } else if (node.nodeType === Node.ELEMENT_NODE) {
                    const tag = node.tagName.toLowerCase();
                    if (tag === 'br') {
                        text += '\n';
                    } else if (['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'tr', 'blockquote'].includes(tag)) {
                        if (text && !text.endsWith('\n')) text += '\n';
                        node.childNodes.forEach(process);
                        if (!text.endsWith('\n')) text += '\n';
                    } else {
                        node.childNodes.forEach(process);
                    }
                }
            };
            container.childNodes.forEach(process);

            return text.split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0)
                .join('\n')
                .replace(/\n{3,}/g, '\n\n');
        }

        _cleanText(text) {
            return text.replace(/\s+/g, ' ').trim();
        }

        _querySelectorByPriority(doc, selectorText) {
            const selectors = String(selectorText || '').split(',').map(sel => sel.trim()).filter(Boolean);
            for (const selector of selectors) {
                try {
                    const el = doc.querySelector(selector);
                    if (el) return el;
                } catch (e) { /* ignore invalid selector */ }
            }
            return null;
        }

        findNextPageUrl(doc, baseUrl) {
            doc = doc || document;
            baseUrl = baseUrl || window.location.href;

            const selector = this.config.get('extractors.nextPagerSelector');
            if (selector) {
                const el = this._querySelectorByPriority(doc, selector);
                const href = this._getLinkHref(el, baseUrl);
                if (href && !this._isSameUrl(href, baseUrl)) return href;
            }

            const keywords = (this.config.get('extractors.nextKeywords') || '').split(',').map(k => k.trim()).filter(Boolean);
            if (!keywords.length) return null;

            let bestLink = null;
            let bestScore = -1;

            for (const link of doc.querySelectorAll('a')) {
                const text = link.textContent.trim();
                const href = this._getLinkHref(link, baseUrl);
                if (!href || this._isSameUrl(href, baseUrl)) continue;

                for (const kw of keywords) {
                    if (text.includes(kw)) {
                        let score = text.length;
                        if (text === kw) score += 100;
                        if (href.includes(kw)) score += 50;
                        if (score > bestScore) {
                            bestScore = score;
                            bestLink = link;
                        }
                    }
                }
            }

            return bestLink ? this._getLinkHref(bestLink, baseUrl) : null;
        }

        isCatalogUrl(doc, url, baseUrl) {
            if (!url) return false;
            doc = doc || document;
            baseUrl = baseUrl || window.location.href;

            const target = this._normalizeUrl(url);
            for (const link of doc.querySelectorAll('a')) {
                if (!this._isCatalogLink(link)) continue;

                const href = this._getLinkHref(link, baseUrl);
                if (href && this._normalizeUrl(href) === target) return true;
            }

            return false;
        }

        _isCatalogLink(link) {
            const text = [
                link.textContent,
                link.getAttribute('title'),
                link.getAttribute('aria-label')
            ].filter(Boolean).join(' ').trim();

            return /(\u76ee\u5f55|\u76ee\u9304|\u7ae0\u8282\u5217\u8868|\u7ae0\u7bc0\u5217\u8868|\u7ae0\u8282\u76ee\u5f55|\u7ae0\u7bc0\u76ee\u9304|\u4e66\u7c4d\u76ee\u5f55|\u66f8\u7c4d\u76ee\u9304|catalog|contents|index)/i.test(text);
        }

        _getLinkHref(link, baseUrl) {
            if (!link) return '';

            const href = (link.getAttribute('href') || '').trim();
            if (!href || href === '#' || /^javascript:/i.test(href)) return '';

            return this._resolveUrl(href, baseUrl);
        }

        _resolveUrl(href, baseUrl) {
            try {
                return new URL(href, baseUrl || window.location.href).href;
            } catch (e) {
                return href;
            }
        }

        _isSameUrl(left, right) {
            return this._normalizeUrl(left) === this._normalizeUrl(right);
        }

        _normalizeUrl(url) {
            try {
                const parsed = new URL(url, window.location.href);
                parsed.hash = '';
                return parsed.href.replace(/\/$/, '');
            } catch (e) {
                return String(url || '').replace(/#.*$/, '').replace(/\/$/, '');
            }
        }
    }

    class NovelReader {
        constructor() {
            this.config = new ConfigManager();
            this.extractor = new ContentExtractor(this.config);
            this.isReadingMode = false;
            this.isLoading = false;
            this.isSavingTxt = false;
            this.chapters = [];
            this.currentChapterIndex = -1;
            this.scrollHandler = null;
            this._loadedUrls = new Set();
            this._chapterAnchors = [];
            this._sidebarVisible = true;
            this._nextPageUrl = null;
            this._originalUrl = null;
            this._novelName = '\u5c0f\u8bf4\u540d\u79f0';

            this._init();
        }

        _init() {
            this._injectStyles();
            this._createToggleButton('\u9605\u8bfb');
            this._showSettingsBtn(true);
            this._createSettingsSurface();
        }

        _injectStyles() {
            GM_addStyle(`
                .nr-btn-base {
                    position: fixed !important;
                    right: 24px !important;
                    bottom: 24px !important;
                    padding: 10px 22px !important;
                    background: #5b6abf !important;
                    color: #fff !important;
                    border: none !important;
                    border-radius: 8px !important;
                    cursor: pointer !important;
                    font-size: 14px !important;
                    font-weight: 500 !important;
                    letter-spacing: 1px !important;
                    box-shadow: 0 2px 12px rgba(91,106,191,0.35) !important;
                    transition: all 0.25s ease !important;
                    z-index: 2147483647 !important;
                    user-select: none !important;
                    display: flex !important;
                    align-items: center !important;
                    gap: 6px !important;
                    line-height: 1 !important;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
                }
                .nr-btn-base:hover {
                    background: #4a59ae !important;
                    box-shadow: 0 4px 18px rgba(91,106,191,0.5) !important;
                    transform: translateY(-1px) !important;
                }
                .nr-btn-base:active {
                    transform: translateY(0) !important;
                }

                #nr-btn-settings {
                    top: 24px !important;
                    bottom: auto !important;
                    right: 24px !important;
                    padding: 8px 16px !important;
                    font-size: 13px !important;
                }

                #nr-sidebar {
                    position: fixed !important;
                    left: 0 !important;
                    top: 0 !important;
                    bottom: 0 !important;
                    width: 240px !important;
                    min-width: 240px !important;
                    max-width: 240px !important;
                    height: 100vh !important;
                    overflow-y: auto !important;
                    background: rgba(30,30,40,0.96) !important;
                    box-shadow: 2px 0 12px rgba(0,0,0,0.25) !important;
                    padding: 0 !important;
                    z-index: 100 !important;
                    display: none !important;
                }
                #nr-sidebar.nr-visible { display: block !important; }

                .nr-sidebar-header {
                    padding: 20px 16px 14px !important;
                    font-size: 15px !important;
                    font-weight: 600 !important;
                    color: #fff !important;
                    border-bottom: 1px solid rgba(255,255,255,0.08) !important;
                    letter-spacing: 1px !important;
                }

                .nr-chapter-item {
                    padding: 10px 16px !important;
                    color: #aaa !important;
                    font-size: 13px !important;
                    cursor: pointer !important;
                    transition: all 0.15s !important;
                    border-left: 3px solid transparent !important;
                    overflow: hidden !important;
                    text-overflow: ellipsis !important;
                    white-space: nowrap !important;
                }
                .nr-chapter-item:hover {
                    background: rgba(91,106,191,0.15) !important;
                    color: #fff !important;
                }
                .nr-chapter-item.nr-active {
                    background: rgba(91,106,191,0.25) !important;
                    color: #fff !important;
                    border-left-color: #5b6abf !important;
                }

                #nr-main {
                    position: fixed !important;
                    top: 0 !important;
                    left: 0 !important;
                    right: 0 !important;
                    bottom: 0 !important;
                    overflow-y: auto !important;
                    background: var(--nr-bg, #f5f0e8) !important;
                    z-index: 50 !important;
                }

                #nr-wrapper {
                    max-width: var(--nr-width, 800px) !important;
                    margin: 0 auto !important;
                    padding: 60px 24px 120px !important;
                    font-family: var(--nr-font, 'Microsoft YaHei', sans-serif) !important;
                    font-size: var(--nr-size, 22px) !important;
                    line-height: var(--nr-line, 1.8) !important;
                    color: var(--nr-text, #333) !important;
                }

                .nr-chapter-anchor { display: block; position: relative; }

                .nr-chapter-title {
                    font-size: 1.6em !important;
                    font-weight: 700 !important;
                    color: var(--nr-title, #222) !important;
                    margin-bottom: 8px !important;
                    padding-bottom: 12px !important;
                    border-bottom: 1px solid rgba(91,106,191,0.2) !important;
                    text-align: left !important;
                }

                .nr-chapter-divider {
                    height: 40px !important;
                    margin: 30px 0 !important;
                    border: none !important;
                    background: linear-gradient(90deg, transparent, rgba(91,106,191,0.15), transparent) !important;
                }

                .nr-content-section p {
                    text-indent: 2em !important;
                    margin-bottom: 0.8em !important;
                    line-height: inherit !important;
                    text-align: left !important;
                }

                .nr-loading {
                    text-align: center !important;
                    padding: 30px !important;
                    color: var(--nr-text, #666) !important;
                    font-size: 14px !important;
                    display: none !important;
                }
                .nr-loading.nr-show { display: block !important; }
                .nr-loading::after {
                    content: '' !important;
                    display: inline-block !important;
                    width: 18px !important;
                    height: 18px !important;
                    border: 2px solid rgba(91,106,191,0.4) !important;
                    border-top-color: #5b6abf !important;
                    border-radius: 50% !important;
                    animation: nr-spin 0.7s linear infinite !important;
                    margin-left: 8px !important;
                    vertical-align: middle !important;
                }
                @keyframes nr-spin { to { transform: rotate(360deg); } }

                .nr-end-mark {
                    text-align: center !important;
                    padding: 18px 22px !important;
                    margin: 34px auto 0 !important;
                    color: #7a3b00 !important;
                    font-size: 16px !important;
                    font-weight: 700 !important;
                    background: #fff3cd !important;
                    border: 2px solid #ffb347 !important;
                    border-radius: 8px !important;
                    box-shadow: 0 6px 20px rgba(122,59,0,0.12) !important;
                }

                #nr-settings-panel {
                    position: fixed !important;
                    top: 50% !important;
                    left: 50% !important;
                    transform: translate(-50%, -50%) !important;
                    width: 680px !important;
                    max-width: 92vw !important;
                    max-height: 85vh !important;
                    background: #fff !important;
                    box-shadow: 0 8px 40px rgba(0,0,0,0.25) !important;
                    border-radius: 12px !important;
                    z-index: 2147483646 !important;
                    overflow-y: auto !important;
                    padding: 20px 24px !important;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
                    direction: ltr !important;
                    text-align: left !important;
                    unicode-bidi: isolate !important;
                    display: none !important;
                }
                #nr-settings-panel.nr-open { display: block !important; }
                #nr-settings-panel * {
                    direction: ltr !important;
                    unicode-bidi: isolate !important;
                }

                .nr-s-title {
                    font-size: 16px !important;
                    font-weight: 600 !important;
                    margin-bottom: 14px !important;
                    color: #222 !important;
                    padding-bottom: 10px !important;
                    border-bottom: 2px solid #5b6abf !important;
                    display: flex !important;
                    justify-content: space-between !important;
                    align-items: center !important;
                }
                .nr-s-close {
                    background: none !important;
                    border: none !important;
                    font-size: 22px !important;
                    color: #999 !important;
                    cursor: pointer !important;
                    padding: 0 4px !important;
                    line-height: 1 !important;
                    transition: color 0.15s !important;
                }
                .nr-s-close:hover { color: #333 !important; }

                .nr-s-section {
                    margin-bottom: 12px !important;
                    padding-bottom: 10px !important;
                    border-bottom: 1px solid #eee !important;
                    text-align: left !important;
                }
                .nr-s-section:last-of-type {
                    border-bottom: none !important;
                }
                .nr-s-section h4 {
                    font-size: 13px !important;
                    font-weight: 600 !important;
                    margin-bottom: 8px !important;
                    color: #444 !important;
                    text-align: left !important;
                }

                .nr-s-help {
                    font-size: 11px !important;
                    color: #888 !important;
                    margin-bottom: 8px !important;
                    padding: 4px 8px !important;
                    background: #f8f8f8 !important;
                    border-radius: 4px !important;
                    line-height: 1.5 !important;
                    text-align: left !important;
                }

                .nr-s-row {
                    display: flex !important;
                    align-items: center !important;
                    justify-content: flex-start !important;
                    margin-bottom: 6px !important;
                    gap: 8px !important;
                    text-align: left !important;
                }
                .nr-s-row label {
                    min-width: 76px !important;
                    font-size: 12px !important;
                    color: #555 !important;
                    flex-shrink: 0 !important;
                    text-align: left !important;
                }
                .nr-s-row input[type="text"],
                .nr-s-row input[type="number"],
                .nr-s-row select,
                .nr-s-row textarea {
                    flex: 1 !important;
                    padding: 5px 8px !important;
                    border: 1px solid #ddd !important;
                    border-radius: 5px !important;
                    font-size: 12px !important;
                    outline: none !important;
                    transition: border-color 0.2s !important;
                    text-align: left !important;
                }
                .nr-s-row input:focus,
                .nr-s-row select:focus,
                .nr-s-row textarea:focus {
                    border-color: #5b6abf !important;
                }
                .nr-s-row input[type="color"] {
                    width: 36px !important;
                    height: 28px !important;
                    padding: 2px !important;
                    cursor: pointer !important;
                    border: 1px solid #ddd !important;
                    border-radius: 5px !important;
                }
                .nr-s-row textarea {
                    min-height: 50px !important;
                    resize: vertical !important;
                    font-family: 'Consolas', 'Monaco', monospace !important;
                    font-size: 11px !important;
                }

                .nr-s-grid2 {
                    display: grid !important;
                    grid-template-columns: 1fr 1fr !important;
                    gap: 6px 16px !important;
                }

                .nr-s-divider {
                    width: 1px !important;
                    height: 18px !important;
                    background: #ddd !important;
                    flex-shrink: 0 !important;
                    margin: 0 4px !important;
                }

                .nr-s-inline-title {
                    display: flex !important;
                    align-items: center !important;
                    justify-content: flex-start !important;
                    gap: 10px !important;
                    flex-wrap: wrap !important;
                    text-align: left !important;
                }
                .nr-s-inline-title > span {
                    font-size: 13px !important;
                    font-weight: 600 !important;
                    color: #444 !important;
                    flex-shrink: 0 !important;
                    text-align: left !important;
                }
                .nr-s-inline-title .nr-theme-grid {
                    margin-bottom: 0 !important;
                }

                .nr-s-switch {
                    display: inline-flex !important;
                    align-items: center !important;
                    gap: 4px !important;
                    cursor: pointer !important;
                    font-size: 12px !important;
                    color: #555 !important;
                    flex-shrink: 0 !important;
                    margin-left: 4px !important;
                }
                .nr-s-switch input[type="checkbox"] {
                    margin: 0 !important;
                    cursor: pointer !important;
                    width: 15px !important;
                    height: 15px !important;
                    accent-color: #5b6abf !important;
                }
                .nr-s-switch span {
                    font-size: 12px !important;
                }

                .nr-theme-grid {
                    display: flex !important;
                    flex-wrap: wrap !important;
                    justify-content: flex-start !important;
                    gap: 6px !important;
                    margin-bottom: 8px !important;
                }
                .nr-theme-item {
                    padding: 4px 10px !important;
                    border-radius: 5px !important;
                    cursor: pointer !important;
                    font-size: 11px !important;
                    border: 2px solid transparent !important;
                    transition: all 0.2s !important;
                    text-align: center !important;
                }
                .nr-theme-item:hover { opacity: 0.85 !important; }
                .nr-theme-item.nr-active { border-color: #5b6abf !important; }

                .nr-size-group, .nr-width-group, .nr-font-group, .nr-line-group {
                    display: flex !important;
                    justify-content: flex-start !important;
                    gap: 4px !important;
                    flex-wrap: wrap !important;
                }
                .nr-size-item, .nr-width-item, .nr-font-item, .nr-line-item {
                    padding: 3px 10px !important;
                    border-radius: 5px !important;
                    cursor: pointer !important;
                    font-size: 12px !important;
                    border: 1px solid #ddd !important;
                    background: #fafafa !important;
                    transition: all 0.15s !important;
                }
                .nr-size-item:hover, .nr-width-item:hover, .nr-font-item:hover, .nr-line-item:hover { border-color: #5b6abf !important; }
                .nr-size-item.nr-active, .nr-width-item.nr-active, .nr-font-item.nr-active, .nr-line-item.nr-active {
                    background: #5b6abf !important;
                    color: #fff !important;
                    border-color: #5b6abf !important;
                }

                html body #nr-settings-panel,
                html body #nr-settings-panel * {
                    direction: ltr !important;
                    unicode-bidi: isolate !important;
                    box-sizing: border-box !important;
                }
                html body #nr-settings-panel,
                html body #nr-settings-panel .nr-s-title,
                html body #nr-settings-panel .nr-s-section,
                html body #nr-settings-panel .nr-s-section h4,
                html body #nr-settings-panel .nr-s-help,
                html body #nr-settings-panel .nr-s-row,
                html body #nr-settings-panel .nr-s-row label,
                html body #nr-settings-panel .nr-s-inline-title,
                html body #nr-settings-panel .nr-s-inline-title > span,
                html body #nr-settings-panel .nr-s-row input,
                html body #nr-settings-panel .nr-s-row textarea,
                html body #nr-settings-panel .nr-s-row select {
                    text-align: left !important;
                }
                html body #nr-settings-panel .nr-s-title,
                html body #nr-settings-panel .nr-s-row,
                html body #nr-settings-panel .nr-s-inline-title,
                html body #nr-settings-panel .nr-theme-grid,
                html body #nr-settings-panel .nr-size-group,
                html body #nr-settings-panel .nr-width-group,
                html body #nr-settings-panel .nr-font-group,
                html body #nr-settings-panel .nr-line-group,
                html body #nr-settings-panel .nr-s-actions {
                    flex-direction: row !important;
                }
                html body #nr-settings-panel .nr-s-row,
                html body #nr-settings-panel .nr-s-inline-title,
                html body #nr-settings-panel .nr-theme-grid,
                html body #nr-settings-panel .nr-size-group,
                html body #nr-settings-panel .nr-width-group,
                html body #nr-settings-panel .nr-font-group,
                html body #nr-settings-panel .nr-line-group {
                    justify-content: flex-start !important;
                }
                html body #nr-settings-panel .nr-theme-item,
                html body #nr-settings-panel .nr-size-item,
                html body #nr-settings-panel .nr-width-item,
                html body #nr-settings-panel .nr-font-item,
                html body #nr-settings-panel .nr-line-item,
                html body #nr-settings-panel .nr-s-btn {
                    text-align: center !important;
                }

                .nr-s-actions {
                    display: flex !important;
                    gap: 8px !important;
                    margin-top: 10px !important;
                    justify-content: space-between !important;
                }
                .nr-s-btn {
                    padding: 6px 14px !important;
                    border: none !important;
                    border-radius: 5px !important;
                    cursor: pointer !important;
                    font-size: 12px !important;
                    transition: all 0.2s !important;
                }
                .nr-s-btn:disabled {
                    opacity: 0.65 !important;
                    cursor: not-allowed !important;
                }
                .nr-s-btn-primary { background: #5b6abf !important; color: #fff !important; }
                .nr-s-btn-primary:hover { background: #4a59ae !important; }
                .nr-s-btn-secondary { background: #6c757d !important; color: #fff !important; }
                .nr-s-btn-secondary:hover { background: #5a6268 !important; }
                .nr-s-btn-danger { background: #dc3545 !important; color: #fff !important; }
                .nr-s-btn-danger:hover { background: #c82333 !important; }

                .nr-settings-overlay {
                    position: fixed !important;
                    top: 0 !important; left: 0 !important; right: 0 !important; bottom: 0 !important;
                    background: rgba(0,0,0,0.3) !important;
                    z-index: 2147483645 !important;
                    display: none !important;
                }
                .nr-settings-overlay.nr-open { display: block !important; }

                #nr-main::-webkit-scrollbar,
                #nr-sidebar::-webkit-scrollbar,
                #nr-settings-panel::-webkit-scrollbar {
                    width: 6px !important;
                }
                #nr-main::-webkit-scrollbar-track,
                #nr-sidebar::-webkit-scrollbar-track,
                #nr-settings-panel::-webkit-scrollbar-track {
                    background: transparent !important;
                }
                #nr-main::-webkit-scrollbar-thumb,
                #nr-sidebar::-webkit-scrollbar-thumb,
                #nr-settings-panel::-webkit-scrollbar-thumb {
                    background: rgba(91,106,191,0.3) !important;
                    border-radius: 3px !important;
                }
            `);
        }

        _createToggleButton(text) {
            let btn = document.getElementById('nr-toggle-btn');
            if (!btn) {
                btn = document.createElement('button');
            }
            btn.id = 'nr-toggle-btn';
            btn.className = 'nr-btn-base';
            btn.textContent = '阅读';
            btn.textContent = text || '\u9605\u8bfb';
            btn.onclick = () => this._toggleReadingMode();
            document.body.appendChild(btn);
            return btn;
        }

        _toggleReadingMode() {
            if (this.isReadingMode) {
                this._exitReadingMode();
            } else {
                this._enterReadingMode();
            }
        }

        _enterReadingMode() {
            if (this.isReadingMode) return;
            this.isReadingMode = true;
            this._originalUrl = window.location.href;
            this._nextPageUrl = null;

            const title = this.extractor.extractTitle();
            this._novelName = this.extractor.extractNovelName(document, title);
            const content = this.extractor.extractContent();
            const nextPageState = this._getNextPageState(document, window.location.href);

            this._savedBodyHtml = document.body.innerHTML;
            this._savedBodyAttrs = document.body.getAttribute('style') || '';

            this._buildReaderUI();

            if (content) {
                this._appendChapter(title, content, window.location.href);
            }
            this._nextPageUrl = nextPageState.url;
            if (!this._nextPageUrl) this._showEndMark(nextPageState.message);

            this._applyStyles();
            this._setupScrollListener();
            this._checkAutoLoadNextPage();

            document.body.style.overflow = 'hidden';
        }

        _exitReadingMode() {
            if (!this.isReadingMode) return;
            this.isReadingMode = false;

            this._removeScrollListener();
            this._closeSettings();

            const currentUrl = this.chapters.length > 0 ? this.chapters[this.currentChapterIndex >= 0 ? this.currentChapterIndex : this.chapters.length - 1].url : null;
            const originalUrl = this._originalUrl;
            const hasNavigated = currentUrl && currentUrl !== originalUrl;

            this.chapters = [];
            this.currentChapterIndex = -1;
            this._loadedUrls.clear();
            this._chapterAnchors = [];
            this._nextPageUrl = null;
            this._originalUrl = null;
            this._novelName = '\u5c0f\u8bf4\u540d\u79f0';

            if (hasNavigated) {
                window.location.href = currentUrl;
                return;
            }

            document.body.innerHTML = this._savedBodyHtml;
            document.body.setAttribute('style', this._savedBodyAttrs);
            this._savedBodyHtml = null;
            this._savedBodyAttrs = null;

            const toggleBtn = document.getElementById('nr-toggle-btn');
            if (toggleBtn) {
                toggleBtn.textContent = '阅读';
                toggleBtn.onclick = () => this._toggleReadingMode();
            }

            this._showSettingsBtn(true);
            this._createSettingsSurface();
        }

        _showSettingsBtn(show) {
            let btn = document.getElementById('nr-btn-settings');
            if (!btn && show) {
                btn = document.createElement('button');
                btn.id = 'nr-btn-settings';
                btn.className = 'nr-btn-base';
                btn.textContent = '设置';
                btn.onclick = () => this._toggleSettings();
                document.body.appendChild(btn);
            }
            if (btn) {
                btn.className = 'nr-btn-base';
                btn.textContent = '\u8bbe\u7f6e';
                btn.onclick = () => this._toggleSettings();
                btn.style.setProperty('display', show ? 'flex' : 'none', 'important');
            }
        }

        _buildReaderUI() {
            document.body.innerHTML = '';

            const toggleBtn = document.createElement('button');
            toggleBtn.id = 'nr-toggle-btn';
            toggleBtn.className = 'nr-btn-base';
            toggleBtn.textContent = '退出';
            toggleBtn.onclick = () => this._toggleReadingMode();
            document.body.appendChild(toggleBtn);

            const settingsBtn = document.createElement('button');
            settingsBtn.id = 'nr-btn-settings';
            settingsBtn.className = 'nr-btn-base';
            settingsBtn.textContent = '设置';
            settingsBtn.onclick = () => this._toggleSettings();
            document.body.appendChild(settingsBtn);

            const sidebar = document.createElement('div');
            sidebar.id = 'nr-sidebar';
            if (this._sidebarVisible) sidebar.classList.add('nr-visible');
            sidebar.innerHTML = '<div class="nr-sidebar-header">章节目录</div><div id="nr-chapter-list"></div>';
            document.body.appendChild(sidebar);

            const main = document.createElement('div');
            main.id = 'nr-main';

            const wrapper = document.createElement('div');
            wrapper.id = 'nr-wrapper';

            const loading = document.createElement('div');
            loading.id = 'nr-loading';
            loading.className = 'nr-loading';

            wrapper.appendChild(loading);
            main.appendChild(wrapper);
            document.body.appendChild(main);

            const panel = this._createSettingsPanel();
            document.body.appendChild(panel);

            const settingsOverlay = document.createElement('div');
            settingsOverlay.id = 'nr-settings-overlay';
            settingsOverlay.className = 'nr-settings-overlay';
            settingsOverlay.onclick = () => this._closeSettings();
            document.body.appendChild(settingsOverlay);
        }

        _appendChapter(title, content, url) {
            if (this._loadedUrls.has(url)) return;
            this._loadedUrls.add(url);

            const wrapper = document.getElementById('nr-wrapper');
            if (!wrapper) return;

            const anchorId = 'nr-ch-' + this.chapters.length;

            const anchor = document.createElement('div');
            anchor.className = 'nr-chapter-anchor';
            anchor.id = anchorId;

            const titleEl = document.createElement('h2');
            titleEl.className = 'nr-chapter-title';
            titleEl.textContent = title;
            anchor.appendChild(titleEl);

            const contentEl = document.createElement('div');
            contentEl.className = 'nr-content-section';
            const paragraphs = content.split('\n').filter(p => p.trim());
            paragraphs.forEach(p => {
                const pEl = document.createElement('p');
                pEl.textContent = p;
                contentEl.appendChild(pEl);
            });
            anchor.appendChild(contentEl);

            if (this.chapters.length > 0) {
                const divider = document.createElement('hr');
                divider.className = 'nr-chapter-divider';
                wrapper.insertBefore(divider, document.getElementById('nr-loading'));
            }

            wrapper.insertBefore(anchor, document.getElementById('nr-loading'));

            this.chapters.push({ title, content, url, anchorId });
            this.currentChapterIndex = this.chapters.length - 1;
            this._chapterAnchors.push(anchorId);

            this._renderToc();
        }

        _renderToc() {
            const list = document.getElementById('nr-chapter-list');
            if (!list) return;

            list.innerHTML = this.chapters.map((ch, i) =>
                `<div class="nr-chapter-item ${i === this.currentChapterIndex ? 'nr-active' : ''}" data-index="${i}">${this._escapeHtml(ch.title)}</div>`
            ).join('');

            list.querySelectorAll('.nr-chapter-item').forEach(item => {
                item.onclick = (e) => {
                    const idx = parseInt(e.currentTarget.dataset.index);
                    this._scrollToChapter(idx);
                };
            });

            const activeItem = list.querySelector('.nr-chapter-item.nr-active');
            if (activeItem) activeItem.scrollIntoView({ block: 'nearest' });
        }

        _scrollToChapter(index) {
            if (index < 0 || index >= this.chapters.length) return;
            const anchor = document.getElementById(this.chapters[index].anchorId);
            if (anchor) {
                anchor.scrollIntoView({ behavior: 'smooth', block: 'start' });
                this.currentChapterIndex = index;
                this._renderToc();
            }
        }

        _applyStyles() {
            const s = this.config.get('styles');
            const main = document.getElementById('nr-main');
            if (!main) return;

            main.style.setProperty('--nr-bg', s.bgColor);
            main.style.setProperty('--nr-width', s.contentWidth + 'px');
            main.style.setProperty('--nr-font', s.fontFamily);
            main.style.setProperty('--nr-size', s.fontSize + 'px');
            main.style.setProperty('--nr-line', s.lineHeight);
            main.style.setProperty('--nr-text', s.textColor);
            main.style.setProperty('--nr-title', s.titleColor);
        }

        _setupScrollListener() {
            const main = document.getElementById('nr-main');
            if (!main) return;

            this.scrollHandler = () => {
                this._checkAutoLoadNextPage();
                this._updateCurrentChapter();
            };

            main.addEventListener('scroll', this.scrollHandler);
        }

        _checkAutoLoadNextPage() {
            const main = document.getElementById('nr-main');
            if (!main || this.isLoading || this.isSavingTxt || !this._nextPageUrl) return;

            if (main.scrollHeight - main.scrollTop - main.clientHeight < 400) {
                this._loadNextPage();
            }
        }

        _removeScrollListener() {
            const main = document.getElementById('nr-main');
            if (main && this.scrollHandler) {
                main.removeEventListener('scroll', this.scrollHandler);
            }
        }

        _updateCurrentChapter() {
            const main = document.getElementById('nr-main');
            if (!main || !this.chapters.length) return;

            const scrollTop = main.scrollTop + 100;
            let currentIdx = 0;

            for (let i = 0; i < this.chapters.length; i++) {
                const anchor = document.getElementById(this.chapters[i].anchorId);
                if (anchor && anchor.offsetTop <= scrollTop) {
                    currentIdx = i;
                }
            }

            if (currentIdx !== this.currentChapterIndex) {
                this.currentChapterIndex = currentIdx;
                this._renderToc();
            }
        }

        _getNextPageState(doc, baseUrl) {
            const nextUrl = this.extractor.findNextPageUrl(doc, baseUrl);
            if (!nextUrl) {
                return {
                    url: null,
                    message: '\u5df2\u5230\u6700\u540e\u4e00\u9875\uff1a\u672a\u627e\u5230\u4e0b\u4e00\u9875\u7ffb\u9875\u94fe\u63a5\u3002'
                };
            }

            if (this.extractor.isCatalogUrl(doc, nextUrl, baseUrl)) {
                return {
                    url: null,
                    message: '\u5df2\u5230\u6700\u540e\u4e00\u9875\uff1a\u4e0b\u4e00\u9875\u94fe\u63a5\u6307\u5411\u76ee\u5f55\uff0c\u5df2\u505c\u6b62\u81ea\u52a8\u52a0\u8f7d\u3002'
                };
            }

            return { url: nextUrl, message: '' };
        }

        async _loadNextPage() {
            this.isLoading = true;
            const loading = document.getElementById('nr-loading');
            if (loading) loading.classList.add('nr-show');

            try {
                const nextUrl = this._nextPageUrl;
                if (!nextUrl) {
                    this._nextPageUrl = null;
                    this._showEndMark('\u5df2\u5230\u6700\u540e\u4e00\u9875\uff1a\u672a\u627e\u5230\u4e0b\u4e00\u9875\u7ffb\u9875\u94fe\u63a5\u3002');
                    return;
                }

                if (this._loadedUrls.has(nextUrl)) {
                    this._nextPageUrl = null;
                    this._showEndMark('\u5df2\u505c\u6b62\u81ea\u52a8\u52a0\u8f7d\uff1a\u4e0b\u4e00\u9875\u5df2\u52a0\u8f7d\u8fc7\uff0c\u907f\u514d\u91cd\u590d\u52a0\u8f7d\u3002');
                    return;
                }

                const html = await this._fetchPage(nextUrl);
                const parser = new DOMParser();
                const doc = parser.parseFromString(html, 'text/html');

                const nextPageState = this._getNextPageState(doc, nextUrl);
                this._nextPageUrl = nextPageState.url;

                const title = this.extractor.extractTitle(doc);
                const content = this.extractor.extractContent(doc);

                if (content && content.trim()) {
                    this._appendChapter(title, content, nextUrl);
                    if (!this._nextPageUrl) this._showEndMark(nextPageState.message);
                } else {
                    this._nextPageUrl = null;
                    this._showEndMark('\u5df2\u505c\u6b62\u81ea\u52a8\u52a0\u8f7d\uff1a\u672a\u63d0\u53d6\u5230\u6709\u6548\u6b63\u6587\u3002');
                }
            } catch (e) {
                console.warn('[NovelReader] 加载下一页失败:', e);
                this._nextPageUrl = null;
                this._showEndMark('\u5df2\u505c\u6b62\u81ea\u52a8\u52a0\u8f7d\uff1a\u4e0b\u4e00\u9875\u52a0\u8f7d\u5931\u8d25\u3002');
            } finally {
                if (loading) loading.classList.remove('nr-show');
                this.isLoading = false;
                setTimeout(() => this._checkAutoLoadNextPage(), 0);
            }
        }

        async _saveAsTxt(button) {
            if (this.isSavingTxt || this.isLoading) {
                alert('\u6b63\u5728\u52a0\u8f7d\u4e2d\uff0c\u8bf7\u7a0d\u540e\u518d\u4fdd\u5b58\u3002');
                return;
            }

            this._saveAllSettings();
            this.extractor = new ContentExtractor(this.config);

            const loading = document.getElementById('nr-loading');
            const originalText = button ? button.textContent : '';

            this.isSavingTxt = true;
            this.isLoading = true;
            if (loading) loading.classList.add('nr-show');
            if (button) {
                button.disabled = true;
                button.textContent = '\u4fdd\u5b58\u4e2d...';
            }

            try {
                const chapters = await this._collectTxtChapters((count) => {
                    if (button) button.textContent = '\u4fdd\u5b58\u4e2d ' + count + '\u7ae0';
                });

                if (!chapters.length) {
                    alert('\u672a\u63d0\u53d6\u5230\u53ef\u4fdd\u5b58\u7684\u6b63\u6587\u3002');
                    return;
                }

                this._downloadTxt(this._buildTxtFileName(chapters), this._formatTxt(chapters));
            } catch (e) {
                console.warn('[NovelReader] \u4fdd\u5b58txt\u5931\u8d25', e);
                alert('\u4fdd\u5b58txt\u5931\u8d25\uff1a' + (e && e.message ? e.message : e));
            } finally {
                if (loading) loading.classList.remove('nr-show');
                this.isLoading = false;
                this.isSavingTxt = false;
                if (button) {
                    button.disabled = false;
                    button.textContent = originalText;
                }
            }
        }

        async _collectTxtChapters(onProgress) {
            const chapters = this.chapters
                .map(chapter => ({
                    title: chapter.title,
                    content: chapter.content || this._getChapterContent(chapter.anchorId),
                    url: chapter.url
                }))
                .filter(chapter => chapter.content && chapter.content.trim());

            const visited = new Set(chapters.map(chapter => this.extractor._normalizeUrl(chapter.url)));
            let nextUrl = this._nextPageUrl;
            let endMessage = '';

            if (onProgress) onProgress(chapters.length);

            while (nextUrl) {
                const normalizedUrl = this.extractor._normalizeUrl(nextUrl);
                if (visited.has(normalizedUrl)) {
                    this._nextPageUrl = null;
                    endMessage = '\u5df2\u505c\u6b62\u81ea\u52a8\u52a0\u8f7d\uff1a\u4e0b\u4e00\u9875\u5df2\u52a0\u8f7d\u8fc7\uff0c\u907f\u514d\u91cd\u590d\u52a0\u8f7d\u3002';
                    break;
                }

                const html = await this._fetchPage(nextUrl);
                const parser = new DOMParser();
                const doc = parser.parseFromString(html, 'text/html');

                const title = this.extractor.extractTitle(doc);
                const content = this.extractor.extractContent(doc);
                if (!content || !content.trim()) {
                    this._nextPageUrl = null;
                    endMessage = '\u5df2\u505c\u6b62\u81ea\u52a8\u52a0\u8f7d\uff1a\u672a\u63d0\u53d6\u5230\u6709\u6548\u6b63\u6587\u3002';
                    break;
                }

                visited.add(normalizedUrl);
                chapters.push({ title, content, url: nextUrl });
                this._appendChapter(title, content, nextUrl);
                if (onProgress) onProgress(chapters.length);

                const nextPageState = this._getNextPageState(doc, nextUrl);
                this._nextPageUrl = nextPageState.url;
                endMessage = nextPageState.message;
                nextUrl = nextPageState.url;
            }

            if (!nextUrl) this._showEndMark(endMessage);
            return chapters;
        }

        _getChapterContent(anchorId) {
            const anchor = document.getElementById(anchorId);
            if (!anchor) return '';

            return Array.from(anchor.querySelectorAll('.nr-content-section p'))
                .map(p => p.textContent.trim())
                .filter(Boolean)
                .join('\n');
        }

        _formatTxt(chapters) {
            return chapters.map((chapter, index) => {
                const title = chapter.title || '\u7b2c' + (index + 1) + '\u7ae0';
                return title + '\n\n' + chapter.content.trim();
            }).join('\n\n\n');
        }

        _buildTxtFileName(chapters) {
            const novelName = this._sanitizeFileNamePart(this._novelName || '\u5c0f\u8bf4\u540d\u79f0');
            const chapterCount = chapters.length;
            const firstChapterTitle = this._sanitizeFileNamePart(chapters[0] && chapters[0].title);
            const base = [
                novelName || '\u5c0f\u8bf4\u540d\u79f0',
                '\u5171' + chapterCount + '\u7ae0',
                firstChapterTitle
            ].filter(Boolean).join('_');

            return base.slice(0, 150) + '.txt';
        }

        _sanitizeFileNamePart(text) {
            return (text || '')
                .replace(/[\\/:*?"<>|]+/g, '_')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 80);
        }

        _downloadTxt(fileName, text) {
            const blob = new Blob(['\ufeff', text], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = fileName;
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }

        _showEndMark(message) {
            const wrapper = document.getElementById('nr-wrapper');
            const loading = document.getElementById('nr-loading');
            if (wrapper && loading) {
                let mark = wrapper.querySelector('.nr-end-mark');
                if (!mark) {
                    mark = document.createElement('div');
                    mark.className = 'nr-end-mark';
                    mark.textContent = '已加载全部章节';
                    wrapper.insertBefore(mark, loading);
                }
                mark.textContent = message || '\u5df2\u52a0\u8f7d\u5168\u90e8\u7ae0\u8282\u3002';
            }
        }

        _fetchPage(url) {
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: url,
                    headers: { 'Accept': 'text/html' },
                    timeout: 15000,
                    onload: (res) => {
                        if (res.status === 200) resolve(res.responseText);
                        else reject(new Error('HTTP ' + res.status));
                    },
                    onerror: reject,
                    ontimeout: () => reject(new Error('Timeout'))
                });
            });
        }

        _toggleSidebar() {
            const sidebar = document.getElementById('nr-sidebar');
            if (!sidebar) return;
            this._sidebarVisible = !this._sidebarVisible;
            sidebar.classList.toggle('nr-visible', this._sidebarVisible);
        }

        _createSettingsSurface() {
            const oldPanel = document.getElementById('nr-settings-panel');
            const oldOverlay = document.getElementById('nr-settings-overlay');
            if (oldPanel) oldPanel.remove();
            if (oldOverlay) oldOverlay.remove();

            const panel = this._createSettingsPanel();
            document.body.appendChild(panel);

            const overlay = document.createElement('div');
            overlay.id = 'nr-settings-overlay';
            overlay.className = 'nr-settings-overlay';
            overlay.onclick = () => this._closeSettings();
            document.body.appendChild(overlay);
        }

        _toggleSettings() {
            let panel = document.getElementById('nr-settings-panel');
            let overlay = document.getElementById('nr-settings-overlay');
            if (!panel) {
                this._createSettingsSurface();
                panel = document.getElementById('nr-settings-panel');
                overlay = document.getElementById('nr-settings-overlay');
            }
            if (!panel) return;

            const isOpen = panel.classList.contains('nr-open');
            if (isOpen) {
                this._closeSettings();
            } else {
                this._syncSettingsUI();
                panel.classList.add('nr-open');
                if (overlay) overlay.classList.add('nr-open');
            }
        }

        _closeSettings() {
            const panel = document.getElementById('nr-settings-panel');
            const overlay = document.getElementById('nr-settings-overlay');
            if (panel) panel.classList.remove('nr-open');
            if (overlay) overlay.classList.remove('nr-open');
        }

        _createSettingsPanel() {
            const panel = document.createElement('div');
            panel.id = 'nr-settings-panel';

            const s = this.config.get('styles');
            const e = this.config.get('extractors');

            panel.innerHTML = `
                <div class="nr-s-title">阅读设置<button class="nr-s-close" id="nr-s-close">&times;</button></div>

                <div class="nr-s-section">
                    <div class="nr-s-inline-title">
                        <span>阅读主题</span>
                        <div class="nr-theme-grid" id="nr-theme-grid">
                            ${THEMES.map((t, i) => `<div class="nr-theme-item ${i === s.themeIndex ? 'nr-active' : ''}" data-index="${i}" style="background:${t.bg};color:${t.text}">${t.name}</div>`).join('')}
                        </div>
                        <span class="nr-s-divider"></span>
                        <label class="nr-s-switch"><input type="checkbox" id="nr-s-toggle-sidebar" ${this._sidebarVisible ? 'checked' : ''}><span>显示目录</span></label>
                    </div>
                </div>

                <div class="nr-s-section">
                    <div class="nr-s-inline-title">
                        <span>字体</span>
                        <div class="nr-font-group" id="nr-font-group">
                            ${FONT_OPTIONS.map(f => `<div class="nr-font-item ${s.fontFamily === f.value ? 'nr-active' : ''}" data-font="${f.value}">${f.name}</div>`).join('')}
                        </div>
                        <span class="nr-s-divider"></span>
                        <span>行高</span>
                        <div class="nr-line-group" id="nr-line-group">
                            ${LINE_HEIGHTS.map(lh => `<div class="nr-line-item ${parseFloat(s.lineHeight) === lh ? 'nr-active' : ''}" data-line="${lh}">${lh}</div>`).join('')}
                        </div>
                    </div>
                    <div class="nr-s-inline-title" style="margin-top:6px">
                        <span>字号</span>
                        <div class="nr-size-group" id="nr-size-group">
                            ${FONT_SIZES.map(sz => `<div class="nr-size-item ${parseInt(s.fontSize) === sz ? 'nr-active' : ''}" data-size="${sz}">${sz}</div>`).join('')}
                        </div>
                        <span class="nr-s-divider"></span>
                        <span>宽度</span>
                        <div class="nr-width-group" id="nr-width-group">
                            ${CONTENT_WIDTHS.map(w => `<div class="nr-width-item ${parseInt(s.contentWidth) === w ? 'nr-active' : ''}" data-width="${w}">${w}</div>`).join('')}
                        </div>
                    </div>
                </div>

                <div class="nr-s-section">
                    <h4>内容提取</h4>
                    <div class="nr-s-help">#id选择器 &nbsp; .class选择器 &nbsp; 无前缀=标签名 &nbsp; 逗号分隔多个</div>
                    <div class="nr-s-grid2">
                        <div class="nr-s-row">
                            <label>标题选择器</label>
                            <input type="text" id="nr-s-title-sel" value="${e.titleSelector}" placeholder="h1,h2,h3">
                        </div>
                        <div class="nr-s-row">
                            <label>正文选择器</label>
                            <input type="text" id="nr-s-content-sel" value="${e.contentSelector}" placeholder="#content,.chapter-content">
                        </div>
                        <div class="nr-s-row">
                            <label>ID模式</label>
                            <input type="text" id="nr-s-id-pat" value="${e.contentIdPattern}" placeholder="content|chapter">
                        </div>
                        <div class="nr-s-row">
                            <label>Class模式</label>
                            <input type="text" id="nr-s-class-pat" value="${e.contentClassPattern}" placeholder="content|chapter-content">
                        </div>
                        <div class="nr-s-row">
                            <label>最小P数</label>
                            <input type="number" id="nr-s-min-p" value="${e.minPCount}" min="1">
                        </div>
                        <div class="nr-s-row">
                            <label>最小BR数</label>
                            <input type="number" id="nr-s-min-br" value="${e.minBrCount}" min="1">
                        </div>
                    </div>
                    <div class="nr-s-row" style="margin-top:4px">
                        <label>清洗选择器</label>
                        <textarea id="nr-s-clean">${e.cleanSelectors}</textarea>
                    </div>
                    <div class="nr-s-row">
                        <label>替换规则</label>
                        <textarea id="nr-s-replace" placeholder="原文|替换,如:笔趣阁|,ba王|霸王">${e.replaceRules}</textarea>
                    </div>
                </div>

                <div class="nr-s-section">
                    <h4>翻页</h4>
                    <div class="nr-s-row">
                        <label>下一页选择器</label>
                        <input type="text" id="nr-s-next-sel" value="${e.nextPagerSelector}" placeholder="a[rel=next],a.next">
                    </div>
                    <div class="nr-s-row">
                        <label>翻页关键词</label>
                        <input type="text" id="nr-s-next-kw" value="${e.nextKeywords}" placeholder="逗号分隔">
                    </div>
                </div>

                <div class="nr-s-actions">
                    <button class="nr-s-btn nr-s-btn-secondary" id="nr-s-save-txt">\u4fdd\u5b58\u4e3atxt</button>
                    <button class="nr-s-btn nr-s-btn-danger" id="nr-s-reset">重置默认</button>
                    <button class="nr-s-btn nr-s-btn-primary" id="nr-s-save">保存并应用</button>
                </div>
            `;

            this._lockSettingsPanelLayout(panel);
            this._bindSettingsEvents(panel);
            return panel;
        }

        _lockSettingsPanelLayout(panel) {
            if (!panel) return;

            const setStyles = (el, styles) => {
                if (!el) return;
                Object.keys(styles).forEach(prop => {
                    el.style.setProperty(prop, styles[prop], 'important');
                });
            };

            const leftAligned = {
                direction: 'ltr',
                'unicode-bidi': 'isolate',
                'text-align': 'left',
                'writing-mode': 'horizontal-tb'
            };

            setStyles(panel, Object.assign({}, leftAligned, {
                float: 'none',
                margin: '0',
                'margin-left': '0',
                'margin-right': '0'
            }));
            panel.setAttribute('dir', 'ltr');

            panel.querySelectorAll('*').forEach(el => {
                setStyles(el, {
                    direction: 'ltr',
                    'unicode-bidi': 'isolate',
                    'box-sizing': 'border-box',
                    'writing-mode': 'horizontal-tb'
                });
            });

            panel.querySelectorAll('.nr-s-title,.nr-s-section,.nr-s-section h4,.nr-s-help,.nr-s-row,.nr-s-row label,.nr-s-inline-title,.nr-s-inline-title > span,.nr-s-row input,.nr-s-row textarea,.nr-s-row select').forEach(el => {
                setStyles(el, { 'text-align': 'left' });
            });

            panel.querySelectorAll('.nr-s-title,.nr-s-row,.nr-s-inline-title,.nr-theme-grid,.nr-size-group,.nr-width-group,.nr-font-group,.nr-line-group,.nr-s-actions').forEach(el => {
                setStyles(el, {
                    display: 'flex',
                    'flex-direction': 'row',
                    float: 'none',
                    clear: 'none',
                    position: 'static',
                    left: 'auto',
                    right: 'auto',
                    transform: 'none'
                });
            });

            panel.querySelectorAll('.nr-s-row,.nr-s-inline-title,.nr-theme-grid,.nr-size-group,.nr-width-group,.nr-font-group,.nr-line-group').forEach(el => {
                setStyles(el, {
                    'justify-content': 'flex-start',
                    'align-content': 'flex-start',
                    'margin-left': '0',
                    'margin-right': '0'
                });
            });

            panel.querySelectorAll('.nr-s-title,.nr-s-actions').forEach(el => {
                setStyles(el, { 'justify-content': 'space-between' });
            });

            panel.querySelectorAll('.nr-theme-item,.nr-size-item,.nr-width-item,.nr-font-item,.nr-line-item,.nr-s-btn').forEach(el => {
                setStyles(el, { 'text-align': 'center' });
            });

            panel.querySelectorAll('.nr-s-section,.nr-s-grid2').forEach(el => {
                setStyles(el, {
                    display: el.classList.contains('nr-s-grid2') ? 'grid' : 'block',
                    width: '100%',
                    float: 'none',
                    clear: 'none',
                    'margin-left': '0',
                    'margin-right': '0',
                    'text-align': 'left'
                });
            });

            panel.querySelectorAll('.nr-s-inline-title').forEach(el => {
                setStyles(el, {
                    width: '100%',
                    'min-width': '100%',
                    'max-width': '100%'
                });
            });

            panel.querySelectorAll('.nr-s-inline-title > *').forEach(el => {
                setStyles(el, {
                    float: 'none',
                    position: 'static',
                    left: 'auto',
                    right: 'auto',
                    'margin-left': '0',
                    'margin-right': '0'
                });
            });

            panel.querySelectorAll('.nr-s-switch').forEach(el => {
                setStyles(el, { 'margin-left': '4px' });
            });
        }

        _bindSettingsEvents(panel) {
            panel.addEventListener('click', (e) => {
                const target = e.target;

                if (target.classList.contains('nr-theme-item')) {
                    const idx = parseInt(target.dataset.index);
                    this._applyTheme(idx);
                }

                if (target.classList.contains('nr-size-item')) {
                    const size = parseInt(target.dataset.size);
                    this._applyFontSize(size);
                }

                if (target.classList.contains('nr-width-item')) {
                    const width = parseInt(target.dataset.width);
                    this._applyContentWidth(width);
                }

                if (target.classList.contains('nr-font-item')) {
                    const font = target.dataset.font;
                    this.config.set('styles.fontFamily', font);
                    this._applyStyles();
                    this._syncSettingsUI();
                }

                if (target.classList.contains('nr-line-item')) {
                    const line = parseFloat(target.dataset.line);
                    this.config.set('styles.lineHeight', line);
                    this._applyStyles();
                    this._syncSettingsUI();
                }
            });

            panel.addEventListener('change', (e) => {
                const id = e.target.id;
                if (!id) return;

                switch (id) {
                    case 'nr-s-toggle-sidebar':
                        this._sidebarVisible = e.target.checked;
                        const sidebar = document.getElementById('nr-sidebar');
                        if (sidebar) sidebar.classList.toggle('nr-visible', this._sidebarVisible);
                        break;
                }
            });

            setTimeout(() => {
                const saveBtn = document.getElementById('nr-s-save');
                const saveTxtBtn = document.getElementById('nr-s-save-txt');
                const resetBtn = document.getElementById('nr-s-reset');
                const closeBtn = document.getElementById('nr-s-close');

                if (saveBtn) {
                    saveBtn.onclick = () => {
                        this._saveAllSettings();
                        this._applyStyles();
                        this.extractor = new ContentExtractor(this.config);
                        this._closeSettings();
                    };
                }

                if (saveTxtBtn) {
                    saveTxtBtn.onclick = () => this._saveAsTxt(saveTxtBtn);
                }

                if (resetBtn) {
                    resetBtn.onclick = () => {
                        if (confirm('确定重置所有设置为默认值？')) {
                            this.config.reset();
                            this._sidebarVisible = true;
                            this.extractor = new ContentExtractor(this.config);
                            this._applyStyles();
                            this._syncSettingsUI();
                        }
                    };
                }

                if (closeBtn) {
                    closeBtn.onclick = () => this._closeSettings();
                }
            }, 100);
        }

        _applyTheme(index) {
            const theme = THEMES[index];
            if (!theme) return;

            this.config.set('styles.themeIndex', index);
            this.config.set('styles.bgColor', theme.bg);
            this.config.set('styles.textColor', theme.text);
            this.config.set('styles.titleColor', theme.title);
            this._applyStyles();
            this._syncSettingsUI();
        }

        _applyFontSize(size) {
            this.config.set('styles.fontSize', size);
            this._applyStyles();
            this._syncSettingsUI();
        }

        _applyContentWidth(width) {
            this.config.set('styles.contentWidth', width);
            this._applyStyles();
            this._syncSettingsUI();
        }

        _syncSettingsUI() {
            this._lockSettingsPanelLayout(document.getElementById('nr-settings-panel'));

            const s = this.config.get('styles');
            const e = this.config.get('extractors');

            const setVal = (id, val) => {
                const el = document.getElementById(id);
                if (el) el.value = val;
            };

            const fontGroup = document.getElementById('nr-font-group');
            if (fontGroup) {
                fontGroup.querySelectorAll('.nr-font-item').forEach(item => {
                    item.classList.toggle('nr-active', item.dataset.font === s.fontFamily);
                });
            }

            const lineGroup = document.getElementById('nr-line-group');
            if (lineGroup) {
                lineGroup.querySelectorAll('.nr-line-item').forEach(item => {
                    item.classList.toggle('nr-active', parseFloat(item.dataset.line) === parseFloat(s.lineHeight));
                });
            }

            const themeGrid = document.getElementById('nr-theme-grid');
            if (themeGrid) {
                themeGrid.querySelectorAll('.nr-theme-item').forEach(item => {
                    item.classList.toggle('nr-active', parseInt(item.dataset.index) === s.themeIndex);
                });
            }

            const sizeGroup = document.getElementById('nr-size-group');
            if (sizeGroup) {
                sizeGroup.querySelectorAll('.nr-size-item').forEach(item => {
                    item.classList.toggle('nr-active', parseInt(item.dataset.size) === parseInt(s.fontSize));
                });
            }

            const widthGroup = document.getElementById('nr-width-group');
            if (widthGroup) {
                widthGroup.querySelectorAll('.nr-width-item').forEach(item => {
                    item.classList.toggle('nr-active', parseInt(item.dataset.width) === parseInt(s.contentWidth));
                });
            }

            const sidebarCb = document.getElementById('nr-s-toggle-sidebar');
            if (sidebarCb) sidebarCb.checked = this._sidebarVisible;

            const sidebar = document.getElementById('nr-sidebar');
            if (sidebar) sidebar.classList.toggle('nr-visible', this._sidebarVisible);

            [
                ['nr-s-title-sel', 'titleSelector'],
                ['nr-s-content-sel', 'contentSelector'],
                ['nr-s-id-pat', 'contentIdPattern'],
                ['nr-s-class-pat', 'contentClassPattern'],
                ['nr-s-min-p', 'minPCount'],
                ['nr-s-min-br', 'minBrCount'],
                ['nr-s-clean', 'cleanSelectors'],
                ['nr-s-replace', 'replaceRules'],
                ['nr-s-next-sel', 'nextPagerSelector'],
                ['nr-s-next-kw', 'nextKeywords']
            ].forEach(([id, key]) => setVal(id, e[key]));
        }

        _saveAllSettings() {
            const val = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };

            this.config.set('extractors.titleSelector', val('nr-s-title-sel'));
            this.config.set('extractors.contentSelector', val('nr-s-content-sel'));
            this.config.set('extractors.contentIdPattern', val('nr-s-id-pat'));
            this.config.set('extractors.contentClassPattern', val('nr-s-class-pat'));
            this.config.set('extractors.minPCount', parseInt(val('nr-s-min-p')) || 3);
            this.config.set('extractors.minBrCount', parseInt(val('nr-s-min-br')) || 3);
            this.config.set('extractors.cleanSelectors', val('nr-s-clean'));
            this.config.set('extractors.replaceRules', val('nr-s-replace'));
            this.config.set('extractors.nextPagerSelector', val('nr-s-next-sel'));
            this.config.set('extractors.nextKeywords', val('nr-s-next-kw'));
        }

        _escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => new NovelReader());
    } else {
        new NovelReader();
    }
})();
