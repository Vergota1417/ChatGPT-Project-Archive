# YouTube Smart Skip Watcher — Version Archive

This folder preserves the original Tampermonkey script and later experimental revisions.

| File | Purpose |
| --- | --- |
| [Original v2.0.0](YouTube_Smart_Skip_Watcher_original_v2_0_0.user.js) | Original script provided on October 29, 2026 |
| [v2.0.1](YouTube_Smart_Skip_Watcher_v2_0_1.user.js) | Original-based experimental fallback |
| [v2.0.2](YouTube_Smart_Skip_Watcher_v2_0_2.user.js) | Reduced scan frequency / retries and improved success checks |
| [v2.1.0](YouTube_Smart_Skip_Watcher_v2_1_0.user.js) | Alternate implementation, archived for comparison |

**Status:** The v2.0.2 change passes a JavaScript syntax check but has **not** been confirmed to make YouTube accept automatic Skip-button clicks. YouTube may reject synthetic clicks, and the ad-video fallback may not work.

## Installation

1. In Tampermonkey, **disable all other versions** of YouTube Smart Skip Watcher.
2. Click the desired `.user.js` file above.
3. Click **Raw** to get the standalone script, or save the file and choose **Tampermonkey → Dashboard → Utilities → Import from File**.
4. Enable only one version and reload YouTube.

## Download a ZIP

In the main repository, select **Code → Download ZIP**. This includes all versions and can be used instead of temporary ChatGPT download links.

## Troubleshooting

In Chrome's Console, try `window.__ytSmartSkip?.version` for the original-based versions (including v2.0.2). The result should match the installed version. If Console logs do not include the expected version, an older or additional watcher may still be enabled.

Do not infer that an ad has been skipped merely because the button disappears. The player must stop reporting an active ad.
