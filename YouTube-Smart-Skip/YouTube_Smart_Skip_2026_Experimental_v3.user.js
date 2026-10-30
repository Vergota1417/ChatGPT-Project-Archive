// ==UserScript==
// @name         YouTube Smart Skip (2026 Experimental)
// @namespace    https://github.com/Vergota1417/ChatGPT-Project-Archive
// @version      3.0.0
// @description  Low-overhead, ad-state-aware Skip watcher with guarded video-end fallback and diagnostics.
// @match        https://www.youtube.com/*
// @run-at       document-idle
// @grant        none
// @license      MIT
// ==/UserScript==

(() => {
    'use strict';

    const VERSION = '3.0.0';
    const CONFIG = Object.freeze({
        IDLE_SCAN_MS: 1200,
        AD_SCAN_MS: 350,
        MUTATION_DELAY_MS: 120,
        CLICK_VERIFY_MS: 500,
        MAX_SEEK_DURATION_SEC: 120,
        ENABLE_SEEK_FALLBACK: true,
        ENABLE_SPEED_FALLBACK: true,
        DEBUG: false
    });
    const BUTTON_SELECTOR = [
        'button.ytp-skip-ad-button',
        'button.ytp-ad-skip-button-modern',
        'button.ytp-ad-skip-button',
        '.ytp-ad-skip-button-slot button',
        '.ytp-ad-skip-button-container button'
    ].join(',');

    // Prevent duplicate copies of THIS version in one tab.
    if (window.__ytSmartSkip2026?.version === VERSION) return;

    const state = {
        version: VERSION,
        active: false,
        adsSeen: 0,
        clicksSent: 0,
        fallbackSeeks: 0,
        fallbackSpeedups: 0,
        adsClearedAfterAction: 0,
        lastStatus: 'Ready',
        lastError: null
    };
    let player = null;
    let playerObserver = null;
    let timer = null;
    let ad = null;
    let generation = 0;
    let badge = null;

    function debug(...args) {
        if (CONFIG.DEBUG) console.debug('[YT Smart Skip 2026]', ...args);
    }

    function status(text) {
        if (state.lastStatus === text) return;
        state.lastStatus = text;
        if (!document.body) return;
        if (!badge?.isConnected) {
            badge = document.createElement('div');
            badge.id = 'yt-smart-skip-2026-status';
            badge.style.cssText = [
                'position:fixed', 'bottom:12px', 'right:12px',
                'z-index:2147483647', 'pointer-events:none',
                'background:rgba(20,20,20,.84)', 'color:white',
                'padding:5px 9px', 'border-radius:7px',
                'font:11px system-ui,sans-serif', 'max-width:240px'
            ].join(';');
            document.body.appendChild(badge);
        }
        badge.textContent = 'YT Smart Skip 3.0 · ' + text;
        badge.style.display = state.active ? 'block' : 'none';
        debug(text);
    }

    function schedule(delay) {
        clearTimeout(timer);
        timer = setTimeout(scan, delay);
    }

    function getPlayer() {
        return document.querySelector('#movie_player');
    }

    function isAdPlaying(p) {
        return Boolean(p && (
            p.classList.contains('ad-interrupting') ||
            p.classList.contains('ad-showing')
        ));
    }

    function available(button) {
        if (!button || !button.isConnected || button.disabled) return false;
        if (button.getAttribute('aria-disabled') === 'true' ||
            button.closest('[aria-hidden="true"]')) return false;
        if (!button.getClientRects().length) return false;
        const css = getComputedStyle(button);
        return css.display !== 'none' && css.visibility !== 'hidden' &&
            css.pointerEvents !== 'none' && Number(css.opacity) !== 0;
    }

    function findButton(p) {
        for (const button of p.querySelectorAll(BUTTON_SELECTOR)) {
            if (available(button)) return button;
        }
        // Conservative fallback for newly renamed buttons, inside ad UI only.
        for (const button of p.querySelectorAll('.video-ads button, .ytp-ad-player-overlay-layout button')) {
            const aria = (button.getAttribute('aria-label') || '').trim().toLowerCase();
            const label = (button.textContent || '').trim().toLowerCase();
            if (/^skip(?: ads?| advertisement)?$/.test(aria) ||
                /^skip(?: ads?| advertisement)?$/.test(label)) {
                if (available(button)) return button;
            }
        }
        return null;
    }

    function connectPlayer(nextPlayer) {
        if (nextPlayer === player && playerObserver) return;
        playerObserver?.disconnect();
        player = nextPlayer;
        if (!player) return;
        playerObserver = new MutationObserver(() => schedule(CONFIG.MUTATION_DELAY_MS));
        playerObserver.observe(player, {
            subtree: true, childList: true, attributes: true,
            attributeFilter: ['class', 'style', 'disabled', 'aria-disabled', 'aria-hidden']
        });
    }

    function restoreMedia() {
        if (!ad?.modifiedVideo) return;
        const { video, rate, muted } = ad.modifiedVideo;
        try { if (video.isConnected) video.playbackRate = rate; } catch {}
        try { if (video.isConnected) video.muted = muted; } catch {}
        ad.modifiedVideo = null;
    }

    function onAdEnd() {
        if (!ad) return;
        restoreMedia();
        if (ad.attempted) state.adsClearedAfterAction++;
        ad = null;
        state.active = false;
        status('Watching');
    }

    function startAd() {
        generation++;
        ad = { id: generation, attempted: false, fallbackTried: false, modifiedVideo: null };
        state.active = true;
        state.adsSeen++;
        status('Ad detected');
    }

    function guardedFallback(button, adId) {
        if (!ad || ad.id !== adId || !isAdPlaying(player) ||
            !available(button) || !player.contains(button) || ad.fallbackTried) return;

        ad.fallbackTried = true;
        const video = player.querySelector('video.html5-main-video') || player.querySelector('video');
        if (!video) { status('Skip click ignored · no ad video'); return; }

        const duration = video.duration;
        if (CONFIG.ENABLE_SEEK_FALLBACK && Number.isFinite(duration) &&
            duration > 1 && duration <= CONFIG.MAX_SEEK_DURATION_SEC) {
            try {
                const target = Math.max(0, duration - 0.1);
                if (video.currentTime < target) {
                    video.currentTime = target;
                    state.fallbackSeeks++;
                    status('Skip ignored · tried ad-end seek');
                    return;
                }
            } catch (error) { state.lastError = String(error); }
        }

        if (CONFIG.ENABLE_SPEED_FALLBACK) {
            try {
                ad.modifiedVideo = {
                    video, rate: video.playbackRate, muted: video.muted
                };
                video.muted = true;
                video.playbackRate = 16;
                state.fallbackSpeedups++;
                status('Skip ignored · speeding up ad');
                return;
            } catch (error) { state.lastError = String(error); }
        }
        status('Skip ignored · no safe fallback');
    }

    function scan() {
        connectPlayer(getPlayer());
        if (!player || !isAdPlaying(player)) {
            onAdEnd();
            schedule(CONFIG.IDLE_SCAN_MS);
            return;
        }

        if (!ad) startAd();
        if (!ad.attempted) {
            const button = findButton(player);
            if (button) {
                const id = ad.id;
                ad.attempted = true;
                state.clicksSent++;
                status('Skip available · clicking once');
                try { button.click(); }
                catch (error) { state.lastError = String(error); }
                setTimeout(() => guardedFallback(button, id), CONFIG.CLICK_VERIFY_MS);
            } else {
                status('Ad detected · waiting for Skip');
            }
        }
        schedule(CONFIG.AD_SCAN_MS);
    }

    window.__ytSmartSkip2026 = {
        version: VERSION,
        state: () => ({ ...state, adSession: ad ? {
            attempted: ad.attempted, fallbackTried: ad.fallbackTried
        } : null }),
        scan,
        config: CONFIG
    };

    window.addEventListener('yt-navigate-finish', () => schedule(100));
    window.addEventListener('yt-navigate-start', () => schedule(100));
    console.info('[YT Smart Skip 2026] v' + VERSION + ' loaded; experimental, no live guarantee');
    schedule(100);
})();