// ==UserScript==
// @name         YouTube Smart Skip v4 (Experimental)
// @namespace    https://github.com/Vergota1417/ChatGPT-Project-Archive
// @version      4.0.0
// @description  Ad-aware skip, mute, speedup and player cancellation with playback restoration. No account spoofing.
// @author       Vergota1417 project
// @match        https://www.youtube.com/*
// @match        https://music.youtube.com/*
// @run-at       document-idle
// @grant        none
// @noframes
// @license      MIT
// @updateURL    https://raw.githubusercontent.com/Vergota1417/ChatGPT-Project-Archive/main/YouTube-Smart-Skip/YouTube_Smart_Skip_v4_0_Experimental.user.js
// @downloadURL  https://raw.githubusercontent.com/Vergota1417/ChatGPT-Project-Archive/main/YouTube-Smart-Skip/YouTube_Smart_Skip_v4_0_Experimental.user.js
// ==/UserScript==
(() => {
  'use strict';
  const VERSION = '4.0.0';
  if (window.__ytSmartSkip4) return;
  const CONFIG = Object.freeze({
    maxAdRate: 16, adPollMs: 450, idlePollMs: 1400,
    cancelRetryOnNewAdVideo: true,
    cosmeticAds: true, debug: false
  });
  const stats = { version: VERSION, adsDetected: 0, cancelAttempts: 0,
    skipClicks: 0, speedAttempts: 0, adSessionsEnded: 0, last: 'Ready', lastError: null };
  const skipSelectors = [
    'button.ytp-skip-ad-button', 'button.ytp-ad-skip-button-modern',
    'button.ytp-ad-skip-button', '.ytp-ad-skip-button-slot button',
    '.ytp-ad-skip-button-container button'
  ].join(',');
  let player = null, playerObserver = null, tick = null, session = null;
  let observerSchedule = 0;
  const verbose = (...args) => { if (CONFIG.debug) console.debug('[YT Skip 4]', ...args); };
  function setStatus(msg) { stats.last = msg; verbose(msg); }
  function schedule(ms) { clearTimeout(tick); tick = setTimeout(scan, ms); }
  function activeAd(p) { return !!p && (p.classList.contains('ad-interrupting') || p.classList.contains('ad-showing')); }
  function findVideo(p) { return p?.querySelector('video.html5-main-video') || p?.querySelector('video') || null; }
  function userRate(p, v) {
    try { const r = p.getPlaybackRate?.(); if (Number.isFinite(r) && r > 0 && r <= 16) return r; } catch (_) {}
    return v && Number.isFinite(v.playbackRate) && v.playbackRate > 0 ? v.playbackRate : 1;
  }
  function visibleButton(b) {
    if (!b?.isConnected || b.disabled || b.getAttribute('aria-disabled') === 'true') return false;
    if (b.getAttribute('aria-hidden') === 'true' || b.closest('[aria-hidden="true"]')) return false;
    if (!b.getClientRects().length) return false;
    const s = getComputedStyle(b);
    return s.display !== 'none' && s.visibility !== 'hidden' && s.pointerEvents !== 'none' && Number(s.opacity) !== 0;
  }
  function findSkipButton(p) {
    for (const button of p.querySelectorAll(skipSelectors)) if (visibleButton(button)) return button;
    return null;
  }
  function endSession() {
    if (!session) return;
    const s = session;
    session = null;
    if (s.video?.isConnected) {
      // Restore the player's playback setting rather than persisting ad speed.
      try { s.video.playbackRate = s.rate; } catch (_) {}
      try { s.video.muted = s.muted; } catch (_) {}
    }
    stats.adSessionsEnded++;
    setStatus('Watching for ads');
  }
  function beginSession(p) {
    const v = findVideo(p);
    session = { video: v, rate: userRate(p, v), muted: v?.muted ?? false,
      handledVideos: new WeakSet(), clickedButtons: new WeakSet(), speedVideo: null };
    stats.adsDetected++;
    setStatus('Ad detected');
  }
  function speedup(v, s) {
    if (!v || !v.isConnected) return;
    if (s.speedVideo === v) return;
    s.speedVideo = v;
    try { v.muted = true; } catch (e) { stats.lastError = String(e); }
    for (let rate = CONFIG.maxAdRate; rate >= 2; rate /= 2) {
      try { v.playbackRate = rate; stats.speedAttempts++; break; }
      catch (e) { stats.lastError = String(e); }
    }
  }
  function cancel(p, v, s) {
    if (!v || s.handledVideos.has(v) || v.paused || v.readyState < 2) return;
    if (typeof p.cancelPlayback !== 'function') return;
    s.handledVideos.add(v);
    stats.cancelAttempts++;
    try { p.cancelPlayback(); setStatus('Player cancellation attempted'); }
    catch (e) { stats.lastError = String(e); }
  }
  function handleAd(p) {
    if (!session) beginSession(p);
    const s = session;
    const v = findVideo(p);
    if (s.video !== v) {
      // YouTube can replace video elements while consecutive ads are playing.
      s.video = v;
      s.speedVideo = null;
    }
    speedup(v, s);
    cancel(p, v, s);
    const button = findSkipButton(p);
    if (button && !s.clickedButtons.has(button)) {
      s.clickedButtons.add(button);
      stats.skipClicks++;
      try { button.click(); setStatus('Skip button clicked'); }
      catch (e) { stats.lastError = String(e); }
    }
  }
  function connect(p) {
    if (p === player) return;
    playerObserver?.disconnect();
    if (session) endSession();
    player = p;
    if (!p) return;
    playerObserver = new MutationObserver(records => {
      // Coalesce bursts of YouTube DOM changes instead of repeatedly scanning.
      if (records.some(r => r.target === p || activeAd(p))) {
        if (!observerSchedule) {
          observerSchedule = setTimeout(() => { observerSchedule = 0; schedule(70); }, 110);
        }
      }
    });
    playerObserver.observe(p, { attributes: true, attributeFilter: ['class','style','aria-hidden','disabled'],
      childList: true, subtree: true });
  }
  function scan() {
    try {
      const p = document.querySelector('#movie_player');
      connect(p);
      if (!activeAd(p)) { endSession(); schedule(CONFIG.idlePollMs); return; }
      handleAd(p);
      schedule(CONFIG.adPollMs);
    } catch (e) { stats.lastError = String(e); schedule(CONFIG.idlePollMs); }
  }
  if (CONFIG.cosmeticAds) {
    const css = document.createElement('style');
    css.id = 'yt-smart-skip-v4-cosmetic';
    css.textContent = [
      'ytd-display-ad-renderer',
      'ytd-promoted-sparkles-web-renderer',
      'ytd-promoted-video-renderer',
      'ytd-ad-slot-renderer',
      'ytm-promoted-sparkles-web-renderer',
      '#masthead-ad',
      'ytd-in-feed-ad-layout-renderer'
    ].join(',') + '{display:none!important}';
    (document.head || document.documentElement).appendChild(css);
  }
  window.__ytSmartSkip4 = { version: VERSION,
    status: () => ({ ...stats, active: !!session }),
    scan, config: CONFIG };
  window.addEventListener('yt-navigate-finish', () => schedule(80));
  window.addEventListener('pagehide', endSession);
  console.info('[YT Skip 4] Experimental loaded. Diagnostics: window.__ytSmartSkip4.status()');
  schedule(100);
})();