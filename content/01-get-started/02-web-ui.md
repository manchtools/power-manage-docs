---
title: The web UI
---
# The web UI

The web UI is a separate administrative client. It consumes only the published
TypeScript RPC contract and does not own fleet state, dispatch, audit history,
or agent traffic.

## Connecting

Open **{{WEB_UI_URL}}**, enter your control-server API address, and authenticate
through the configured OIDC provider. Power Manage has no local password or
TOTP login.

The browser sends API requests directly to control. Configure control's CORS
allowlist for the UI origin. OIDC redirect URLs must match the provider and
control allowlists.

## Interaction model

- The top-center context pill owns navigation and morphs into global search.
- Command-K opens global search.
- Work surfaces can move, minimize, and remain alive across navigation.
- Minimized work is grouped in a stage-manager-style area.
- Terminal windows remain connected for the terminal session.

The UI renders only state exposed by real RPCs. It does not invent rollout
stages, hidden history, or analytics APIs.

## Self-hosting

The server exposes the stable Connect-RPC API. Operators who need a different
or fully on-premise client can build against the published Go and TypeScript
contracts.

## Next steps

- [Quick start](/get-started/quick-start)
- [Installation](/get-started/installation)
- [SSO / OIDC](/concepts/sso)
