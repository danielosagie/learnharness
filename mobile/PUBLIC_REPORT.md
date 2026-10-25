Phone access now binds `127.0.0.1:4791` and orchestrates a public HTTPS Funnel on 8443.
Settings guides the one-time desktop approval; pairing and bearer authentication remain the access control.
Pair v2 accepts public URLs and opens a bundled sample lesson with streamed teaching and a practice cycle.
The sample uses no API requests and preserves saved computer credentials.

## Files changed

- `components/settings/phone-section.tsx`
- `docs/architecture.md`
- `docs/development.md`
- `mobile/README.md`
- `mobile/app.config.ts`
- `mobile/app/index.tsx`
- `mobile/app/pair.tsx`
- `mobile/app/session/[id].tsx`
- `mobile/scripts/build-sample.mjs`
- `mobile/scripts/check-desktop-port.mjs`
- `mobile/scripts/check-preview.cjs`
- `mobile/scripts/mock-server.mjs`
- `mobile/scripts/preview.cjs`
- `mobile/scripts/public-preview.cjs`
- `mobile/src/net/client.ts`
- `mobile/src/net/runtime.tsx`
- `mobile/src/net/session.ts`
- `mobile/src/sample/lesson.json`
- `mobile/src/sample/response.ts`
- `mobile/src/sample/transport.ts`
- `mobile/tests/sample.test.ts`
- `mobile/tests/session.test.ts`
- `scripts/phone-funnel-live.mjs`
- `src/server/phone-funnel.ts`
- `src/server/phone.ts`
- `tests/fixtures/phone-tailscale.mjs`
- `tests/phone-funnel.test.ts`
- `tests/phone.test.ts`
- `mobile/PUBLIC_REPORT.md`

## Decisions I made

- Kept CLI discovery, timeout handling, and Serve ownership checks in `src/server/phone-funnel.ts`, leaving pairing, devices, and HTTP forwarding in `phone.ts`.
- Treat a status-command timeout as `no-tailscale` because no verified node ID exists to build an approval URL. A later timeout with a known ID reports `needs-approval`. The tripwire retries every 30 seconds.
- An owned mapping means exactly the root proxy to `http://127.0.0.1:4791`, with HTTPS on 8443 and no extra mounts, TCP options, conflicting host mapping, or foreground listener on that port. Setup is verified after the command. Disable checks ownership again; failed cleanup is retried. A failed local bind also removes an owned stale mapping.
- Accepted JSON `null` as an empty Serve configuration after checking Tailscale's implementation. Tailscale's [Funnel command reference](https://tailscale.com/docs/reference/tailscale-cli/funnel) and [Serve configuration source](https://github.com/tailscale/tailscale/blob/main/ipn/serve.go) were the command and shape references. No reset command is used.
- Trimmed the recording to the teaching plan, derivative lesson, pending check, and next recorded turn; removed model thinking and bookkeeping. The bundled fixture is **23,471 bytes**, below the 600,000-byte budget. Raw multi-megabyte test recordings are not bundled. No dependencies were added.
- Shared the in-memory transport between native demo mode and the development mock. Demo state is ephemeral; practice outcomes are scripted as in the previous mock. React Native's global Response is an XHR polyfill, so sample responses use Web Streams directly. Tests disable the global Response constructor and real fetch.
- Retained the required CMU font and size. Pair's title remains two lines rather than compressing the type. The sample Home lists the one real bundled lesson rather than adding dummy sessions.
- Fixed the initial-prompt/event-resync race discovered by the browser practice check. An initial 30-second UI timeout exposed the issue; the corrected flow now passes.

## Receipts

Every typecheck, test, lint, export, doctor, build, browser check, and live check ran under `flock /tmp/lh-gates.lock`. Root tests used `TZ=UTC`.

```text
Root typecheck: npm run typecheck / tsc --noEmit — exit 0
Root tests: # tests 1968 / # pass 1968 / # fail 0
            # duration_ms 25739.8503
Root lint: npm run lint / eslint . — exit 0
Root build: Compiled successfully in 11.0s; static pages 15/15; exit 0
Mobile typecheck: npx tsc --noEmit — exit 0
Mobile tests: # tests 24 / # pass 24 / # fail 0
Expo Doctor: 20/20 checks passed. No issues detected!
Web export: Exported: .preview/web
iOS export: entry-7c93e9fc02df0ef4d7244af6b1a150ee.hbc (5.5MB)
            Exported: dist
```

Production Next build emits five dynamic-filesystem trace warnings in unchanged `claude-code.ts`, `headless.ts`, `pdf-read.ts`, and `store/graph.ts`. The Node mock emits Node's typeless-package warning; neither blocks a gate. The documented sidebar test failure did not occur under UTC.

| Size | Before | After | Delta |
| --- | ---: | ---: | ---: |
| iOS Hermes bundle | 5,501,278 B | 5,544,499 B | +43,221 B (+0.79%) |
| Complete iOS export | 6,624,948 B | 6,668,169 B | +43,221 B |
| Bundled lesson fixture | — | 23,471 B | under 600 KB |

Desktop live receipt, real `next dev -p 3218`, `PORT` and `LH_PHONE_HOST` unset, isolated data, fake CLI on PATH:

```text
off (zero CLI calls)
→ needs-approval: https://login.tailscale.com/f/funnel?node=fake-node
→ approve fake node
→ listening: https://sample.tailnet.ts.net:8443, mode public
  automatic approval detection: 27,826.98 ms
→ disable: off, owned mapping removed, listener closed
```

- Total state walk: **61,219.76 ms**. Pairing URL contained the HTTPS base. Hello had only `app` and `version`. Chats forwarded with 200; unauthenticated Funnel-header request got 401; management via paired proxy got 403; revoked token got 401.
- Authenticated events proxy delivered its heartbeat after **25,041.50 ms**.
- Fifty sequential requests each: direct **p50 4.15 ms / p95 9.00 ms**; proxy **p50 4.39 ms / p95 6.49 ms**.
- CLI timeout test killed the fake process at its injected 150 ms deadline and completed within its 1,500 ms guard. Production deadlines are 3.5 seconds for status/Serve reads and 10 seconds for setup/removal.
- Mock live check: pair **49.21 ms**, list **2.55 ms**, teaching **21 frames / 745.39 ms**, practice **9 frames / 644.12 ms**, events ping **1.67 ms**.
- Twenty heaviest formulas: **p50 1.64 ms / p95 3.53 ms / max 18.44 ms**.
- Sample browser: Home **950.90 ms**, check submission and next recorded turn **1,240.76 ms**, lesson/practice navigation and result **2,461.26 ms**. **Zero API requests**, zero browser exceptions; saved computer credentials unchanged before, during, and after demo. API requests were blocked. Browser static assets still came from the local preview server.
- Existing browser regression: pairing/normalization **2,464.6 ms**; nothing due/empty sessions **861.3 ms**; 503 **67.5 ms**; unreachable **856.6 ms**; truncation **881.1 ms**; check targets **904.3 ms**; revocation **858.9 ms**. Titles measured **72 px**, check questions **40 px**, checked hit targets **44 pt**. Zero browser exceptions.
- All eight preview PNGs are **804×1748**, captured at **402×874, scale 2**. All four bundled fonts reported loaded. I inspected Pair v2 and sample Home beside the approved designs.
- Stopped every server started. Ports **3218, 4791, and 8084** were confirmed free with `ss` after cleanup.

| Screen | Preview path (relative to mobile/) | Comparison |
| --- | --- | --- |
| Pair v2 | `.preview/06-pair-v2.png` | Controls/copy align; CMU title is 80 pt tall and scanner is about 42 pt lower than Paper. |
| Sample Home | `.preview/01-home-sample.png` | Layout aligns; SAMPLE label and one actual lesson; CMU count is wider. |
| Home regression | `.preview/01-home.png` | Existing four-row preview retained. |
| Session regression | `.preview/02-session.png` | Recorded projection and maths render. |
| Check regression | `.preview/03-check.png` | Selected option, confidence and thinking render. |
| Practice regression | `.preview/04-practice.png` | Work and typeset maths render. |
| Result regression | `.preview/05-result.png` | Outcome and review rows render. |
| Pair regression | `.preview/06-pair.png` | Same Pair v2 layout. |

Detailed command outputs remain in `/tmp/lh-phone-root-final2.log`, `/tmp/lh-phone-build-final.log`, `/tmp/lh-phone-mobile-final3.log`, `/tmp/lh-phone-mobile-export.log`, `/tmp/lh-phone-state-walk.log`, `/tmp/lh-phone-mobile-live-final.log`, and `/tmp/lh-phone-browser-regression.log`. Browser receipts are `mobile/.preview/{public-browser,manual-browser,browser}.json`; screenshots are gitignored.

## Known limits and risks

- No real Tailscale, macOS firewall, iPhone, or Simulator was available. The fake CLI proves orchestration and real loopback HTTP forwarding; it cannot prove certificate issuance or public reachability on Daniel's Mac. Native camera, speech, keyboard/safe areas, and SVG baselines still need Mac/device review.
- EAS submission, Apple's Beta App Review, and publication of the public TestFlight link were not performed in this Linux lane.
- Sample practice is a scripted demonstration, not AI grading. The teaching recording is finite, and the demo resets when exited.
- Previously paired phones with a saved HTTP tailnet address must pair again to save the new HTTPS address. Stored device tokens are unchanged.
- Concurrent external Serve edits between a CLI read and mutation cannot be made transactional through these commands. Do not edit the same 8443 mapping while LearnHarness reconciles it. Foreign mappings observed in status are never changed.
- Background Funnel configuration can outlive a desktop crash; its loopback target closes with the app. Re-enabling adopts the exact owned mapping. Normal disable removes it and failed removal is retried.

## Reviewer: look here first

Review ownership checks and subprocess deadlines in `src/server/phone-funnel.ts`, then the public authentication boundary and bind-failure cleanup in `src/server/phone.ts`. Check demo credential isolation and native Web Stream responses next. For visual review, start with Pair's title/scanner offset and the sample Home PNG.

Commits before this report: `aa8ccb1`, `2108d93`, `f66bfd4`, `93d1f5f`, `04a2203`. Each has the requested co-author trailer. No push or external publication was performed.
