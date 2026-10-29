// ==UserScript==
// @name         YouTube Smart Skip Watcher
// @namespace    https://tampermonkey.net/
// @version      2.1.0
// @description  Automatically clicks YouTube's visible Skip Ad button; includes status and diagnostics.
// @match        https://www.youtube.com/*
// @match        https://m.youtube.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';
  if (window.__ytSmartSkipV21) return;
  const VERSION = '2.1.0';
  const PREFIX = '[YT Smart Skip]';
  const SELECTORS = [
    'button.ytp-skip-ad-button',
    'button.ytp-ad-skip-button-modern',
    'button.ytp-ad-skip-button',
    '.ytp-ad-skip-button-slot button',
    '.ytp-ad-skip-button-container button',
    '.ytp-skip-ad button',
    '.ytp-ad-player-overlay-layout__skip-or-preview-container button',
    '.videoAdUiSkipButton',
    '[class*="skip-ad"] button',
    'button[aria-label*="Skip"]',
    'button[aria-label*="skip"]',
    '[role="button"][aria-label*="Skip"]'
  ];
  const state = {
    version: VERSION, running: true, adActive: false,
    scans: 0, attempts: 0, clicks: 0, confirmed: 0,
    lastStatus: 'Starting', lastSelector: '', lastError: ''
  };
  const attempted = new WeakMap();
  let lastAdSeen = 0;
  let pending = false;
  let badge = null;
  let badgeText = null;
  let badgeDetail = null;
  const norm = value => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const player = () => document.querySelector('#movie_player, .html5-video-player');
  const isAd = () => {
    const p = player();
    return Boolean(p && (p.classList.contains('ad-showing') || p.classList.contains('ad-interrupting') ||
      p.querySelector('.ytp-ad-player-overlay-layout:not([hidden]), .ytp-skip-ad:not([hidden]), .ytp-ad-skip-button-container:not([hidden])')));
  };
  function visible(el) {
    if (!(el instanceof Element) || !el.isConnected) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0 &&
      !el.disabled && el.getAttribute('aria-disabled') !== 'true';
  }
  function status(message, detail = '') {
    if (message !== state.lastStatus) console.info(PREFIX, message, detail);
    state.lastStatus = message;
    if (!document.body) return;
    if (!badge?.isConnected) {
      badge = document.createElement('div');
      badge.id = 'yt-smart-skip-status-v21';
      badge.style.cssText = 'position:fixed;top:12px;right:12px;z-index:2147483647;background:rgba(18,18,18,.88);color:#fff;padding:8px 12px;border-radius:9px;font:12px/1.5 system-ui,sans-serif;pointer-events:none;max-width:300px;box-shadow:0 3px 14px #0007';
      const heading = document.createElement('strong');
      heading.textContent = 'YT Smart Skip v' + VERSION;
      badgeText = document.createElement('div');
      badgeDetail = document.createElement('div');
      badgeDetail.style.cssText = 'opacity:.7;font-size:11px';
      badge.append(heading, badgeText, badgeDetail);
      document.body.append(badge);
    }
    badgeText.textContent = message;
    badgeDetail.textContent = detail;
  }
  function candidates() {
    const p = player();
    if (!p) return [];
    const roots = [p];
    // Some YouTube layouts attach the ad overlay elsewhere in the document.
    document.querySelectorAll('.video-ads, .ytp-ad-player-overlay-layout, .ytp-skip-ad').forEach(r => {
      if (!roots.includes(r)) roots.push(r);
    });
    const found = new Map();
    function consider(element, source) {
      const button = element?.matches?.('button,[role="button"]') ? element : element?.closest?.('button,[role="button"]');
      if (!button || found.has(button) || !visible(button)) return;
      const label = norm([button.innerText, button.textContent, button.getAttribute('aria-label'), button.title].join(' '));
      const cls = norm(button.className);
      const structural = /ytp-skip-ad-button|ytp-ad-skip-button|videoaduiskipbutton/.test(cls) ||
        button.closest('.ytp-skip-ad, .ytp-ad-skip-button-slot, .ytp-ad-skip-button-container');
      const skipText = /^(skip|skip ad|skip ads|skip advertisement|skip advertisements)(\s*[›»→]*)?$/.test(label) ||
        /^(skip|skip ad|skip ads|skip advertisement)/.test(norm(button.getAttribute('aria-label')));
      // Never click previews/countdowns such as "Skip in 5 seconds".
      if (!structural && !skipText) return;
      if (/skip\s+(ad\s+)?(in|after)\s+\d/i.test(label)) return;
      found.set(button, { button, source, score: (structural ? 100 : 0) + (skipText ? 50 : 0) });
    }
    for (const root of roots) {
      for (const selector of SELECTORS) {
        try { root.querySelectorAll(selector).forEach(el => consider(el, selector)); } catch (_) {}
      }
      root.querySelectorAll('button,[role="button"]').forEach(el => {
        const a = norm(el.getAttribute('aria-label'));
        const t = norm(el.textContent);
        if (a.startsWith('skip') || /^skip(\s+ads?)?$/.test(t)) consider(el, 'text/aria fallback');
      });
    }
    return [...found.values()].sort((a, b) => b.score - a.score);
  }
  function scan() {
    try {
      state.scans++;
      const ad = isAd();
      const options = candidates();
      const now = Date.now();
      state.adActive = ad;
      if (ad) lastAdSeen = now;
      if (options.length) {
        const { button, source } = options[0];
        const previous = attempted.get(button) || 0;
        if (now - previous >= 1500) {
          attempted.set(button, now);
          state.lastSelector = source;
          state.attempts++;
          status('Skip found — clicking', source);
          button.click();
          state.clicks++;
          setTimeout(() => {
            if (!button.isConnected || !visible(button) || !isAd()) {
              // This is an indicator, not proof that the ad was skipped.
              state.confirmed++;
              status('Skip button cleared', 'Ad outcome may vary');
            } else {
              status('Button still visible', 'Will retry if available');
            }
          }, 450);
        }
      } else if (ad) {
        status('Ad detected — waiting for Skip', 'Unskippable ads cannot be skipped');
      } else if (now - lastAdSeen > 1100) {
        status('Watching for Skip', 'Script active');
      }
      state.lastError = '';
    } catch (error) {
      state.lastError = String(error);
      console.error(PREFIX, error);
      status('Scanner error', state.lastError);
    }
  }
  function requestScan() {
    if (pending) return;
    pending = true;
    setTimeout(() => { pending = false; scan(); }, 50);
  }
  const observer = new MutationObserver(changes => {
    if (changes.some(m => {
      const el = m.target instanceof Element ? m.target : m.target.parentElement;
      if (el?.closest?.('#yt-smart-skip-status-v21')) return false;
      return el?.closest?.('#movie_player, .html5-video-player, .video-ads, .ytp-skip-ad, .ytp-ad-player-overlay-layout') ||
        [...m.addedNodes].some(n => n.nodeType === 1 && n.matches?.('#movie_player, .html5-video-player, .video-ads, .ytp-skip-ad'));
    })) requestScan();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true,
    attributeFilter: ['class', 'style', 'hidden', 'aria-label', 'disabled'] });
  const interval = setInterval(scan, 400);
  for (const event of ['yt-navigate-finish', 'yt-page-data-updated']) window.addEventListener(event, requestScan);
  window.__ytSmartSkipV21 = {
    state: () => ({ ...state, candidates: candidates().length }),
    candidates: () => candidates().map(({ button, source, score }) => ({ source, score, text: button.textContent?.trim(), className: button.className })),
    scan,
    stop: () => { clearInterval(interval); observer.disconnect(); state.running = false; badge?.remove(); }
  };
  console.info(PREFIX, 'v' + VERSION, 'loaded. Diagnostics: __ytSmartSkipV21.state()');
  scan();
})();