# Phone fidelity lane

The six phone screens now have a repeatable browser screenshot loop against opt-in Paper mock states.
The UI uses the bundled fonts, tuned spacing and controls, safe-area footers, typeset maths, and rendered work previews.
Streaming replaces full partials in one assistant slot, releases readers, and resumes when the focused app returns to the foreground.
Desktop pairing accepts Crockford aliases and forwards to Next's selected listening port.

## Files changed

```text
.gitignore
src/server/phone.ts
tests/phone.test.ts
mobile/README.md
mobile/FIDELITY_REPORT.md
mobile/package.json
mobile/package-lock.json
mobile/app/index.tsx
mobile/app/pair.tsx
mobile/app/session/[id].tsx
mobile/src/net/{client.ts,runtime.tsx,session.ts,sse.ts}
mobile/src/platform/{camera.tsx,camera.web.tsx,credentials.ts,credentials.web.ts,
  demo.tsx,demo.web.tsx,formula.tsx,formula.web.tsx,screen.tsx,screen.web.tsx,
  speech.ts,speech.web.ts}
mobile/src/render/{markdown.tsx,math.ts,pipeline.ts}
mobile/src/ui/{atoms.tsx,check-model.ts,check.tsx,practice-views.tsx}
mobile/tests/{pure.test.ts,session.test.ts}
mobile/scripts/{mock-server.mjs,preview-fixtures.mjs,preview.cjs,
  serve-preview.mjs,check-preview.cjs,check-desktop-port.mjs}
```

## Decisions I made

- Added only `react-native-web` as a dependency. It supplies the requested browser renderer; the rest of the preview uses existing dependencies and Node built-ins.
- Kept native SecureStore, camera, on-device speech, and WebView behind native platform files; `.web` files provide browser storage, an inert viewfinder, no-op speech, and a sandboxed iframe. The web status area represents the system-owned iOS status bar.
- Added opt-in `PHONE_PREVIEW=1` mock records using approved design text, recorded tool data, and synthetic practice states. Default mock mode retains recorded turn replays and the existing practice cycle. Preview session ages remain relative so repeated captures stay comparable.
- Retained CMU at the approved sizes, including its natural wider glyphs. The Pair title therefore wraps to two lines. Home uses the API's available session state; it does not fabricate the design examples' “2 missed” and “all solved” summaries.
- Work renders as Markdown/maths when blurred and returns to the original editable text on tap. Added a small dismiss × to the check sheet; holding the Problem label dismisses a practice problem, with a corresponding accessibility action.
- Native footers use the larger of the actual bottom inset and 30 pt (44 pt on Pair), with keyboard avoidance. Small controls use actual 44 pt target boxes, plus hit slop where appropriate, around the approved visible geometry.
- Resolve forwarding at request time from Next's selected origin, then `PORT`, then 3000. The installed Next launcher publishes the selected port/origin after listening; the standalone/Electron PORT path remains supported.

## Screen review

All six approved PNGs and JSX style references were inspected, along with the four desktop reference screenshots. Screens were captured, inspected, adjusted, and recaptured through the real app screens. Final viewport: **402 × 874**, device scale **2**, PNG dimensions **804 × 1748**. The PNGs and receipts are gitignored.

| Screen | Preview path | Verdict |
| --- | --- | --- |
| Home | `mobile/.preview/01-home.png` | Layout matches; CMU count is wider, and practice rows say “done” rather than the examples' outcome totals. |
| Session | `mobile/.preview/02-session.png` | Layout matches; CMU and MathJax glyph shapes/spacing differ from Paper's stand-ins. The full question truncates naturally in the check bar. |
| Check | `mobile/.preview/03-check.png` | Layout and selected third option, 70% confidence, and thinking match; CMU options are heavier and a small dismiss × is present. |
| Practice | `mobile/.preview/04-practice.png` | Layout matches closely; the work card is about 2 pt lower, with real MathJax operator spacing. |
| Result | `mobile/.preview/05-result.png` | Layout and 9/14/21-day review rows match; headline uses CMU. |
| Pair | `mobile/.preview/06-pair.png` | Viewfinder, colours, and footer match; the two-line CMU title moves the scanner about 42 pt lower. |

## Gate receipts

Every gate ran under `flock /tmp/lh-gates.lock`. Root tests used `TZ=UTC`. Final source passed:

| Gate | Result / output tail |
| --- | --- |
| Root `npm run typecheck` | `> tsc --noEmit`; exit 0 |
| Root `TZ=UTC npm test` | `# tests 1964`, `# pass 1964`, `# fail 0`; 25,452.4 ms |
| Root `npm run lint` | `> eslint .`; exit 0, no diagnostics |
| Mobile `npx tsc --noEmit` | exit 0, no diagnostics |
| Mobile `npm test` | `# tests 19`, `# pass 19`, `# fail 0`; 1,046.6 ms |
| Mobile `npx expo-doctor` | `20/20 checks passed. No issues detected!` |
| Mobile `npx expo export --platform ios` | `entry-c4d183260fa8a09942bf668fafb53edc.hbc (5.5MB)`; `Exported: dist` |
| Mobile web export | `Exported: .preview/web` |
| Targeted desktop phone tests | 8 passed, 0 failed |
| `node --import tsx scripts/live-check.mts` | passed; measurements below |

The exact iOS bundle is **5,501,276 bytes**, and the complete export is **6,624,946 bytes**. All four font assets are byte-identical to their bundled copies: CMU 221,904 bytes, JetBrains Mono 114,904 bytes, Source Sans regular 381,020 bytes, Source Sans bold 380,864 bytes. The native credential key is present in the Hermes bundle; the browser credential key is absent. Browser font checks report all four families loaded. Native font registration remains `expo-font` in `app/_layout.tsx`, and text styles explicitly select those families.

### Live and manual receipts

- Real isolated desktop: `next dev -p 3218` with `PORT` unset. Pair → forwarded chats **200** → revoke → **401**. Total **3,178.7 ms**; proxy-and-revoke portion **1,431.0 ms**. No model call was made.
- Normal mock net-layer check: pair **43.9 ms**, one-chat list **1.5 ms**, **28** replay frames in **956.6 ms**, **9** practice frames and a complete pose/conclude cycle in **1,293.9 ms**, events ping **1.6 ms**.
- Twenty heaviest recorded formulas: **1.55 ms p50**, **3.55 ms p95**, **18.34 ms max**. Cached SVGs remain enabled.
- Browser checks: no pairing/manual normalization and successful pairing **2,431.0 ms**; zero due/zero sessions/next in two days **860.9 ms**; 503 with draft retained **72.9 ms**; unreachable computer message **849.0 ms**; two-line truncation **877.0 ms**; 44 pt control bounds **897.1 ms**; 401 clears credentials and shows “This phone was removed from MacBook. Pair again.” **863.3 ms**.
- Host/mode targets are **44 px** high; Back and check dismiss are **44 × 44 px**; the confidence rail and close handle targets are **44 px** high.
- Long title height **72 px** (2 × 36); long check question **40 px** (2 × 20). Six final screenshots; **0 browser exceptions** in the screenshot loop and state checks.
- Deterministic regression checks cover message replacement through `message_end`, interleaved steer markers, reader cancellation, foreground replay, late POST acknowledgements after teardown, all five turn input variants including `readingThinking`, continue/dismiss, stop, both 409 paths, 503, shared question modes, and multi-select Other semantics.

Full local receipts: `mobile/.preview/{root-typecheck,root-tests,root-lint,mobile-typecheck,mobile-tests,expo-doctor,ios-export,web-export,desktop-phone-tests,desktop-port-live,live-check,math-benchmark,shoot,manual-browser}.log`, plus `browser.json`, `manual-browser.json`, and `bundle.json`.

## Known limits and risks

This Linux environment cannot run the iOS Simulator. Native camera permissions/scanning, speech, keyboard avoidance, actual system safe areas, and native inline-SVG baselines still need a device check. Font registration, asset inclusion, native/web separation, and successful iOS compilation are verified; a native screenshot is not claimed.

The visual differences in the table remain. Browser storage and the simulated status bar are preview-only. The final checks used recorded/mock turns and an isolated real desktop listener, not another paid/live Claude turn. No credentials, tokens, preview PNGs, or exported bundles are committed.

## Reviewer focus

Start with the Pair title/scan position and the Session/Practice maths in the six PNGs. On a Mac, follow `mobile/README.md` and verify native baselines, keyboard/safe-area behavior, QR, and speech. For code review, start with `mobile/src/net/session.ts` and `mobile/tests/session.test.ts`, then the origin and code-normalization changes in `src/server/phone.ts` and `tests/phone.test.ts`.

Logical commits: `26e4f67` desktop fixes; `58202a4` stream/input correctness; `f5fa34e` screen fidelity/platform adapters; the following commit adds the preview loop, run instructions, and this report. Nothing was pushed.
