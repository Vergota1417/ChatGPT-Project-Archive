# YouTube Smart Skip v4 — Browser Test Report

Date: **2026-10-30**

**Code tested:** `YouTube_Smart_Skip_v4_2026.user.js`, version 4.0.0. Chromium headless local mock-player tests.

## Result: 10/10 scenarios passed

| # | Scenario | Result |
|---|---|---|
| 1 | No ad: normal playback and sound are untouched | PASS |
| 2 | `ad-interrupting`: `cancelPlayback()` dismisses simulated ad, player state restores | PASS |
| 3 | `ad-showing`: available Skip button click ends simulated ad | PASS |
| 4 | Skip click ignored: single click then bounded seek fallback | PASS |
| 5 | Hidden Skip control is not clicked or sought through | PASS |
| 6 | `aria-hidden` Skip button is only clicked when actionable | PASS |
| 7 | Shorts `ad-created` state advances after ad playback starts | PASS |
| 8 | Visible stale Skip button with no ad class is left alone | PASS |
| 9 | Frequent player DOM changes do not cause repeated clicks | PASS |
| 10 | Stopping the script clears its active session | PASS |

JavaScript syntax: `node --check` passed.

## Scope and limitations

These are **mock player simulations**, not a live authenticated YouTube session. YouTube may not expose `cancelPlayback()` in all player builds, may ignore synthetic Skip clicks, may reset seek/playbackRate, or may change Shorts structure. We have **not** demonstrated that v4 blocks more real ads than Greasy Fork v32 or confers Premium privileges.

The script does not modify account status or authentication. It makes no outgoing network requests.

## Install

1. Disable all other YouTube skip userscripts in Tampermonkey.
2. Open [v4](YouTube_Smart_Skip_v4_2026.user.js) and choose **Raw**; install through Tampermonkey or paste the source into a new script.
3. Refresh YouTube and run `window.__ytSmartSkipV4.state()` in DevTools Console.
4. If the ad persists, note `cancelAttempts`, `skipClickAttempts`, `seekAttempts`, `adActive`, and `lastError`.

## Comparison with Greasy Fork

The independently maintained [YouTube Mute and Skip Ads v32](https://greasyfork.org/en/scripts/461341-youtube-mute-and-skip-ads) (2026-10-16) uses `cancelPlayback()`, muting and speedup, watches `ad-interrupting`, and supports forward/backward Shorts navigation. Our v4 additionally exposes diagnostics and attempts a guarded video seek when a visible Skip click is ignored. It is **not** proven superior live; the maintained upstream script may be more reliable.
