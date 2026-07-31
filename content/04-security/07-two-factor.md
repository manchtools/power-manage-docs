---
title: Identity-provider MFA
label: MFA
---
# Identity-provider MFA

Power Manage does not implement local passwords, TOTP, backup codes, or
WebAuthn. Human login is OIDC, and MFA policy belongs to the identity provider.

Require MFA, phishing-resistant factors, recovery policy, and conditional
access in the IdP. Power Manage verifies the resulting OIDC flow and applies
its own authorization after login; it does not duplicate the factor ceremony.

The host-authorized bootstrap-admin URL is single-use and short-lived. It is a
setup mechanism, not an MFA fallback or daily administrator account.
