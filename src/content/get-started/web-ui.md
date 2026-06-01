# The web UI

The power-manage server doesn't ship with a web UI. It exposes a Connect-RPC API. The UI is a separate hosted service you point at your control server.

If you brought the stack up and went looking for a sign-in page on `control.example.com`, that's why there isn't one.

{% callout type="info" title="Where to find it" %}
The hosted web UI lives at **{{WEB_UI_URL}}**. Open it, enter your control-server domain (`control.example.com`), and sign in with the admin credentials from setup.
{% /callout %}

## The trust model

The web UI is a thin client. The host that serves you the SPA never sees your fleet's data or the JWT that authenticates you against your control server.

After sign-in, every RPC the UI makes (listing devices, dispatching actions, opening a terminal WebSocket, subscribing to events) goes **directly** from your browser to your control server. The JWT lives in your browser, is sent on those requests as a Bearer token, and never transits the web host. Database, event store, projections, action dispatches, agent traffic: all on your infrastructure.

**The one exception is the OIDC sign-in flow.** The OAuth provider's redirect lands on the web host (because the host you brought up at `control.example.com` isn't where the OIDC `redirect_uri` is configured; see "OIDC redirect" below). For the duration of that single redirect, the OAuth `code` + `state` briefly transit the web host before the UI exchanges them with your control server. If you don't trust the web host to not log that code during its short transit, the only mitigation is to run your own UI. See the next paragraph.

The web UI is a managed service. It's not open-source and not shipped for self-hosting today. If you need a fully on-premise client (regulated compliance regime, your own integration tooling, or simply wanting to fully control the OIDC redirect path), build your own against the Connect-RPC API. Proto definitions in [`manchtools/power-manage-sdk`](https://github.com/manchtools/power-manage-sdk) are the stable contract and generated TypeScript / Go clients ship from the same set.

## Why a separate UI?

The honest answer is sustainability. Keeping the UI as a managed service is what makes it possible to add paid features down the line and license a standalone build to companies that need full on-premise. The project's commitment: if it stops being actively maintained, the UI gets released under an open-source license alongside the server.

Beyond the business angle, the technical side is real too: the Connect-RPC surface is the stable contract; the UI can iterate faster than the protocol because operators don't have to upgrade their server stack to get UI fixes. Operators who only want the API (CLI-only deployments, automation pipelines, integrations) don't carry a frontend build they aren't using.

## What the host actually proxies

Two things.

**OIDC redirect.** Most identity providers want a fixed allowlisted `redirect_uri` they trust ahead of time. The web host is the one well-known address that every operator's SPA shares, so the provider's callback lands here and the UI forwards the code to whichever control server the operator is signed into. The JWT exchange itself happens browser↔control; the web host only sees the OAuth code for the milliseconds between provider redirect and UI handoff.

**Asset rewriting** for image URLs that the UI displays (avatars, screenshots referenced by an external URL in audit events). The rewrite serves them through the web host's origin so the SPA doesn't trigger mixed-content warnings on third-party origins.

That's it. RPCs, event subscriptions, the terminal WebSocket: all of those connect from your browser to your control server with no intermediary.

## CORS and your control server

Your control server needs to allow the web UI's origin on its CORS allowlist. The default config covers `{{WEB_UI_URL}}`. If you've built your own client on a different origin, add it via `CONTROL_CORS_ORIGINS` in `.env`:

```bash
CONTROL_CORS_ORIGINS={{WEB_UI_URL}},https://ui.example.com
```

If sign-in fails with a network error and the browser console reports a CORS rejection, this is the setting to check.

## Next steps

- [Quick start](/get-started/quick-start) once you can sign in
- [Architecture](/concepts/architecture) for where the web UI sits in the topology
