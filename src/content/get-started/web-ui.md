# The web UI

The Power Manage server doesn't ship with a web UI. It exposes a Connect-RPC API. The UI is a separate hosted service you point at your control server.

If you brought the stack up and went looking for a sign-in page on `control.example.com`, that's why there isn't one.

{% callout type="info" title="Where to find it" %}
The hosted web UI lives at **{{WEB_UI_URL}}**. Open it, enter your control-server domain (`control.example.com`), and sign in with the admin credentials from setup.
{% /callout %}

## The trust model

The web UI is a thin client. The host that serves you the SPA doesn't see your fleet's data.

The web host serves static files plus a small proxy for two things browsers refuse to do directly: OIDC callbacks, and asset rewriting for proxied avatars and screenshots. Everything else runs entirely in your browser. The JWT that authenticates you is issued by your control server, stored in your browser, and the web host never receives it. Database, event store, projections, action dispatches, agent traffic: all on your infrastructure.

The web UI is a managed service. It's not open-source and not shipped for self-hosting. If you need an on-premise client (compliance, custom workflows, integration with internal tooling), build your own against the Connect-RPC API. Proto definitions in [`manchtools/power-manage-sdk`](https://github.com/manchtools/power-manage-sdk) are the stable contract and generated TypeScript / Go clients ship from the same set.

## Why a separate UI?

Decoupled release cadence. The Connect-RPC surface is the stable contract; the UI iterates faster than the protocol changes. A UI bugfix doesn't require a server upgrade.

Smaller server footprint. Operators who only want the API (CLI-only deployments, automation, integrations) don't carry a frontend build pipeline they aren't using.

One UI, many servers. The same hosted UI connects to dev, staging, and production by changing the URL field on the sign-in screen. Support staff jumping between tenants don't need to remember three different bookmarks.

Static hosting. The UI is a SPA. Static-plus-tiny-proxy is much cheaper and more available than hosting a stateful application server.

## What the host actually proxies

Two things.

**OIDC redirect.** Identity providers don't always handle fragment-based callbacks well, so the OIDC redirect lands on the web host and the code gets forwarded to your control server. Your provider's `redirect_uri` allowlist needs the web host, not your control server.

**Asset rewriting** for avatars and screenshots referenced by external URL, so the SPA doesn't have to do CORS preflights against arbitrary user-provided origins.

That's it. RPCs, file uploads, event subscriptions, the terminal WebSocket: all of those connect from your browser to your control server with no intermediary.

## CORS and your control server

Your control server needs to allow the web UI's origin on its CORS allowlist. The default config covers `{{WEB_UI_URL}}`. If you've built your own client on a different origin, add it via `CONTROL_CORS_ALLOWED_ORIGINS` in `.env`:

```bash
CONTROL_CORS_ALLOWED_ORIGINS={{WEB_UI_URL}},https://ui.example.com
```

If sign-in fails with a network error and the browser console reports a CORS rejection, this is the setting to check.

## Next steps

- [Quick start](/get-started/quick-start) once you can sign in
- [Architecture](/concepts/architecture) for where the web UI sits in the topology
