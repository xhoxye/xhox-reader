// ==UserScript==
// @name         沉浸式小说阅读
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  沉浸式小说阅读体验，智能正文提取、自定义样式、无限滚动加载、内容清洗、自动翻页
// @author       User
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      *
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    // ==================== 默认配置 ====================
    const DEFAULT_CONFIG = {
        // 主题配色 (背景色, 文字色)
        themes: [
            { name: '护眼绿', bg: '#cdeed1', text: '#333333' },
            { name: '羊皮纸', bg: '#f5ebd9', text: '#5d4037' },
            { name: '深灰', bg: '#e0e0e0', text: '#212121' },
            { name: '夜间模式', bg: '#1a1a1a', text: '#b0b0b0' },
            { name: '纯白', bg: '#ffffff', text: '#000000' }
        ],
        // 字体选项
        fonts: ['微软雅黑', '方正启体简体', '宋体', '楷体', '黑体'],
        // 字号选项
        fontSizes: [18, 22, 26, 30, 34],
        // 内容宽度选项
        widths: [800, 1200, 1600],
        // 行高倍数
        lineHeights: [1.5, 1.8, 2.0, 2.2, 2.5],
        
        // 用户自定义配置
        userConfig: {
            themeIndex: 0,
            fontFamily: '微软雅黑',
            fontSize: 22,
            contentWidth: 1200,
            lineHeight: 1.8,
            
            // 选择器配置
            titleSelector: '',
            contentSelector: '',
            cleanSelectors: '', // 每行一个选择器
            replaceRules: '', // 格式: 正则表达式|替换内容
            nextLinkSelector: '',
            nextKeywords: '下一页,下一章,后一页,继续'
        }
    };

    // ==================== 状态管理 ====================
    let state = {
        isReadingMode: false,
        config: loadConfig(),
        chapters: [], // 已阅读的章节记录
        currentChapter: null,
        isLoading: false,
        originalScrollY: 0
    };

    // ==================== 工具函数 ====================
    function loadConfig() {
        try {
            const saved = GM_getValue('novelReaderConfig');
            if (saved) {
                return JSON.parse(saved);
            }
        } catch (e) {
            console.error('加载配置失败:', e);
        }
        return JSON.parse(JSON.stringify(DEFAULT_CONFIG.userConfig));
    }

    function saveConfig() {
        try {
            GM_setValue('novelReaderConfig', JSON.stringify(state.config));
        } catch (e) {
            console.error('保存配置失败:', e);
        }
    }

    function $(selector, context = document) {
        return context.querySelector(selector);
    }

    function $$(selector, context = document) {
        return Array.from(context.querySelectorAll(selector));
    }

    // ==================== UI 组件 ====================
    
    // 创建悬浮按钮
    function createFloatButton() {
        if ($('#novel-reader-float-btn')) return;
        
        const btn = document.createElement('div');
        btn.id = 'novel-reader-float-btn';
        btn.textContent = '阅读';
        btn.style.cssText = `
            position: fixed;
            right: 20px;
            bottom: 20px;
            z-index: 999999;
            padding: 12px 24px;
            background: #4CAF50;
            color: white;
            border-radius: 25px;
            cursor: pointer;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            font-size: 16px;
            font-weight: bold;
            transition: all 0.3s ease;
            user-select: none;
        `;
        
        btn.addEventListener('mouseenter', () => {
            btn.style.transform = 'scale(1.05)';
            btn.style.boxShadow = '0 6px 16px rgba(0,0,0,0.4)';
        });
        
        btn.addEventListener('mouseleave', () => {
            btn.style.transform = 'scale(1)';
            btn.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
        });
        
        btn.addEventListener('click', enterReadingMode);
        
        document.body.appendChild(btn);
    }

    // 进入阅读模式
    function enterReadingMode() {
        state.isReadingMode = true;
        state.originalScrollY = window.scrollY;
        
        // 隐藏原悬浮按钮
        const floatBtn = $('#novel-reader-float-btn');
        if (floatBtn) floatBtn.style.display = 'none';
        
        // 创建阅读模式容器
        createReadingModeUI();
        
        // 提取并显示内容
        extractAndDisplayContent();
        
        // 阻止页面滚动
        document.body.style.overflow = 'hidden';
    }

    // 创建阅读模式界面
    function createReadingModeUI() {
        // 全屏遮罩
        const overlay = document.createElement('div');
        overlay.id = 'novel-reader-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: 999998;
            background: ${getThemeColors().bg};
            overflow: hidden;
        `;
        
        // 主内容区
        const mainContainer = document.createElement('div');
        mainContainer.id = 'novel-reader-main';
        mainContainer.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            display: flex;
        `;
        
        // 左侧目录栏
        const sidebar = document.createElement('div');
        sidebar.id = 'novel-reader-sidebar';
        sidebar.style.cssText = `
            width: 200px;
            background: rgba(0,0,0,0.05);
            border-right: 1px solid rgba(0,0,0,0.1);
            overflow-y: auto;
            padding: 20px 10px;
            display: none;
        `;
        
        // 内容区域
        const contentArea = document.createElement('div');
        contentArea.id = 'novel-reader-content-area';
        contentArea.style.cssText = `
            flex: 1;
            overflow-y: auto;
            padding: 40px 20px;
            display: flex;
            flex-direction: column;
            align-items: center;
        `;
        
        // 章节容器
        const chapterContainer = document.createElement('div');
        chapterContainer.id = 'novel-reader-chapter-container';
        chapterContainer.style.cssText = `
            max-width: ${state.config.contentWidth}px;
            width: 100%;
            font-family: "${state.config.fontFamily}", serif;
            font-size: ${state.config.fontSize}px;
            line-height: ${state.config.lineHeight};
            color: ${getThemeColors().text};
        `;
        
        // 右上角设置按钮
        const settingsBtn = document.createElement('button');
        settingsBtn.id = 'novel-reader-settings-btn';
        settingsBtn.textContent = '⚙️';
        settingsBtn.style.cssText = `
            position: fixed;
            top: 20px;
            right: 80px;
            z-index: 1000000;
            width: 50px;
            height: 50px;
            border-radius: 50%;
            border: none;
            background: rgba(0,0,0,0.1);
            cursor: pointer;
            font-size: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.3s ease;
        `;
        settingsBtn.addEventListener('click', toggleSettingsPanel);
        
        // 右下角退出按钮
        const exitBtn = document.createElement('button');
        exitBtn.id = 'novel-reader-exit-btn';
        exitBtn.textContent = '退出';
        exitBtn.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            z-index: 1000000;
            padding: 12px 24px;
            background: #f44336;
            color: white;
            border: none;
            border-radius: 25px;
            cursor: pointer;
            font-size: 16px;
            font-weight: bold;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            transition: all 0.3s ease;
        `;
        exitBtn.addEventListener('click', exitReadingMode);
        
        // 设置面板
        const settingsPanel = createSettingsPanel();
        
        // 组装
        contentArea.appendChild(chapterContainer);
        mainContainer.appendChild(sidebar);
        mainContainer.appendChild(contentArea);
        overlay.appendChild(mainContainer);
        overlay.appendChild(settingsBtn);
        overlay.appendChild(exitBtn);
        overlay.appendChild(settingsPanel);
        
        document.body.appendChild(overlay);
    }

    // 获取当前主题颜色
    function getThemeColors() {
        const theme = DEFAULT_CONFIG.themes[state.config.themeIndex];
        return { bg: theme.bg, text: theme.text };
    }

    // 创建设置面板
    function createSettingsPanel() {
        const panel = document.createElement('div');
        panel.id = 'novel-reader-settings-panel';
        panel.style.cssText = `
            position: fixed;
            top: 80px;
            right: 20px;
            z-index: 1000001;
            background: white;
            border-radius: 10px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
            padding: 20px;
            width: 350px;
            max-height: 80vh;
            overflow-y: auto;
            display: none;
            font-family: "微软雅黑", sans-serif;
            font-size: 14px;
        `;
        
        const themesHtml = DEFAULT_CONFIG.themes.map((t, i) => 
            `<button class="theme-btn" data-index="${i}" style="
                background: ${t.bg};
                color: ${t.text};
                border: 1px solid #ccc;
                padding: 8px 12px;
                margin: 5px;
                border-radius: 5px;
                cursor: pointer;
                ${i === state.config.themeIndex ? 'border: 2px solid #4CAF50;' : ''}
            ">${t.name}</button>`
        ).join('');
        
        const fontsHtml = DEFAULT_CONFIG.fonts.map(f => 
            `<option value="${f}" ${f === state.config.fontFamily ? 'selected' : ''}>${f}</option>`
        ).join('');
        
        const sizesHtml = DEFAULT_CONFIG.fontSizes.map(s => 
            `<option value="${s}" ${s === state.config.fontSize ? 'selected' : ''}>${s}px</option>`
        ).join('');
        
        const widthsHtml = DEFAULT_CONFIG.widths.map(w => 
            `<option value="${w}" ${w === state.config.contentWidth ? 'selected' : ''}>${w}px</option>`
        ).join('');
        
        const lineHeightsHtml = DEFAULT_CONFIG.lineHeights.map(l => 
            `<option value="${l}" ${l === state.config.lineHeight ? 'selected' : ''}>${l}</option>`
        ).join('');
        
        panel.innerHTML = `
            <h3 style="margin-top: 0; border-bottom: 1px solid #eee; padding-bottom: 10px;">阅读设置</h3>
            
            <div style="margin-bottom: 15px;">
                <label style="display: block; margin-bottom: 5px; font-weight: bold;">主题</label>
                <div>${themesHtml}</div>
            </div>
            
            <div style="margin-bottom: 15px;">
                <label style="display: block; margin-bottom: 5px; font-weight: bold;">字体</label>
                <select id="font-family-select" style="width: 100%; padding: 8px;">${fontsHtml}</select>
            </div>
            
            <div style="margin-bottom: 15px;">
                <label style="display: block; margin-bottom: 5px; font-weight: bold;">字号</label>
                <select id="font-size-select" style="width: 100%; padding: 8px;">${sizesHtml}</select>
            </div>
            
            <div style="margin-bottom: 15px;">
                <label style="display: block; margin-bottom: 5px; font-weight: bold;">内容宽度</label>
                <select id="content-width-select" style="width: 100%; padding: 8px;">${widthsHtml}</select>
            </div>
            
            <div style="margin-bottom: 15px;">
                <label style="display: block; margin-bottom: 5px; font-weight: bold;">行高</label>
                <select id="line-height-select" style="width: 100%; padding: 8px;">${lineHeightsHtml}</select>
            </div>
            
            <hr style="border: none; border-top: 1px solid #eee; margin: 15px 0;">
            
            <h4 style="margin: 10px 0;">高级设置</h4>
            
            <div style="margin-bottom: 10px;">
                <label style="display: block; margin-bottom: 3px;">标题选择器</label>
                <input type="text" id="title-selector-input" value="${state.config.titleSelector || ''}" 
                    style="width: 100%; padding: 6px; box-sizing: border-box;" placeholder="如: h1, .title">
            </div>
            
            <div style="margin-bottom: 10px;">
                <label style="display: block; margin-bottom: 3px;">正文选择器</label>
                <input type="text" id="content-selector-input" value="${state.config.contentSelector || ''}" 
                    style="width: 100%; padding: 6px; box-sizing: border-box;" placeholder="如: #content, .article">
            </div>
            
            <div style="margin-bottom: 10px;">
                <label style="display: block; margin-bottom: 3px;">清洗选择器 (每行一个)</label>
                <textarea id="clean-selectors-input" rows="3" 
                    style="width: 100%; padding: 6px; box-sizing: border-box;" 
                    placeholder=".ad, #advertisement">${state.config.cleanSelectors || ''}</textarea>
            </div>
            
            <div style="margin-bottom: 10px;">
                <label style="display: block; margin-bottom: 3px;">替换规则 (正则 | 替换)</label>
                <textarea id="replace-rules-input" rows="3" 
                    style="width: 100%; padding: 6px; box-sizing: border-box;" 
                    placeholder="广告.*?|\\n本章字数.*?|">${state.config.replaceRules || ''}</textarea>
            </div>
            
            <div style="margin-bottom: 10px;">
                <label style="display: block; margin-bottom: 3px;">下一页链接选择器</label>
                <input type="text" id="next-link-selector-input" value="${state.config.nextLinkSelector || ''}" 
                    style="width: 100%; padding: 6px; box-sizing: border-box;" placeholder="如: .next-page a">
            </div>
            
            <div style="margin-bottom: 15px;">
                <label style="display: block; margin-bottom: 3px;">翻页关键词</label>
                <input type="text" id="next-keywords-input" value="${state.config.nextKeywords || ''}" 
                    style="width: 100%; padding: 6px; box-sizing: border-box;" placeholder="下一页，下一章">
            </div>
            
            <button id="save-settings-btn" style="
                width: 100%;
                padding: 10px;
                background: #4CAF50;
                color: white;
                border: none;
                border-radius: 5px;
                cursor: pointer;
                font-size: 16px;
            ">保存设置</button>
        `;
        
        // 绑定事件
        panel.querySelectorAll('.theme-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                state.config.themeIndex = parseInt(btn.dataset.index);
                applySettings();
                saveConfig();
            });
        });
        
        $('#font-family-select', panel).addEventListener('change', (e) => {
            state.config.fontFamily = e.target.value;
            applySettings();
            saveConfig();
        });
        
        $('#font-size-select', panel).addEventListener('change', (e) => {
            state.config.fontSize = parseInt(e.target.value);
            applySettings();
            saveConfig();
        });
        
        $('#content-width-select', panel).addEventListener('change', (e) => {
            state.config.contentWidth = parseInt(e.target.value);
            applySettings();
            saveConfig();
        });
        
        $('#line-height-select', panel).addEventListener('change', (e) => {
            state.config.lineHeight = parseFloat(e.target.value);
            applySettings();
            saveConfig();
        });
        
        $('#save-settings-btn', panel).addEventListener('click', () => {
            state.config.titleSelector = $('#title-selector-input', panel).value.trim();
            state.config.contentSelector = $('#content-selector-input', panel).value.trim();
            state.config.cleanSelectors = $('#clean-selectors-input', panel).value.trim();
            state.config.replaceRules = $('#replace-rules-input', panel).value.trim();
            state.config.nextLinkSelector = $('#next-link-selector-input', panel).value.trim();
            state.config.nextKeywords = $('#next-keywords-input', panel).value.trim();
            saveConfig();
            alert('设置已保存！');
            toggleSettingsPanel();
        });
        
        return panel;
    }

    function toggleSettingsPanel() {
        const panel = $('#novel-reader-settings-panel');
        if (panel) {
            panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
        }
    }

    function applySettings() {
        const colors = getThemeColors();
        const overlay = $('#novel-reader-overlay');
        const container = $('#novel-reader-chapter-container');
        
        if (overlay) {
            overlay.style.background = colors.bg;
        }
        
        if (container) {
            container.style.fontFamily = `"${state.config.fontFamily}", serif`;
            container.style.fontSize = `${state.config.fontSize}px`;
            container.style.maxWidth = `${state.config.contentWidth}px`;
            container.style.lineHeight = state.config.lineHeight;
            container.style.color = colors.text;
        }
    }

    // 退出阅读模式
    function exitReadingMode() {
        state.isReadingMode = false;
        
        const overlay = $('#novel-reader-overlay');
        if (overlay) {
            overlay.remove();
        }
        
        const floatBtn = $('#novel-reader-float-btn');
        if (floatBtn) {
            floatBtn.style.display = 'block';
        }
        
        document.body.style.overflow = '';
        window.scrollTo(0, state.originalScrollY);
    }

    // ==================== 内容提取 ====================
    
    function extractAndDisplayContent() {
        const chapterData = extractChapterContent();
        if (chapterData) {
            displayChapter(chapterData);
            state.currentChapter = chapterData;
            state.chapters.push(chapterData);
            updateSidebar();
            
            // 启动滚动监听
            setupAutoLoad();
        } else {
            alert('未检测到小说内容，请手动配置选择器');
            toggleSettingsPanel();
        }
    }

    function extractChapterContent() {
        let title = '';
        let content = '';
        
        // 尝试提取标题
        if (state.config.titleSelector) {
            const titleEl = $(state.config.titleSelector);
            if (titleEl) {
                title = titleEl.textContent.trim();
            }
        }
        
        // 自动探测标题
        if (!title) {
            const possibleTitles = $$('h1, h2, .title, #title, [class*="title"], [id*="title"]');
            for (const el of possibleTitles) {
                const text = el.textContent.trim();
                if (text.length > 5 && text.length < 100 && /第 [章回节]|番外|序言|终章/.test(text)) {
                    title = text;
                    break;
                }
            }
        }
        
        // 尝试提取正文
        if (state.config.contentSelector) {
            const contentEl = $(state.config.contentSelector);
            if (contentEl) {
                content = cleanContent(contentEl);
            }
        }
        
        // 自动探测正文
        if (!content) {
            content = autoDetectContent();
        }
        
        if (!content) {
            return null;
        }
        
        return {
            title: title || '未知章节',
            content: content,
            url: window.location.href
        };
    }

    function autoDetectContent() {
        // 寻找包含大量 p 或 br 标签的容器
        const containers = $$('div, article, section, main');
        let bestContainer = null;
        let maxScore = 0;
        
        for (const container of containers) {
            const pCount = $$('.content p, p', container).length;
            const brCount = $$('br', container).length;
            const textLength = container.textContent.trim().length;
            
            // 双重匹配：标签数量 + 文本长度
            if ((pCount >= 3 || brCount >= 3) && textLength > 500) {
                const score = pCount * 10 + brCount * 5 + textLength / 100;
                if (score > maxScore) {
                    maxScore = score;
                    bestContainer = container;
                }
            }
        }
        
        if (bestContainer) {
            return cleanContent(bestContainer);
        }
        
        return null;
    }

    function cleanContent(element) {
        const clone = element.cloneNode(true);
        
        // 移除广告和无关元素
        if (state.config.cleanSelectors) {
            const selectors = state.config.cleanSelectors.split('\n').filter(s => s.trim());
            selectors.forEach(selector => {
                $$(selector.trim(), clone).forEach(el => el.remove());
            });
        }
        
        // 默认清理规则
        $$('.ad, .ads, .advertisement, .banner, .popup, .share, .comment, script, style, iframe', clone).forEach(el => {
            el.remove();
        });
        
        // 应用替换规则
        let html = clone.innerHTML;
        if (state.config.replaceRules) {
            const rules = state.config.replaceRules.split('\n').filter(r => r.trim());
            rules.forEach(rule => {
                const parts = rule.split('|');
                if (parts.length >= 2) {
                    try {
                        const regex = new RegExp(parts[0].trim(), 'g');
                        html = html.replace(regex, parts[1].trim());
                    } catch (e) {
                        console.error('正则表达式错误:', parts[0], e);
                    }
                }
            });
        }
        
        // 默认替换规则
        html = html.replace(/本章字数.*?(?:字|字符)/g, '');
        html = html.replace(/(?:推荐|收藏|订阅|打赏|投票).{0,20}(?:按钮|链接)?/g, '');
        html = html.replace(/<br\s*\/?>/gi, '</p><p>');
        
        // 整理段落
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;
        
        // 确保每个段落都有正确的缩进
        const paragraphs = $$('p', tempDiv);
        paragraphs.forEach(p => {
            const text = p.textContent.trim();
            if (text) {
                p.textContent = '  ' + text;
            } else {
                p.remove();
            }
        });
        
        return tempDiv.innerHTML;
    }

    function displayChapter(chapterData) {
        const container = $('#novel-reader-chapter-container');
        if (!container) return;
        
        const chapterDiv = document.createElement('div');
        chapterDiv.className = 'novel-chapter';
        chapterDiv.style.marginBottom = '60px';
        
        const titleEl = document.createElement('h2');
        titleEl.textContent = chapterData.title;
        titleEl.style.cssText = `
            text-align: left;
            margin-bottom: 30px;
            font-size: 1.4em;
            font-weight: bold;
        `;
        
        const contentEl = document.createElement('div');
        contentEl.innerHTML = chapterData.content;
        contentEl.style.cssText = `
            text-align: left;
            text-indent: 2em;
        `;
        
        chapterDiv.appendChild(titleEl);
        chapterDiv.appendChild(contentEl);
        container.appendChild(chapterDiv);
    }

    function updateSidebar() {
        const sidebar = $('#novel-reader-sidebar');
        if (!sidebar) return;
        
        if (state.chapters.length > 1) {
            sidebar.style.display = 'block';
            sidebar.innerHTML = '<h4 style="margin-top: 0;">目录</h4>';
            
            state.chapters.forEach((chapter, index) => {
                const link = document.createElement('a');
                link.href = '#';
                link.textContent = chapter.title;
                link.style.cssText = `
                    display: block;
                    padding: 8px 5px;
                    color: ${getThemeColors().text};
                    text-decoration: none;
                    border-radius: 3px;
                    margin-bottom: 5px;
                    cursor: pointer;
                    ${index === state.chapters.length - 1 ? 'background: rgba(0,0,0,0.1);' : ''}
                `;
                
                link.addEventListener('click', (e) => {
                    e.preventDefault();
                    scrollToChapter(index);
                });
                
                sidebar.appendChild(link);
            });
        }
    }

    function scrollToChapter(index) {
        const chapters = $$('.novel-chapter', $('#novel-reader-chapter-container'));
        if (chapters[index]) {
            const contentArea = $('#novel-reader-content-area');
            contentArea.scrollTop = chapters[index].offsetTop - 40;
        }
    }

    // ==================== 自动加载 ====================
    
    function setupAutoLoad() {
        const contentArea = $('#novel-reader-content-area');
        if (!contentArea) return;
        
        contentArea.addEventListener('scroll', () => {
            const scrollTop = contentArea.scrollTop;
            const scrollHeight = contentArea.scrollHeight;
            const clientHeight = contentArea.clientHeight;
            
            // 距离底部 400px 时加载
            if (scrollHeight - scrollTop - clientHeight < 400 && !state.isLoading) {
                loadNextPage();
            }
        });
    }

    async function loadNextPage() {
        state.isLoading = true;
        
        // 查找下一页链接
        let nextUrl = null;
        
        if (state.config.nextLinkSelector) {
            const nextEl = $(state.config.nextLinkSelector);
            if (nextEl && nextEl.href) {
                nextUrl = nextEl.href;
            }
        }
        
        // 自动查找
        if (!nextUrl) {
            const keywords = state.config.nextKeywords.split(',').map(k => k.trim());
            const links = $$('a[href]');
            
            for (const link of links) {
                const text = link.textContent.trim();
                if (keywords.some(keyword => text.includes(keyword))) {
                    nextUrl = link.href;
                    break;
                }
            }
        }
        
        if (!nextUrl || nextUrl === window.location.href) {
            state.isLoading = false;
            return;
        }
        
        try {
            // 使用 GM_xmlhttpRequest 跨域请求
            const response = await new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: nextUrl,
                    onload: resolve,
                    onerror: reject
                });
            });
            
            if (response.status === 200) {
                const parser = new DOMParser();
                const doc = parser.parseFromString(response.responseText, 'text/html');
                
                // 提取下一章内容
                const chapterData = extractChapterFromDoc(doc, nextUrl);
                if (chapterData) {
                    displayChapter(chapterData);
                    state.chapters.push(chapterData);
                    updateSidebar();
                    
                    // 更新历史记录的链接
                    history.pushState({ url: nextUrl }, '', nextUrl);
                }
            }
        } catch (e) {
            console.error('加载下一页失败:', e);
        } finally {
            state.isLoading = false;
        }
    }

    function extractChapterFromDoc(doc, url) {
        let title = '';
        let content = '';
        
        // 尝试使用配置的选择器
        if (state.config.titleSelector) {
            const titleEl = doc.querySelector(state.config.titleSelector);
            if (titleEl) {
                title = titleEl.textContent.trim();
            }
        }
        
        if (state.config.contentSelector) {
            const contentEl = doc.querySelector(state.config.contentSelector);
            if (contentEl) {
                content = cleanContentFromDoc(contentEl);
            }
        }
        
        // 自动探测
        if (!content) {
            const containers = doc.querySelectorAll('div, article, section');
            let bestContainer = null;
            let maxScore = 0;
            
            for (const container of containers) {
                const pCount = container.querySelectorAll('p').length;
                const brCount = container.querySelectorAll('br').length;
                const textLength = container.textContent.trim().length;
                
                if ((pCount >= 3 || brCount >= 3) && textLength > 500) {
                    const score = pCount * 10 + brCount * 5 + textLength / 100;
                    if (score > maxScore) {
                        maxScore = score;
                        bestContainer = container;
                    }
                }
            }
            
            if (bestContainer) {
                content = cleanContentFromDoc(bestContainer);
            }
        }
        
        if (!content) {
            return null;
        }
        
        return {
            title: title || '未知章节',
            content: content,
            url: url
        };
    }

    function cleanContentFromDoc(element) {
        const clone = element.cloneNode(true);
        
        // 移除脚本和样式
        $$('script, style, iframe', clone).forEach(el => el.remove());
        
        // 应用清洗规则
        if (state.config.cleanSelectors) {
            const selectors = state.config.cleanSelectors.split('\n').filter(s => s.trim());
            selectors.forEach(selector => {
                clone.querySelectorAll(selector.trim()).forEach(el => el.remove());
            });
        }
        
        let html = clone.innerHTML;
        
        // 应用替换规则
        if (state.config.replaceRules) {
            const rules = state.config.replaceRules.split('\n').filter(r => r.trim());
            rules.forEach(rule => {
                const parts = rule.split('|');
                if (parts.length >= 2) {
                    try {
                        const regex = new RegExp(parts[0].trim(), 'g');
                        html = html.replace(regex, parts[1].trim());
                    } catch (e) {
                        console.error('正则表达式错误:', parts[0], e);
                    }
                }
            });
        }
        
        // 默认清理
        html = html.replace(/本章字数.*?(?:字|字符)/g, '');
        html = html.replace(/<br\s*\/?>/gi, '</p><p>');
        
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;
        
        const paragraphs = tempDiv.querySelectorAll('p');
        paragraphs.forEach(p => {
            const text = p.textContent.trim();
            if (text) {
                p.textContent = '  ' + text;
            } else {
                p.remove();
            }
        });
        
        return tempDiv.innerHTML;
    }

    // ==================== 初始化 ====================
    
    function init() {
        // 等待页面加载完成
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', createFloatButton);
        } else {
            createFloatButton();
        }
        
        // 监听后退/前进
        window.addEventListener('popstate', (e) => {
            if (state.isReadingMode && e.state && e.state.url) {
                // 可以添加返回上一章的逻辑
            }
        });
    }

    // 启动
    init();

})();
