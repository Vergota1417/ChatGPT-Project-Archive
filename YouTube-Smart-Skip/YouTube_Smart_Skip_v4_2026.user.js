// ==UserScript==
// @name         YouTube Smart Skip V4 (2026 Experimental)
// @namespace    https://github.com/Vergota1417/ChatGPT-Project-Archive
// @version      4.0.0
// @description  Ad-state-aware cancel, mute, speed and Skip fallback with minimal polling and diagnostics. Not YouTube Premium.
// @author       Vergota1417
// @match        https://www.youtube.com/*
// @run-at       document-idle
// @grant        none
// @license      MIT
// ==/UserScript==

(() => {
  'use strict';

  const VERSION = '4.0.0';
  const CONFIG = Object.freeze({
    idleMs: 1000,
    adMs: 300,
    mutationMs: 90,
    seekAfterMs: 900,
    maxSeekDuration: 180,
    enableCancel: true,
    enableMute: true,
    enableSpeed: true,
    enableSeek: true,
    enableShorts: true,
    showStatus: true,
    debug: false
  });
  const SKIP_SELECTORS = [
    'button.ytp-skip-ad-button',
    'button.ytp-ad-skip-button-modern',
    'button.ytp-ad-skip-button',
    '.ytp-ad-skip-button-slot button',
    '.ytp-ad-skip-button-container button'
  ].join(',');

  if (window.__ytSmartSkipV4?.version === VERSION) return;
  const state = {
    version: VERSION, adsDetected: 0, cancelAttempts: 0,
    skipClickAttempts: 0, seekAttempts: 0, speedChanges: 0,
    shortsAdvances: 0, adEndsAfterIntervention: 0,
    status: 'Watching', lastError: null
  };
  let ad = null;
  let observer = null;
  let observedRoot = null;
  let timer = null;
  let nextDue = Infinity;
  let stopped = false;
  let badge = null;
  const listeners = new AbortController();

  function trace(...args) {
    if (CONFIG.debug) console.debug('[YT Smart Skip v4]', ...args);
  }
  function setStatus(message) {
    if (state.status === message) return;
    state.status = message;
    trace(message);
    if (!CONFIG.showStatus || !document.body) return;
    if (!badge?.isConnected) {
      badge = document.createElement('div');
      badge.id = 'yt-smart-skip-v4-status';
      badge.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:2147483647;pointer-events:none;background:rgba(20,20,20,.85);color:#fff;padding:6px 9px;border-radius:7px;font:11px system-ui,sans-serif';
      document.body.appendChild(badge);
    }
    badge.textContent = 'YT Skip v4 · ' + message;
    badge.style.display = ad ? 'block' : 'none';
  }
  // Keep the earliest scheduled scan: frequent mutations must not postpone work.
  function schedule(delay) {
    if (stopped) return;
    const due = performance.now() + delay;
    if (timer !== null && nextDue <= due) return;
    if (timer !== null) clearTimeout(timer);
    nextDue = due;
    timer = setTimeout(() => {
      timer = null;
      nextDue = Infinity;
      scan();
    }, delay);
  }
  function watch(root) {
    if (observedRoot === root) return;
    observer?.disconnect();
    observedRoot = root;
    if (!root) return;
    observer = new MutationObserver(() => schedule(CONFIG.mutationMs));
    observer.observe(root, {
      subtree: true, childList: true, attributes: true,
      attributeFilter: ['class', 'style', 'aria-hidden', 'disabled', 'aria-disabled']
    });
  }
  function current() {
    const movie = document.querySelector('#movie_player');
    const shorts = document.querySelector('#shorts-player');
    if (movie?.classList.contains('ad-interrupting') || movie?.classList.contains('ad-showing')) {
      return { mode: 'watch', root: movie, video: movie.querySelector('video.html5-main-video, video') };
    }
    if (CONFIG.enableShorts && shorts?.classList.contains('ad-created')) {
      return { mode: 'shorts', root: shorts, video: shorts.querySelector('video') };
    }
    return { mode: null, root: movie || shorts, video: null };
  }
  function readMedia(video) {
    if (!video) return null;
    return { video, rate: video.playbackRate, muted: video.muted };
  }
  function begin(info) {
    ad = {
      mode: info.mode, root: info.root, video: info.video,
      source: info.video?.currentSrc || '', started: performance.now(),
      media: readMedia(info.video), cancelTried: false,
      seekTried: false, skipClicked: new WeakSet(), clicks: 0,
      shortsTried: false, intervention: false, resumeAfterCancel: false
    };
    state.adsDetected++;
    setStatus('Ad detected');
  }
  function restoreMedia(session) {
    const media = session?.media;
    if (!media?.video?.isConnected) return;
    try { media.video.muted = media.muted; } catch {}
    try { media.video.playbackRate = media.rate; } catch {}
  }
  function end() {
    if (!ad) return;
    const previous = ad;
    ad = null;
    restoreMedia(previous);
    if (previous.intervention) state.adEndsAfterIntervention++;
    // cancelPlayback can leave the main video paused; resume only when
    // it was playing before our call, and only when the ad has ended.
    if (previous.resumeAfterCancel && previous.mode === 'watch' &&
        previous.root?.isConnected && previous.video?.paused &&
        !previous.video?.ended && typeof previous.root.playVideo === 'function') {
      try { previous.root.playVideo(); } catch (err) { state.lastError = String(err); }
    }
    setStatus('Watching');
  }
  function available(btn) {
    if (!btn || !btn.isConnected || btn.disabled ||
        btn.getAttribute('disabled') !== null ||
        btn.getAttribute('aria-hidden') === 'true' ||
        btn.getAttribute('aria-disabled') === 'true' ||
        btn.closest('[aria-hidden="true"]')) return false;
    if (!btn.getClientRects().length) return false;
    const style = getComputedStyle(btn);
    return style.visibility !== 'hidden' && style.display !== 'none' &&
      style.pointerEvents !== 'none' && parseFloat(style.opacity || '1') > 0;
  }
  function findSkip(root) {
    for (const button of root.querySelectorAll(SKIP_SELECTORS)) {
      if (available(button)) return button;
    }
    // Conservative fallback to avoid clicking preview or countdown buttons.
    for (const button of root.querySelectorAll('.video-ads button, .ytp-ad-player-overlay-layout button')) {
      const label = (button.getAttribute('aria-label') || button.textContent || '').trim().toLowerCase();
      if (/^skip(?: ads?| advertisement)?$/.test(label) && available(button)) return button;
    }
    return null;
  }
  function changeAdMedia() {
    const video = ad?.video;
    if (!video) return;
    try {
      if (CONFIG.enableMute && !video.muted) { video.muted = true; ad.intervention = true; }
      if (CONFIG.enableSpeed && video.playbackRate < 2) {
        for (const speed of [16, 8, 4, 2]) {
          try {
            video.playbackRate = speed;
            if (video.playbackRate > 1) {
              state.speedChanges++;
              ad.intervention = true;
              break;
            }
          } catch {}
        }
      }
    } catch (err) { state.lastError = String(err); }
  }
  function tryCancel() {
    if (!ad || ad.cancelTried) return;
    ad.cancelTried = true;
    if (!CONFIG.enableCancel) return;
    const root = ad.root;
    // YouTube exposes this function on some player builds. It can disappear.
    const method = Object.getOwnPropertyDescriptor(root, 'cancelPlayback')?.value || root.cancelPlayback;
    if (typeof method !== 'function') return;
    try {
      ad.resumeAfterCancel = Boolean(ad.video && !ad.video.paused);
      ad.intervention = true;
      state.cancelAttempts++;
      method.call(root);
      setStatus('Trying player cancellation');
    } catch (err) { state.lastError = String(err); }
  }
  function tryClick(button) {
    if (!ad || !button || ad.clicks >= 2 || ad.skipClicked.has(button)) return;
    ad.skipClicked.add(button);
    ad.clicks++;
    state.skipClickAttempts++;
    ad.intervention = true;
    try { button.click(); setStatus('Skip clicked · checking result'); }
    catch (err) { state.lastError = String(err); }
  }
  function trySeek(button) {
    if (!ad || !CONFIG.enableSeek || ad.seekTried || !button ||
        performance.now() - ad.started < CONFIG.seekAfterMs) return;
    ad.seekTried = true;
    const video = ad.video;
    if (!video || !video.isConnected || !available(button) || !ad.root.contains(button)) return;
    try {
      const duration = video.duration;
      if (!Number.isFinite(duration) || duration < 1 || duration > CONFIG.maxSeekDuration) return;
      if (video.currentTime < duration - 0.2) {
        video.currentTime = duration - 0.1;
        state.seekAttempts++;
        ad.intervention = true;
        setStatus('Skip unresponsive · seeking ad end');
      }
    } catch (err) { state.lastError = String(err); }
  }
  function handleShorts() {
    if (!ad || ad.shortsTried) return;
    const video = ad.video;
    if (!video || video.paused || video.readyState < 2) return;
    const down = document.querySelector('#navigation-button-down button');
    if (available(down)) {
      ad.shortsTried = true;
      try {
        down.click();
        state.shortsAdvances++;
        ad.intervention = true;
        setStatus('Shorts ad · advancing');
      } catch (err) { state.lastError = String(err); }
    }
  }
  function scan() {
    if (stopped) return;
    const info = current();
    watch(info.root);
    if (!info.mode) {
      end();
      schedule(CONFIG.idleMs);
      return;
    }
    if (ad && (ad.mode !== info.mode || ad.root !== info.root ||
        (info.video && ad.video !== info.video) ||
        (ad.source && info.video?.currentSrc && ad.source !== info.video.currentSrc))) end();
    if (!ad) begin(info);
    changeAdMedia();
    if (info.mode === 'watch') {
      tryCancel();
      // Cancellation might synchronously end the ad.
      if (ad && current().mode === 'watch') {
        const button = findSkip(info.root);
        if (button) {
          tryClick(button);
          trySeek(button);
        } else setStatus('Ad active · waiting for Skip');
      }
    } else {
      handleShorts();
      if (!ad?.shortsTried) setStatus('Shorts ad · watching');
    }
    schedule(CONFIG.adMs);
  }
  function stop() {
    stopped = true;
    if (timer !== null) clearTimeout(timer);
    observer?.disconnect();
    listeners.abort();
    end();
    badge?.remove();
  }
  window.__ytSmartSkipV4 = {
    version: VERSION,
    state: () => ({ ...state, adActive: Boolean(ad), mode: ad?.mode || null }),
    config: CONFIG,
    scan: () => scan(),
    stop
  };
  window.addEventListener('yt-navigate-start', () => schedule(80), { signal: listeners.signal });
  window.addEventListener('yt-navigate-finish', () => schedule(80), { signal: listeners.signal });
  console.info('[YT Smart Skip v4.0.0] Running. Experimental; no Premium entitlement or guaranteed ad blocking.');
  schedule(100);
})();