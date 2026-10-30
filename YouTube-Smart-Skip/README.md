# YouTube Smart Skip Watcher

## New: v4.0.0 experimental — October 30, 2026

**[Installable userscript v4](YouTube_Smart_Skip_v4_2026.user.js)** · [10/10 local Chromium test report](TEST_REPORT_v4.md)

Compared with our v3, v4 now attempts `#movie_player.cancelPlayback()` while ads are playing, immediately mutes/speeds the ad, clicks available Skip buttons only once per element, adds a guarded seek fallback, and supports basic Shorts advance. The script does **not** spoof Premium membership. **10/10 simulations passed; live YouTube efficacy is not verified and it is not proven better than the maintained Greasy Fork script.**

**Recommended install:** Disable all old Skip watchers, click the v4 source → **Raw** → install through Tampermonkey (or paste the source into a new script). Use `window.__ytSmartSkipV4.state()` for diagnostics. Install only one ad-skip userscript at a time.


## Best current choices (verified October 30, 2026)

### 1. Maintained upstream alternative — first to try

**[YouTube Mute and Skip Ads by ion1 — Greasy Fork](https://greasyfork.org/en/scripts/461341-youtube-mute-and-skip-ads)**, version **32**, updated **2026-10-16**.

This update explicitly addresses the change to YouTube's `#movie_player.ad-interrupting` state and includes ad muting, speeding up, and player-level fallback handling. It is independently maintained and can update from Greasy Fork. **Its live effectiveness is not verified on your browser.** Use the *Install this script* link on Greasy Fork to install.

### 2. Our experimental script — isolated Chromium tests

**[YouTube Smart Skip (2026 Experimental), v3.0.0](YouTube_Smart_Skip_2026_Experimental_v3.user.js)**

This version has one-click-per-ad logic, detects `ad-interrupting` and `ad-showing`, watches the player only, and uses a guarded seek or speed fallback when synthetic clicks do not dismiss the ad. The safeguards avoid advancing normal videos or ads with no visible Skip control.

**Test status:** JavaScript syntax verified and **8/8 Chromium mock-player tests passed** on October 30, 2026: inactive player, unskippable ad, hidden button, accepted synthetic click, rejected synthetic click with seek, a trusted mouse click, unknown-duration speed fallback, and `ad-showing` detection. This does **not** count as a live YouTube test. YouTube can reject `button.click()`, ignore video seeks, or reset playback rates.

**To install from GitHub:**
1. Open the v3 script file link above.
2. Click **Raw**, and save the page as `YouTube_Smart_Skip_2026_Experimental_v3.user.js` (or copy its entire contents to a new Tampermonkey script).
3. In Tampermonkey use **Dashboard → Utilities → Import from File**, or create a new script and paste the source.
4. Disable every other YouTube ad-skip userscript, including old versions, before testing.
5. Refresh YouTube. For diagnostics run `window.__ytSmartSkip2026.state()` in DevTools Console.

**Do not run the ion1 script and our experimental script together.**

## Previous versions

| File | Description |
| --- | --- |
| [Original v2.0.0](YouTube_Smart_Skip_Watcher_original_v2_0_0.user.js) | Your original uploaded script |
| [v2.0.1](YouTube_Smart_Skip_Watcher_v2_0_1.user.js) | Early experimental fallback |
| [v2.0.2](YouTube_Smart_Skip_Watcher_v2_0_2.user.js) | Performance-limited patch |
| [v2.1.0](YouTube_Smart_Skip_Watcher_v2_1_0.user.js) | Alternate approach |
| [Experimental v3.0.0](YouTube_Smart_Skip_2026_Experimental_v3.user.js) | Mock-tested revision |

## Downloads

Use **Code → Download ZIP** from the repository to download all archived versions, or **Raw** on an individual userscript for standalone installation.

## Limitations

- There is no `href` target on YouTube's Skip button. It uses a JavaScript event handler.
- Scripted clicks are untrusted browser events, and YouTube may ignore them.
- Network CORS warnings from `ad.doubleclick.net` are unrelated to the userscript and will not necessarily disappear.
- Skipping ads may affect YouTube's terms or behavior. Never treat DOM mock tests as proof of live efficacy.
