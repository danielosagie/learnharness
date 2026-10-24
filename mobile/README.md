# LearnHarness phone app

This is the iPhone client for a LearnHarness computer on the same Tailscale network. It uses the computer's `/api/phone/*` pairing endpoints and keeps the bearer token in iOS SecureStore. The app imports its domain projection and answer logic directly from `../src/core/`.

## Run against the mock on a Mac

From the repository root, in terminal 1:

```sh
node mobile/scripts/mock-server.mjs
```

The server prints an 8-character pairing code. In terminal 2:

```sh
cd mobile
npm install
npx expo start --dev-client
```

Open the iOS simulator development build, tap **Enter code instead**, enter `127.0.0.1` for the host and the code printed by the mock. The mock provides the recorded chain-rule session, due reviews, replayed turns, and a synthetic practice problem and result. On a physical iPhone, use the Mac's Tailscale IP or MagicDNS name instead of `127.0.0.1`; both devices must be on Tailscale.

A fresh development build is required after changing native dependencies. The `development` EAS profile targets the simulator. The `simulator` profile makes a release simulator build, and `production` is reserved for TestFlight after the EAS project is linked. This repo intentionally has no EAS project ID.

## Checks

```sh
cd mobile
flock /tmp/lh-gates.lock npx tsc --noEmit
flock /tmp/lh-gates.lock npm test
flock /tmp/lh-gates.lock npx expo-doctor
flock /tmp/lh-gates.lock npx expo export --platform ios
node --import tsx scripts/bench-math.mts
node --import tsx scripts/live-check.mts
```

The live check starts its own mock server, pairs through the net client, lists chats, replays a recorded stream, and reads an events heartbeat. The browser preview below provides the Linux visual loop; native device verification remains a Mac review step.

## Browser fidelity preview

The preview renders the same screens and shared domain projection as iOS. Platform files supply browser storage, an inert scanner, no-op speech, an iframe demo, and a simulated status area. Native builds continue to use SecureStore, the camera, on-device speech, WebView, and system safe areas. The browser is a development preview, not a supported deployment target.

From `mobile/`, export and serve the browser bundle:

```sh
flock /tmp/lh-gates.lock npx expo export --platform web --output-dir .preview/web
node scripts/serve-preview.mjs
```

In another terminal, from the repository root:

```sh
PHONE_PREVIEW=1 MOCK_PAIR_CODE=ABCD1234 node mobile/scripts/mock-server.mjs
```

Open `http://localhost:8084`, choose **Enter code instead**, enter `127.0.0.1` and `ABCD1234`. The mock's opt-in preview states include a lesson, a pending practice problem, and a result at `/session/preview-lesson`, `/session/preview-practice`, and `/session/preview-result`. The normal mock still replays the recorded teaching turns and creates practice cycles.

Capture all six screens through actual UI interactions:

```sh
NODE_PATH=/home/daniel/CodeProjects/scout/node_modules node mobile/scripts/preview.cjs
```

The script uses Chromium at `~/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome`, sets **402 × 874, deviceScaleFactor 2**, and writes `mobile/.preview/01-home.png` through `06-pair.png`, plus font-loading and browser-error receipts. `PREVIEW_URL` can override the browser URL. For live editing, `cd mobile && npx expo start --web --port 8084` can replace the export and static server.

Stop the mock before running gates: the desktop phone tests and live checks also bind port 4791. The desktop port regression can be checked against a real isolated Next server without any model calls:

```sh
flock /tmp/lh-gates.lock node mobile/scripts/check-desktop-port.mjs
```

It starts `next dev -p 3218` with `PORT` unset and temporary data, pairs, forwards a chats request, revokes the phone, verifies 401, then stops its server and removes its data. Native camera permissions, speech, keyboard behavior, and final native SVG baselines still need an iPhone or iOS Simulator check.

With the preview and preview mock running, the browser state checks use the same Playwright installation:

```sh
NODE_PATH=/home/daniel/CodeProjects/scout/node_modules node mobile/scripts/check-preview.cjs
```

They exercise manual-code normalization, no pairing, no reviews, empty sessions, 503, unreachable computer, two-line truncation, and revocation. Measured receipts go to `mobile/.preview/manual-browser.json`.
