# Dashboard browser QA checklist

**Status: CORE_BROWSER_QA_PASS; extended checks below remain partial.**

Recorded on 2026-10-09 UTC in Cursor's Chromium preview against the real synthetic demo at `http://127.0.0.1:18888/`.

Verified in the real browser:
- 390 x 844: all nine views were visited and visually inspected; menu opens, navigation closes it, dense call/booking/audit tables stay inside their scrolling containers, and connection/business/limit fields fit the viewport. No visual content spill was seen; scrollWidth was not instrumented.
- Desktop: overview and forms were inspected; the first overview was also inspected at the explicitly selected 1440 x 900 viewport.
- Wrong dummy password gives natural Turkish feedback and clears the password; admin login and logout work.
- Admin can save only synthetic connection values, draft business data and a local budget. Password fields clear after success. Stored values remain unverified/inactive; the draft remains unapplied; the budget explicitly does not cap provider spending.
- Viewer has disabled control, connection, business and limit fields. Operator has an enabled control and disabled admin forms. These were verified through the browser's accessibility state.
- Modal: initial focus is Cancel; real Tab / Shift+Tab wrap between buttons. Escape and Cancel close it and return focus to the trigger. Keyboard confirmation stops and resumes the synthetic workflow. The 390px dialog fits and its buttons are reachable. The provider-charge warning remains visible.
- Browser Back/Forward: actual Alt+Left returned from #bookings to #calls; Alt+Right returned to #bookings, with the correct heading focus. The preview toolbar button did not respond, so the native keyboard shortcut was used.
- Reduced motion: source inspection confirms the reduce media query sets transition/animation to none and scroll-behavior to auto for elements and pseudo-elements. Runtime media emulation was not performed.
- Keyboard navigation activates the chosen view and focuses its heading. Focus rings were visually seen on inputs, modal actions and the skip link. The corrected skip link preserves the current view and focuses content; after logout it targets the visible username field.

Failures found and fixed:
1. Refresh discarded an uncertain control operation. The retry now keeps the exact operationId, revision and intent; a failing-then-passing regression verifies manual-only retry.
2. Invalid / legacy hash changes were not canonicalized. Regression verifies invalid-to-overview and cost-to-budget transitions.
3. The skip link was treated as an unknown route and navigated to overview. Regression and the final browser reload verify the fix.

Limitations / NOT_RUN:
- Chrome's separate tab refused loopback with ERR_BLOCKED_BY_CLIENT; it was not bypassed. Safari/WebKit was not run.
- The preview's console panel did not open, so CSP/console/network/404 inspection is unverified. No claim of an independent security audit is made.
- OS/DevTools reduced-motion, quantitative contrast, measured tap sizes and scrollWidth, screen reader speech, browser-level forced writes, session revocation across tabs, full deep-link reload testing, real-browser stale revisions and failed network saves were not completed. Relevant logical cases are covered by the Node fixture, not a rendered browser.
- Responsive mode kept the previously loaded document until it was closed and the main preview reloaded; after reloading, the runtime skip-link target confirmed the final source was loaded.
- This is an extended follow-up checklist, not a record that every item below passed. The Node suite uses a minimal DOM fixture and cannot verify CSS or native browser layout. Its final real-repository run passed 59 tests, including the fixture's own tests.


Run it against the real backend's synthetic demo at `http://127.0.0.1:18888` (`scripts/dashboard-demo.ts`). Use only the public dummy accounts `admin`, `operator` and `viewer`, all with the password `demo-local-only-2026`. Do not enter real provider keys. In connection fields, type only obvious dummy strings such as `synthetic-qa-value`.

Record the result for each item as PASS, FAIL (with a note or screenshot path), or N/A.

## Setup
- [ ] Chromium-based browser with the DevTools console open. Repeat critical items in Safari/WebKit if available.
- [ ] Start with the cache cleared and no existing session cookie.

## Console and CSP
- [ ] Console has no CSP violations, errors, or 404s on load, login, every view, and logout.
- [ ] The Network tab shows only same-origin requests (`/`, `/app.js`, `/style.css`, `/api/...`): no fonts, CDN, icons, or analytics.
- [ ] Application > Local/Session Storage is empty after login and every action. The session cookie is HttpOnly and SameSite=Strict.
- [ ] Every request is a single fetch per action: no polling or auto-refresh in the Network tab while idle for 2 minutes.

## Synthetic demo login, per role
- [ ] Wrong password: an actionable Turkish error appears with no raw JSON, code, or request body. The password field does not keep stale input.
- [ ] `admin`: all views reachable. Connections, business draft, limit form, and kill toggle are enabled.
- [ ] `operator`: kill toggle is enabled. The connections, business and limit fieldsets are disabled, and a role note explains why.
- [ ] `viewer`: everything is read-only and the kill toggle is disabled. The server still rejects any forced write (403).
- [ ] The demo banner is visible for the demo session. The role label matches the selected tenant's role.
- [ ] Logout returns to login. Browser Back does not reveal tenant data.
- [ ] An expired or revoked session (e.g. logout in another tab, then act) returns to login on the next request.

## Layout at 1440px
- [ ] The sidebar navigation, top bar (tenant select, user, role, logout) and main panel are aligned, with no overlapping text.
- [ ] Tables are legible. Long IDs are truncated or wrapped inside the table container only.
- [ ] Status indicators are quiet and readable. There are no neon colors, gradients, or fake charts.

## Layout at 390px (mobile)
- [ ] No horizontal page scroll on any view (`document.documentElement.scrollWidth <= innerWidth`).
- [ ] Dense tables scroll horizontally inside `.table-wrap` only, not the page.
- [ ] `#menu-toggle` opens and closes navigation, `aria-expanded` reflects the state, and the menu does not cover content when closed.
- [ ] Forms (connections, business, limits) fit the width, tap targets are at least ~44px, and the time/number inputs are usable.
- [ ] The confirm dialog fits the viewport and its buttons are reachable without zooming.

## Keyboard only
- [ ] The first Tab reveals the skip link "İçeriğe geç". Enter moves focus to `#main`.
- [ ] Every interactive element shows a clearly visible focus ring (`:focus-visible`), including nav buttons, the tenant select, form fields, retry buttons, and dialog buttons.
- [ ] Nav buttons expose `aria-current="page"` on the active view. Enter/Space switch views.
- [ ] Changing the view moves focus to the panel heading (or a sensible target), without losing focus to `<body>`.
- [ ] Tenant switch by keyboard keeps the current view, or clearly resets it, and never shows the previous tenant's data.

## Modal (kill confirmation)
- [ ] Activating `#kill-toggle` opens `#confirm-dialog` and moves focus into it.
- [ ] Tab and Shift+Tab stay trapped inside the dialog. The background cannot be reached.
- [ ] Escape and "Vazgeç" both close the dialog with no request sent, and focus returns to `#kill-toggle`.
- [ ] "Onayla" sends exactly one `POST /control`, the dialog closes, and the state text updates. A second deliberate action sends a new `operationId`.
- [ ] The copy states that kill stops new workflow actions only, not ongoing calls or provider charges.

## Reduced motion
- [ ] With OS/DevTools `prefers-reduced-motion: reduce` enabled, there are no transitions or animations on the dialog, navigation, or loading states.

## Honest states and copy
- [ ] Every view shows its loading, empty (fresh demo tenant), error (stop the backend, then use Retry) and ready states, with natural Turkish copy.
- [ ] Stored connections read "kaydedildi · doğrulanmadı · etkin değil" (or equivalent). Nothing claims verified or active.
- [ ] Saving the business draft says it was saved as a draft and does not change the live flow or slots.
- [ ] The budget view says it is a local reservation budget, not a provider (Retell) billing cap. `maxCalls` is read-only.
- [ ] The provider invoice shows "not connected" text and no currency amount anywhere.
- [ ] Stale revision (save the same form from two tabs) shows a clear refresh-and-retry message. The kill toggle is not auto-retried.
- [ ] Connection inputs are empty after both a successful and a failed save, and the value never appears in the DOM (Elements panel search).
