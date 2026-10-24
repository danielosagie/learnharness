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

The live check starts its own mock server, pairs through the net client, lists chats, replays a recorded stream, and reads an events heartbeat. The iOS Simulator is not available in this Linux worktree, so visual comparison against the Paper designs is a Mac review step.
