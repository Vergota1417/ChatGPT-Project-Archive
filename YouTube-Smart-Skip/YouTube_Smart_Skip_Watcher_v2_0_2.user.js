// ==UserScript==
// @name         YouTube Smart Skip Watcher
// @namespace    https://tampermonkey.net/
// @version      2.0.2
// @description  Original watcher, with lower-overhead scanning, fewer retries, and verified ad-end results.
// @author       You
// @match        https://www.youtube.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
    'use strict';

    // ============================================================
    // CONFIGURATION
    // ============================================================

    const VERSION = '2.0.2';

    // Scan slowly when nothing is happening.
    const IDLE_SCAN_MS = 1500;

    // Once an ad is detected, scan much faster.
    const AD_SCAN_MS = 400;

    // MutationObserver reaction time.
    const MUTATION_DELAY_MS = 250;

    // Don't hammer the same ad with clicks.
    const CLICK_COOLDOWN_MS = 2400;

    // Maximum automatic click attempts for one ad.
    const MAX_ATTEMPTS_PER_AD = 2;

    // How long to watch for YouTube to react after clicking.
    const VERIFY_TIMEOUT_MS = 1600;

    // If YouTube ignores synthetic clicks, advance the AD VIDEO only after
    // its real, enabled Skip button is visible. Does not affect unskippable ads.
    const SEEK_FALLBACK_ENABLED = true;
    const SEEK_FALLBACK_DELAY_MS = 350;

    const VERBOSE = false;


    // ============================================================
    // KNOWN SKIP BUTTON STRUCTURES
    // ============================================================

    /*
       Highest-confidence selectors first.

       IMPORTANT:

       Your current HTML is:

       <div class="ytp-skip-ad">
           <button class="ytp-skip-ad-button">
               <div class="ytp-skip-ad-button__text">Skip</div>
               <span class="ytp-skip-ad-button__icon">...</span>
           </button>
       </div>

       So button.ytp-skip-ad-button is priority #1.
    */

    const EXACT_SKIP_SELECTORS = [

        // --------------------------------------------------------
        // CURRENT STRUCTURE YOU CAPTURED
        // --------------------------------------------------------

        'button.ytp-skip-ad-button',

        '.ytp-skip-ad > button',

        '.ytp-skip-ad button.ytp-skip-ad-button',

        '.ytp-ad-player-overlay-layout__skip-or-preview-container button.ytp-skip-ad-button',


        // --------------------------------------------------------
        // OTHER / OLDER YOUTUBE STRUCTURES
        // --------------------------------------------------------

        'button.ytp-ad-skip-button-modern',

        '.ytp-ad-skip-button-modern',

        'button.ytp-ad-skip-button',

        '.ytp-ad-skip-button',

        '.ytp-ad-skip-button-slot button',

        '.ytp-ad-skip-button-container button',

        '.videoAdUiSkipButton',


        // --------------------------------------------------------
        // ACCESSIBILITY / ARIA FALLBACK
        // --------------------------------------------------------

        'button[aria-label^="Skip ad"]',

        'button[aria-label^="Skip Ad"]',

        'button[aria-label="Skip"]'
    ];


    // ============================================================
    // CHILD ELEMENTS THAT MAY IDENTIFY THE BUTTON
    // ============================================================

    /*
       These are NOT clicked directly.

       We find them and then walk UP to their parent <button>.
    */

    const SKIP_CHILD_HINTS = [

        '.ytp-skip-ad-button__text',

        '.ytp-skip-ad-button__icon',

        '.ytp-ad-skip-button__text',

        '.ytp-ad-skip-button-text',

        '[class*="skip-ad-button__text"]',

        '[class*="skip-ad-button__icon"]'
    ];


    // ============================================================
    // STATE
    // ============================================================

    const state = {

        adActive: false,

        adStartedAt: 0,

        attemptsThisAd: 0,

        lastAttemptAt: 0,

        actionInFlight: false,

        scans: 0,

        adsDetected: 0,

        buttonsFound: 0,

        clicksSent: 0,

        confirmed: 0,

        failed: 0,

        lastSelector: null,

        lastButton: null,

        lastStatus: 'Starting',

        lastSource: null
    };


    let scanTimer = null;
    let mutationTimer = null;
    let observer = null;
    let observedTarget = null;
    let lastMutationAt = 0;

    let badge = null;
    let badgeStatus = null;
    let badgeDetails = null;


    // ============================================================
    // UTILITIES
    // ============================================================

    function log(...args) {

        if (!VERBOSE) return;

        console.log(
            `[YT Smart Skip v${VERSION}]`,
            ...args
        );
    }


    function sleep(ms) {

        return new Promise(resolve => setTimeout(resolve, ms));
    }


    function normalize(value) {

        return String(value || '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }


    function getPlayer() {

        return (
            document.querySelector('#movie_player') ||
            document.querySelector('.html5-video-player')
        );
    }


    function getAdRoot() {

        const player = getPlayer();

        if (!player) return null;

        return (
            player.querySelector('.video-ads.ytp-ad-module') ||
            player.querySelector('.video-ads')
        );
    }


    // ============================================================
    // VISIBILITY CHECK
    // ============================================================

    function isVisible(element) {

        if (!(element instanceof Element)) {
            return false;
        }

        if (!element.isConnected) {
            return false;
        }

        const rect = element.getBoundingClientRect();

        if (
            rect.width <= 0 ||
            rect.height <= 0
        ) {
            return false;
        }

        const style = getComputedStyle(element);

        if (style.display === 'none') {
            return false;
        }

        if (style.visibility === 'hidden') {
            return false;
        }

        if (parseFloat(style.opacity || '1') <= 0) {
            return false;
        }

        return true;
    }


    // ============================================================
    // DETECT WHETHER AN AD IS ACTIVE
    // ============================================================

    function isAdActive() {

        const player = getPlayer();

        if (!player) {
            return false;
        }

        // Strong YouTube player states.
        if (
            player.classList.contains('ad-showing') ||
            player.classList.contains('ad-interrupting')
        ) {
            return true;
        }

        const adRoot = getAdRoot();

        if (!adRoot) {
            return false;
        }

        // New ad layout.
        const overlay =
            adRoot.querySelector(
                '.ytp-ad-player-overlay-layout'
            );

        if (overlay && isVisible(overlay)) {
            return true;
        }


        // Ad information block.
        const info =
            adRoot.querySelector(
                '.ytp-ad-player-overlay-layout__ad-info-container'
            );

        if (info && isVisible(info)) {
            return true;
        }


        // Current Skip wrapper.
        const skipContainer =
            adRoot.querySelector('.ytp-skip-ad');

        if (skipContainer && isVisible(skipContainer)) {
            return true;
        }


        // Advertisement badge.
        const badge =
            adRoot.querySelector(
                '[class*="ytp-ad-badge"]'
            );

        if (badge && isVisible(badge)) {
            return true;
        }


        return false;
    }


    // ============================================================
    // ENSURE WE GET THE ACTUAL BUTTON
    // ============================================================

    function resolveActualButton(element) {

        if (!(element instanceof Element)) {
            return null;
        }

        if (element.tagName === 'BUTTON') {
            return element;
        }

        return (
            element.closest('button') ||
            element.closest('[role="button"]')
        );
    }


    // ============================================================
    // VERIFY THIS REALLY LOOKS LIKE SKIP
    // ============================================================

    function looksLikeSkipButton(button) {

        if (!(button instanceof Element)) {
            return false;
        }


        // Must exist inside the actual YouTube ad/player area.
        const adArea = button.closest(
            '.video-ads, ' +
            '.ytp-ad-module, ' +
            '.ytp-ad-player-overlay-layout, ' +
            '.ytp-skip-ad'
        );

        if (!adArea) {
            return false;
        }


        const className =
            normalize(button.className);

        const id =
            normalize(button.id);

        const aria =
            normalize(
                button.getAttribute('aria-label')
            );

        const title =
            normalize(
                button.getAttribute('title')
            );

        const text =
            normalize(
                button.innerText ||
                button.textContent
            );


        // Strong structural signals.
        const structuralMatch = (

            className.includes('ytp-skip-ad-button') ||

            className.includes('ytp-ad-skip-button') ||

            className.includes('skip-ad-button') ||

            className.includes('ad-skip-button') ||

            id.includes('skip-button')
        );


        // Textual fallback.
        const textualMatch = (

            text === 'skip' ||

            text === 'skip ad' ||

            text === 'skip ads' ||

            aria.startsWith('skip') ||

            title.startsWith('skip')
        );


        return structuralMatch || textualMatch;
    }


    // ============================================================
    // SCORE CANDIDATES
    // ============================================================

    function scoreCandidate(button) {

        let score = 0;

        const cls =
            normalize(button.className);

        const id =
            normalize(button.id);

        const text =
            normalize(
                button.innerText ||
                button.textContent
            );

        const aria =
            normalize(
                button.getAttribute('aria-label')
            );


        // Current button from YOUR HTML.
        if (
            button.matches(
                'button.ytp-skip-ad-button'
            )
        ) {
            score += 1000;
        }


        if (
            button.closest(
                '.ytp-skip-ad'
            )
        ) {
            score += 500;
        }


        if (
            cls.includes(
                'ytp-skip-ad-button'
            )
        ) {
            score += 400;
        }


        if (
            cls.includes(
                'ytp-ad-skip-button-modern'
            )
        ) {
            score += 350;
        }


        if (
            cls.includes(
                'ytp-ad-skip-button'
            )
        ) {
            score += 300;
        }


        if (
            id.includes(
                'skip-button'
            )
        ) {
            score += 250;
        }


        if (
            text === 'skip' ||
            text === 'skip ad'
        ) {
            score += 200;
        }


        if (
            aria.startsWith('skip')
        ) {
            score += 150;
        }


        if (
            button.tagName === 'BUTTON'
        ) {
            score += 50;
        }


        return score;
    }


    // ============================================================
    // COLLECT ALL POSSIBLE BUTTONS
    // ============================================================

    function collectSkipCandidates() {

        const player = getPlayer();

        const adRoot = getAdRoot();

        if (!player) {
            return [];
        }


        const found = new Map();


        function addCandidate(element, source) {

            const button =
                resolveActualButton(element);

            if (!button) return;


            if (!looksLikeSkipButton(button)) {
                return;
            }


            if (!isVisible(button)) {
                return;
            }


            if (!found.has(button)) {

                found.set(button, {
                    button,
                    sources: []
                });
            }


            found
                .get(button)
                .sources
                .push(source);
        }


        // --------------------------------------------------------
        // 1. EXACT SELECTORS
        // --------------------------------------------------------

        for (
            const selector
            of EXACT_SKIP_SELECTORS
        ) {

            try {

                player
                    .querySelectorAll(selector)
                    .forEach(
                        element =>
                            addCandidate(
                                element,
                                selector
                            )
                    );

            } catch (error) {

                log(
                    'Selector error:',
                    selector,
                    error
                );
            }
        }


        // --------------------------------------------------------
        // 2. FIND ICON/TEXT CHILDREN AND WALK UP TO BUTTON
        // --------------------------------------------------------

        for (
            const selector
            of SKIP_CHILD_HINTS
        ) {

            try {

                player
                    .querySelectorAll(selector)
                    .forEach(
                        element =>
                            addCandidate(
                                element,
                                `child:${selector}`
                            )
                    );

            } catch {}
        }


        // --------------------------------------------------------
        // 3. DYNAMIC FALLBACK
        //
        // Scan every button INSIDE the ad area and look for
        // classes/IDs/text containing "skip".
        //
        // This helps survive future YouTube class changes.
        // --------------------------------------------------------

        if (adRoot) {

            const allButtons =
                adRoot.querySelectorAll(
                    'button, [role="button"]'
                );


            for (
                const button
                of allButtons
            ) {

                const signature =
                    normalize([
                        button.className,
                        button.id,
                        button.getAttribute(
                            'aria-label'
                        ),
                        button.getAttribute(
                            'title'
                        ),
                        button.innerText
                    ].join(' '));


                if (
                    signature.includes('skip')
                ) {

                    addCandidate(
                        button,
                        'dynamic-skip-scan'
                    );
                }
            }
        }


        // --------------------------------------------------------
        // SORT BEST MATCH FIRST
        // --------------------------------------------------------

        const candidates =
            [...found.values()]
                .map(entry => ({
                    ...entry,
                    score:
                        scoreCandidate(
                            entry.button
                        )
                }))
                .sort(
                    (a, b) =>
                        b.score - a.score
                );


        return candidates;
    }


    // ============================================================
    // OPTIONAL COUNTDOWN DETECTION
    // ============================================================

    function detectSkipCountdown() {

        const adRoot = getAdRoot();

        if (!adRoot) {
            return null;
        }


        const possibleCountdownNodes =
            adRoot.querySelectorAll([

                '.ytp-ad-preview-text',

                '.ytp-ad-preview-text-modern',

                '.ytp-ad-text',

                '.ytp-ad-player-overlay-layout__skip-or-preview-container',

                '[aria-label*="Skip"]',

                '[aria-label*="skip"]'

            ].join(','));


        for (
            const node
            of possibleCountdownNodes
        ) {

            if (!isVisible(node)) {
                continue;
            }


            const value =
                [
                    node.innerText,
                    node.textContent,
                    node.getAttribute(
                        'aria-label'
                    )
                ]
                    .filter(Boolean)
                    .join(' ');


            // Examples:
            //
            // Skip ad in 5
            // Skip in 5
            // Skip ad after 5 seconds

            let match =
                value.match(
                    /skip(?:\s+ad)?\s+(?:in|after)\s+(\d+(?:\.\d+)?)/i
                );


            if (match) {

                return Number(
                    match[1]
                );
            }


            // Only accept generic seconds if the same text
            // also contains the word Skip.

            if (/skip/i.test(value)) {

                match =
                    value.match(
                        /(\d+(?:\.\d+)?)\s*(?:seconds?|secs?|s)\b/i
                    );


                if (match) {

                    return Number(
                        match[1]
                    );
                }
            }
        }


        return null;
    }


    // ============================================================
    // STATUS BADGE
    // ============================================================

    function ensureBadge() {

        if (
            badge ||
            !document.body
        ) {
            return;
        }


        badge =
            document.createElement(
                'div'
            );


        badge.id =
            'yt-smart-skip-badge';


        badge.style.cssText = `
            position:fixed;
            top:12px;
            right:12px;
            z-index:2147483647;

            min-width:260px;
            max-width:420px;

            padding:10px 12px;

            border-radius:10px;

            background:rgba(15,15,15,.88);
            color:white;

            font-family:
                Consolas,
                Menlo,
                monospace;

            font-size:12px;

            box-shadow:
                0 5px 20px
                rgba(0,0,0,.35);

            pointer-events:none;
        `;


        const title =
            document.createElement(
                'div'
            );


        title.style.cssText =
            'font-weight:bold;margin-bottom:4px;';


        title.textContent =
            `YT Smart Skip v${VERSION}`;


        badgeStatus =
            document.createElement(
                'div'
            );


        badgeStatus.style.cssText =
            'font-size:12px;font-weight:bold;';


        badgeDetails =
            document.createElement(
                'div'
            );


        badgeDetails.style.cssText =
            'font-size:10px;opacity:.75;margin-top:3px;';


        badge.appendChild(title);

        badge.appendChild(
            badgeStatus
        );

        badge.appendChild(
            badgeDetails
        );


        document.body.appendChild(
            badge
        );
    }


    function setStatus(
        message,
        details = ''
    ) {

        // Avoid rewriting the DOM (and retriggering observers) on every scan.
        if (state.lastStatus === message && state.lastDetails === details) return;

        state.lastStatus = message;
        state.lastDetails = details;

        ensureBadge();


        if (badgeStatus) {

            badgeStatus.textContent =
                message;
        }


        if (badgeDetails) {

            badgeDetails.textContent =
                details;
        }


        log(
            message,
            details
        );
    }


    // ============================================================
    // LARGE TEMPORARY ALERT
    // ============================================================

    function alertUser(message) {

        if (!document.body) {
            return;
        }


        let toast =
            document.getElementById(
                'yt-smart-skip-toast'
            );


        if (!toast) {

            toast =
                document.createElement(
                    'div'
                );


            toast.id =
                'yt-smart-skip-toast';


            toast.style.cssText = `
                position:fixed;

                top:70px;
                left:50%;

                transform:
                    translateX(-50%);

                z-index:2147483647;

                background:
                    rgba(0,0,0,.92);

                color:white;

                padding:
                    12px 20px;

                border-radius:
                    10px;

                font-family:
                    Consolas,
                    monospace;

                font-size:
                    14px;

                font-weight:
                    bold;

                box-shadow:
                    0 6px 20px
                    rgba(0,0,0,.4);

                transition:
                    opacity .3s;

                pointer-events:none;
            `;


            document.body.appendChild(
                toast
            );
        }


        toast.textContent =
            message;


        toast.style.opacity =
            '1';


        clearTimeout(
            toast.__hideTimer
        );


        toast.__hideTimer =
            setTimeout(
                () => {

                    toast.style.opacity =
                        '0';

                },
                1800
            );
    }


    // ============================================================
    // SEND A MOUSE-LIKE SEQUENCE
    // ============================================================

    function prepareMouseInteraction(
        button
    ) {

        const rect =
            button.getBoundingClientRect();


        const x =
            rect.left +
            rect.width / 2;


        const y =
            rect.top +
            rect.height / 2;


        const events = [

            'pointerover',

            'mouseover',

            'pointermove',

            'mousemove',

            'pointerdown',

            'mousedown',

            'pointerup',

            'mouseup'
        ];


        for (
            const type
            of events
        ) {

            try {

                let event;


                if (
                    type.startsWith(
                        'pointer'
                    ) &&
                    typeof PointerEvent ===
                        'function'
                ) {

                    event =
                        new PointerEvent(
                            type,
                            {
                                bubbles:
                                    true,

                                cancelable:
                                    true,

                                composed:
                                    true,

                                clientX:
                                    x,

                                clientY:
                                    y,

                                pointerId:
                                    1,

                                pointerType:
                                    'mouse',

                                isPrimary:
                                    true,

                                button:
                                    0,

                                buttons:
                                    type ===
                                    'pointerdown'
                                        ? 1
                                        : 0
                            }
                        );

                } else {

                    event =
                        new MouseEvent(
                            type,
                            {
                                bubbles:
                                    true,

                                cancelable:
                                    true,

                                composed:
                                    true,

                                view:
                                    window,

                                clientX:
                                    x,

                                clientY:
                                    y,

                                button:
                                    0,

                                buttons:
                                    type ===
                                    'mousedown'
                                        ? 1
                                        : 0
                            }
                        );
                }


                button.dispatchEvent(
                    event
                );

            } catch {}
        }
    }


    // ============================================================
    // VERIFY CLICK ACTUALLY CHANGED YOUTUBE
    // ============================================================

    async function verifyClick(originalButton) {
        const started = performance.now();
        while (performance.now() - started < VERIFY_TIMEOUT_MS) {
            await sleep(200);
            // Removing or hiding the button does NOT prove an ad ended.
            if (!isAdActive()) return {success: true, reason: 'ad ended'};
        }
        return {success: false, reason: 'ad still active after click'};
    }


    // ============================================================
    // FALLBACK FOR YOUTUBE BUILDS THAT IGNORE SYNTHETIC CLICKS
    // ============================================================

    function seekSkippableAdToEnd(originalButton) {
        const player = getPlayer();

        // The same button must still be present, active, and visible.
        // In particular, never seek the content video outside an ad.
        if (
            !SEEK_FALLBACK_ENABLED ||
            !player ||
            !isAdActive() ||
            !originalButton?.isConnected ||
            !isVisible(originalButton) ||
            originalButton.disabled ||
            originalButton.getAttribute('aria-disabled') === 'true' ||
            !looksLikeSkipButton(originalButton)
        ) return false;

        const activeButton = collectSkipCandidates()
            .some(candidate => candidate.button === originalButton);
        if (!activeButton) return false;

        const video = player.querySelector('video.html5-main-video') ||
                      player.querySelector('video');
        if (!video || !Number.isFinite(video.duration) || video.duration <= 0)
            return false;

        const destination = Math.max(0, video.duration - 0.05);
        if (video.currentTime >= destination) return false;

        try {
            const from = video.currentTime;
            video.currentTime = destination;
            log('Skip click was ignored; attempted ad-video seek:',
                {from, to: destination, duration: video.duration});
            return true;
        } catch (error) {
            log('Ad-video seek failed:', error);
            return false;
        }
    }


    // ============================================================
    // CLICK BEST CANDIDATE
    // ============================================================

    async function clickCandidate(
        candidate
    ) {

        if (
            state.actionInFlight
        ) {
            return;
        }


        if (
            state.attemptsThisAd >=
            MAX_ATTEMPTS_PER_AD
        ) {

            setStatus(
                'SKIP FOUND — click not accepted',
                'Automatic retries stopped'
            );

            return;
        }


        const now =
            Date.now();


        if (
            now -
            state.lastAttemptAt <
            CLICK_COOLDOWN_MS
        ) {

            return;
        }


        const button =
            candidate.button;


        if (
            !button ||
            !isVisible(button)
        ) {

            return;
        }


        state.actionInFlight =
            true;


        state.lastAttemptAt =
            now;


        state.attemptsThisAd++;


        state.buttonsFound++;


        state.lastSelector =
            candidate.sources[0];


        state.lastButton =
            button;


        const attempt =
            state.attemptsThisAd;


        setStatus(

            `SKIP FOUND → clicking (${attempt})`,

            candidate.sources.join(' | ')
        );


        alertUser(
            'SKIP FOUND → action taken'
        );


        log(
            'TARGET BUTTON:',
            button
        );


        log(
            'MATCHED BY:',
            candidate.sources
        );


        log(
            'SCORE:',
            candidate.score
        );


        // Do not force focus onto YouTube controls; it can interfere
        // with YouTube navigation and accessibility focus management.


        // Do not dispatch synthetic mousemove/down/up events. They cannot
        // create trusted input, and extra events cause unnecessary work.


        // The actual programmatic click.
        try {

            button.click();

            state.clicksSent++;

            log(
                'button.click() sent'
            );

        } catch (error) {

            log(
                'button.click() error:',
                error
            );
        }


        // Give the click a short chance to work normally.
        await sleep(SEEK_FALLBACK_DELAY_MS);

        // YouTube may ignore scripted clicks (event.isTrusted === false).
        // Only use the fallback if the exact same skippable button remains.
        if (isAdActive() && button.isConnected && isVisible(button)) {
            if (seekSkippableAdToEnd(button)) {
                setStatus('SKIP FOUND — trying video-end fallback');
            }
        }

        const result =
            await verifyClick(
                button
            );


        if (
            result.success
        ) {

            state.confirmed++;


            setStatus(
                '✓ SKIP CONFIRMED',
                result.reason
            );


            alertUser(
                '✓ YouTube Skip confirmed'
            );


            log(
                'CONFIRMED:',
                result.reason
            );

        } else {

            state.failed++;


            setStatus(
                'SKIP FOUND — click not confirmed',
                `Attempt ${attempt}/${MAX_ATTEMPTS_PER_AD}`
            );


            alertUser(
                'Skip found, but YouTube did not accept click'
            );


            log(
                'CLICK NOT CONFIRMED:',
                result.reason
            );
        }


        state.actionInFlight =
            false;
    }


    // ============================================================
    // MAIN SMART SCANNER
    // ============================================================

    async function scan(
        source = 'timer'
    ) {

        clearTimeout(scanTimer);
        const neededTarget = getPlayer() || document.documentElement;
        if (observedTarget !== neededTarget) installObserver();

        state.scans++;

        state.lastSource =
            source;


        // Don't interfere with current verification.
        if (
            state.actionInFlight
        ) {

            scheduleScan(
                AD_SCAN_MS,
                'action-wait'
            );

            return;
        }


        const adActive =
            isAdActive();


        // ========================================================
        // NO AD
        // ========================================================

        if (!adActive) {

            if (state.adActive) {

                state.adActive =
                    false;


                state.adStartedAt =
                    0;


                state.attemptsThisAd =
                    0;


                setStatus(
                    'Watching for ads / Skip',
                    'Idle scan'
                );
            }


            scheduleScan(
                IDLE_SCAN_MS,
                'idle'
            );


            return;
        }


        // ========================================================
        // NEW AD DETECTED
        // ========================================================

        if (!state.adActive) {

            state.adActive =
                true;


            state.adStartedAt =
                performance.now();


            state.attemptsThisAd =
                0;


            state.adsDetected++;


            setStatus(
                'AD DETECTED',
                'Searching for Skip'
            );


            alertUser(
                'Ad detected → watching for Skip'
            );
        }


        // ========================================================
        // LOOK FOR BUTTON
        // ========================================================

        const candidates =
            collectSkipCandidates();


        if (
            candidates.length >
            0
        ) {

            const best =
                candidates[0];


            await clickCandidate(
                best
            );


            scheduleScan(
                AD_SCAN_MS,
                'post-click'
            );


            return;
        }


        // ========================================================
        // NO BUTTON YET — TIMER MODE
        // ========================================================

        const countdown =
            detectSkipCountdown();


        const elapsed =
            state.adStartedAt
                ? (
                    (
                        performance.now() -
                        state.adStartedAt
                    ) /
                    1000
                ).toFixed(0)
                : '0';


        if (
            countdown !== null
        ) {

            setStatus(

                `Waiting for Skip: ~${countdown}s`,

                `Ad active ${elapsed}s`
            );

        } else {

            setStatus(

                `Ad detected — waiting for Skip`,

                `${elapsed}s | fast scan ${AD_SCAN_MS}ms`
            );
        }


        scheduleScan(
            AD_SCAN_MS,
            'ad-fast-scan'
        );
    }


    // ============================================================
    // DYNAMIC TIMER
    // ============================================================

    function scheduleScan(
        delay,
        source
    ) {

        clearTimeout(
            scanTimer
        );


        scanTimer =
            setTimeout(
                () => scan(source),
                delay
            );
    }


    // ============================================================
    // MUTATION OBSERVER
    // ============================================================

    function installObserver() {
        // When a player is present, observe only its subtree instead of
        // all YouTube page mutations (thumbnails, recommendations, etc.).
        const target = getPlayer() || document.documentElement;
        if (observer && observedTarget === target) return;
        if (observer) observer.disconnect();
        observedTarget = target;


        observer =
            new MutationObserver(
                mutations => {

                    let relevant =
                        false;


                    for (
                        const mutation
                        of mutations
                    ) {

                        const target =
                            mutation.target instanceof Element
                                ? mutation.target
                                : mutation.target
                                    ?.parentElement;


                        // Existing player/ad area changed.
                        if (
                            target?.closest?.(
                                '#movie_player, ' +
                                '.html5-video-player, ' +
                                '.video-ads'
                            )
                        ) {

                            relevant =
                                true;

                            break;
                        }


                        // New elements appeared.
                        for (
                            const node
                            of mutation.addedNodes
                        ) {

                            if (
                                !(node instanceof Element)
                            ) {
                                continue;
                            }


                            if (
                                node.matches?.(
                                    '#movie_player, ' +
                                    '.video-ads, ' +
                                    '.ytp-skip-ad, ' +
                                    'button.ytp-skip-ad-button, ' +
                                    '[class*="ad-skip"], ' +
                                    '[class*="skip-ad"]'
                                )
                            ) {

                                relevant =
                                    true;

                                break;
                            }


                            if (
                                node.querySelector?.(
                                    'button.ytp-skip-ad-button, ' +
                                    '.ytp-skip-ad, ' +
                                    '[class*="ad-skip-button"], ' +
                                    '[class*="skip-ad-button"]'
                                )
                            ) {

                                relevant =
                                    true;

                                break;
                            }
                        }


                        if (relevant) {
                            break;
                        }
                    }


                    if (!relevant) return;
                    if (Date.now() - lastMutationAt < MUTATION_DELAY_MS) return;
                    lastMutationAt = Date.now();

                    clearTimeout(
                        mutationTimer
                    );


                    mutationTimer =
                        setTimeout(
                            () =>
                                scan(
                                    'DOM mutation'
                                ),
                            MUTATION_DELAY_MS
                        );
                }
            );


        observer.observe(
            target,
            {
                subtree:
                    true,

                childList:
                    true,

                attributes:
                    true,

                attributeFilter: [
                    'class',
                    'style',
                    'aria-label',
                    'disabled',
                    'aria-disabled'
                ]
            }
        );
    }


    // ============================================================
    // DEBUG COMMANDS
    // ============================================================

    function exposeDebugTools() {

        window.__ytSmartSkip = {

            version:
                VERSION,


            scan() {

                return scan(
                    'manual'
                );
            },


            state() {

                return {
                    ...state,
                    lastButton:
                        state.lastButton
                            ? {
                                tag:
                                    state.lastButton
                                        .tagName,

                                id:
                                    state.lastButton
                                        .id,

                                class:
                                    state.lastButton
                                        .className,

                                text:
                                    state.lastButton
                                        .innerText
                            }
                            : null
                };
            },


            candidates() {

                return collectSkipCandidates()
                    .map(
                        candidate => ({
                            score:
                                candidate.score,

                            sources:
                                candidate.sources,

                            tag:
                                candidate.button
                                    .tagName,

                            id:
                                candidate.button
                                    .id,

                            class:
                                candidate.button
                                    .className,

                            text:
                                candidate.button
                                    .innerText
                        })
                    );
            },


            countdown() {

                return detectSkipCountdown();
            },


            adActive() {

                return isAdActive();
            },


            button() {

                const list =
                    collectSkipCandidates();

                return list[0]
                    ?.button ||
                    null;
            }
        };
    }


    // ============================================================
    // YOUTUBE SPA NAVIGATION
    // ============================================================

    function installNavigationHooks() {

        window.addEventListener(
            'yt-navigate-start',
            () => {

                scheduleScan(
                    100,
                    'yt-navigate-start'
                );
            }
        );


        window.addEventListener(
            'yt-navigate-finish',
            () => {

                scheduleScan(
                    100,
                    'yt-navigate-finish'
                );
            }
        );
    }


    // ============================================================
    // START
    // ============================================================

    function start() {

        if (
            !document.documentElement
        ) {

            requestAnimationFrame(
                start
            );

            return;
        }


        exposeDebugTools();

        installObserver();

        installNavigationHooks();


        log(
            'Smart Skip Watcher started'
        );


        scheduleScan(
            100,
            'startup'
        );
    }


    start();

})();