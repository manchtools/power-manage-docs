---
title: "Server specification"
status: implemented
order: 10
description: Complete architecture, RPC surface (164 RPCs), event type catalog (93 types), database schema (14 migrations), and internal package map for the power-manage control, gateway, and indexer servers.
---

# power-manage-server

## Architecture

Three Go services sharing a Postgres event store and a Valkey/Redis task
queue. Only the control server writes to Postgres. The gateway is stateless
(no DB, no credentials). The indexer is read-only.

| Service | Port | Protocol | Auth | Role |
|---------|------|----------|------|------|
| Control | 8081 | HTTPS + Connect-RPC | JWT (+ TOTP) | Reads + writes Postgres; serves web UI API |
| Control (internal) | 8082 | HTTPS + mTLS | Client cert | InternalService for gateway proxy |
| Gateway | 8080 | HTTPS + bidirectional stream | Agent mTLS | Agent connections, action dispatch |
| Gateway (terminal) | 8443 | WSS | JWT | Remote terminal WebSocket |
| Indexer | — | (background) | — | RediSearch index reconciliation |

### Data flow

```
Browser → [JWT] → Control → [AppendEvent] → Postgres
                                  ↓
Control → [enqueue Asynq task] → Valkey → [dequeue] → Gateway → [mTLS stream] → Agent
Agent → [stream result] → Gateway → [InternalService proxy] → Control → [AppendEvent] → Postgres
Indexer → [read Postgres] → [FT.CREATE/SEARCH] → Valkey
```

## RPC catalog

The `ControlService` exposes 164 RPCs. Every RPC handler in
`server/internal/api/` validates input at the boundary (proto interceptor)
AND at the handler level, enforces authorization, and appends immutable
events.

### Authentication (7 RPCs)

| RPC | Handler file |
|-----|-------------|
| `Register` | `registration_handler.go` |
| `Login` | `auth_handler.go` |
| `RefreshToken` | `auth_handler.go` |
| `Logout` | `auth_handler.go` |
| `GetCurrentUser` | `auth_handler.go` |
| `RenewCertificate` | `certificate_handler.go` |
| `VerifyLoginTOTP` | `totp_handler.go` |

### TOTP / 2FA (6 RPCs)

| RPC | Handler file |
|-----|-------------|
| `SetupTOTP` | `totp_handler.go` |
| `VerifyTOTP` | `totp_handler.go` |
| `DisableTOTP` | `totp_handler.go` |
| `AdminDisableUserTOTP` | `totp_handler.go` |
| `GetTOTPStatus` | `totp_handler.go` |
| `RegenerateBackupCodes` | `totp_handler.go` |

### SSO / Identity Providers (11 RPCs)

| RPC | Handler file |
|-----|-------------|
| `ListAuthMethods` | `sso_handler.go` |
| `GetSSOLoginURL` | `sso_handler.go` |
| `SSOCallback` | `sso_handler.go` |
| `CreateIdentityProvider` | `idp_handler.go` |
| `GetIdentityProvider` | `idp_handler.go` |
| `ListIdentityProviders` | `idp_handler.go` |
| `UpdateIdentityProvider` | `idp_handler.go` |
| `DeleteIdentityProvider` | `idp_handler.go` |
| `ListIdentityLinks` | `identity_link_handler.go` |
| `UnlinkIdentity` | `identity_link_handler.go` |

### SCIM (3 RPCs)

| RPC | Handler file |
|-----|-------------|
| `EnableSCIM` | `idp_handler.go` |
| `DisableSCIM` | `idp_handler.go` |
| `RotateSCIMToken` | `idp_handler.go` |

### Users (12 RPCs)

| RPC | Handler file |
|-----|-------------|
| `CreateUser` | `user_handler.go` |
| `GetUser` | `user_handler.go` |
| `ListUsers` | `user_handler.go` |
| `UpdateUserEmail` | `user_handler.go` |
| `UpdateUserPassword` | `user_handler.go` |
| `SetUserDisabled` | `user_handler.go` |
| `UpdateUserProfile` | `user_handler.go` |
| `UpdateUserLinuxUsername` | `user_handler.go` |
| `AddUserSshKey` | `user_handler.go` |
| `RemoveUserSshKey` | `user_handler.go` |
| `UpdateUserSshSettings` | `user_handler.go` |
| `DeleteUser` | `user_handler.go` |

### Devices (8 RPCs)

| RPC | Handler file |
|-----|-------------|
| `ListDevices` | `device_handler.go` |
| `GetDevice` | `device_handler.go` |
| `SetDeviceLabel` | `device_handler.go` |
| `RemoveDeviceLabel` | `device_handler.go` |
| `AssignDevice` | `device_handler.go` |
| `UnassignDevice` | `device_handler.go` |
| `ListDeviceAssignees` | `device_handler.go` |
| `SetDeviceSyncInterval` | `device_handler.go` |
| `DeleteDevice` | `device_handler.go` |

### Tokens (5 RPCs)

| RPC | Handler file |
|-----|-------------|
| `CreateToken` | `token_handler.go` |
| `GetToken` | `token_handler.go` |
| `ListTokens` | `token_handler.go` |
| `RenameToken` | `token_handler.go` |
| `SetTokenDisabled` | `token_handler.go` |
| `DeleteToken` | `token_handler.go` |

### Actions (8 RPCs)

| RPC | Handler file |
|-----|-------------|
| `CreateAction` | `action_handler.go`, `action_crud.go` |
| `GetAction` | `action_handler.go` |
| `ListActions` | `action_handler.go` |
| `RenameAction` | `action_handler.go` |
| `UpdateActionDescription` | `action_handler.go` |
| `UpdateActionParams` | `action_handler.go` |
| `DeleteAction` | `action_handler.go` |

### Action Sets (10 RPCs)

| RPC | Handler file |
|-----|-------------|
| `CreateActionSet` | `action_set_handler.go` |
| `GetActionSet` | `action_set_handler.go` |
| `ListActionSets` | `action_set_handler.go` |
| `RenameActionSet` | `action_set_handler.go` |
| `UpdateActionSetDescription` | `action_set_handler.go` |
| `UpdateActionSetSchedule` | `action_set_handler.go` |
| `DeleteActionSet` | `action_set_handler.go` |
| `AddActionToSet` | `action_set_handler.go` |
| `RemoveActionFromSet` | `action_set_handler.go` |
| `ReorderActionInSet` | `action_set_handler.go` |

### Definitions (11 RPCs)

| RPC | Handler file |
|-----|-------------|
| `CreateDefinition` | `definition_handler.go` |
| `GetDefinition` | `definition_handler.go` |
| `ListDefinitions` | `definition_handler.go` |
| `RenameDefinition` | `definition_handler.go` |
| `UpdateDefinitionDescription` | `definition_handler.go` |
| `UpdateDefinitionSchedule` | `definition_handler.go` |
| `DeleteDefinition` | `definition_handler.go` |
| `AddActionSetToDefinition` | `definition_handler.go` |
| `RemoveActionSetFromDefinition` | `definition_handler.go` |
| `ReorderActionSetInDefinition` | `definition_handler.go` |

### Device Groups (14 RPCs)

| RPC | Handler file |
|-----|-------------|
| `CreateDeviceGroup` | `device_group_handler.go` |
| `GetDeviceGroup` | `device_group_handler.go` |
| `ListDeviceGroups` | `device_group_handler.go` |
| `ListDeviceGroupsForDevice` | `device_group_handler.go` |
| `RenameDeviceGroup` | `device_group_handler.go` |
| `UpdateDeviceGroupDescription` | `device_group_handler.go` |
| `UpdateDeviceGroupQuery` | `device_group_handler.go` |
| `DeleteDeviceGroup` | `device_group_handler.go` |
| `AddDeviceToGroup` | `device_group_handler.go` |
| `RemoveDeviceFromGroup` | `device_group_handler.go` |
| `ValidateDynamicQuery` | `device_group_handler.go` |
| `EvaluateDynamicGroup` | `device_group_handler.go` |
| `SetDeviceGroupSyncInterval` | `device_group_handler.go` |
| `SetDeviceGroupMaintenanceWindow` | `device_group_handler.go` |

### Assignments (7 RPCs)

| RPC | Handler file |
|-----|-------------|
| `CreateAssignment` | `assignment_handler.go` |
| `DeleteAssignment` | `assignment_handler.go` |
| `ListAssignments` | `assignment_handler.go` |
| `GetDeviceAssignments` | `assignment_handler.go` |
| `GetUserAssignments` | `assignment_handler.go` |
| `SetUserSelection` | `user_selection_handler.go` |

### Dispatch (10 RPCs)

| RPC | Handler file |
|-----|-------------|
| `ListAvailableActions` | `action_dispatch.go` |
| `DispatchAction` | `action_dispatch.go` |
| `DispatchToMultiple` | `action_dispatch.go` |
| `DispatchAssignedActions` | `action_dispatch.go` |
| `DispatchActionSet` | `action_dispatch.go` |
| `DispatchDefinition` | `action_dispatch.go` |
| `DispatchToGroup` | `action_dispatch.go` |
| `DispatchInstantAction` | `action_dispatch.go` |
| `CancelExecution` | `action_dispatch.go` |
| `GetExecution` | `action_dispatch.go` |
| `ListExecutions` | `action_dispatch.go` |

### Audit (1 RPC)

| RPC | Handler file |
|-----|-------------|
| `ListAuditEvents` | `audit_handler.go` |

### LUKS / Secrets (5 RPCs)

| RPC | Handler file |
|-----|-------------|
| `GetDeviceLpsPasswords` | `internal_handler.go` (proxy) |
| `GetDeviceLuksKeys` | `internal_handler.go` (proxy) |
| `CreateLuksToken` | `luks_action.go` |
| `RevokeLuksDeviceKey` | `device_handler.go` |

### OSQuery / Inventory (4 RPCs)

| RPC | Handler file |
|-----|-------------|
| `DispatchOSQuery` | `osquery_handler.go` |
| `GetOSQueryResult` | `osquery_handler.go` |
| `GetDeviceInventory` | `osquery_handler.go` |
| `RefreshDeviceInventory` | `osquery_handler.go` |

### Logs (2 RPCs)

| RPC | Handler file |
|-----|-------------|
| `QueryDeviceLogs` | `logs_handler.go` |
| `GetDeviceLogResult` | `logs_handler.go` |

### Roles (7 RPCs)

| RPC | Handler file |
|-----|-------------|
| `CreateRole` | `role_handler.go` |
| `GetRole` | `role_handler.go` |
| `ListRoles` | `role_handler.go` |
| `UpdateRole` | `role_handler.go` |
| `DeleteRole` | `role_handler.go` |
| `AssignRoleToUser` | `role_handler.go` |
| `RevokeRoleFromUser` | `role_handler.go` |
| `ListPermissions` | `role_handler.go` |

### User Groups (14 RPCs)

| RPC | Handler file |
|-----|-------------|
| `CreateUserGroup` | `user_group_handler.go` |
| `GetUserGroup` | `user_group_handler.go` |
| `ListUserGroups` | `user_group_handler.go` |
| `UpdateUserGroup` | `user_group_handler.go` |
| `DeleteUserGroup` | `user_group_handler.go` |
| `AddUserToGroup` | `user_group_handler.go` |
| `RemoveUserFromGroup` | `user_group_handler.go` |
| `AssignRoleToUserGroup` | `user_group_handler.go` |
| `RevokeRoleFromUserGroup` | `user_group_handler.go` |
| `ListUserGroupsForUser` | `user_group_handler.go` |
| `UpdateUserGroupQuery` | `user_group_handler.go` |
| `ValidateUserGroupQuery` | `user_group_handler.go` |
| `EvaluateDynamicUserGroup` | `user_group_handler.go` |
| `SetUserGroupMaintenanceWindow` | `user_group_handler.go` |

### Compliance (9 RPCs)

| RPC | Handler file |
|-----|-------------|
| `GetDeviceCompliance` | `compliance_handler.go` |
| `CreateCompliancePolicy` | `compliance_policy_handler.go` |
| `GetCompliancePolicy` | `compliance_policy_handler.go` |
| `ListCompliancePolicies` | `compliance_policy_handler.go` |
| `RenameCompliancePolicy` | `compliance_policy_handler.go` |
| `UpdateCompliancePolicyDescription` | `compliance_policy_handler.go` |
| `DeleteCompliancePolicy` | `compliance_policy_handler.go` |
| `AddCompliancePolicyRule` | `compliance_policy_handler.go` |
| `RemoveCompliancePolicyRule` | `compliance_policy_handler.go` |
| `UpdateCompliancePolicyRule` | `compliance_policy_handler.go` |
| `GetDeviceCompliancePolicyStatus` | `compliance_handler.go` |

### Search (2 RPCs)

| RPC | Handler file |
|-----|-------------|
| `Search` | `search_handler.go` |
| `RebuildSearchIndex` | `search_handler.go` |

### Settings (4 RPCs)

| RPC | Handler file |
|-----|-------------|
| `GetServerSettings` | `settings_handler.go` |
| `UpdateServerSettings` | `settings_handler.go` |
| `SetUserProvisioningEnabled` | `settings_handler.go` |

### Terminal (4 RPCs)

| RPC | Handler file |
|-----|-------------|
| `StartTerminal` | `terminal_handler.go` |
| `StopTerminal` | `terminal_handler.go` |
| `ListActiveTerminalSessions` | `terminal_handler.go` |
| `TerminateTerminalSession` | `terminal_handler.go` |

## Event type catalog

93 event types recorded in the `events` table. Each event type has a
corresponding payload struct in `internal/eventtypes/payloads/` that
serves as the single source of truth for the JSON wire format. Postgres
triggers project these into `*_projection` tables.

### Auth events (6)

`UserLoggedIn`, `UserCreatedWithRoles`, `UserPasswordChanged`,
`RegistrationTokenConsumed`, `CertificateRenewed`,
`TOTPSetupInitiated`, `TOTPBackupCodesRegenerated`

### User lifecycle events (9)

`UserEmailChanged`, `UserProfileUpdated`, `UserLinuxUsernameChanged`,
`UserSshKeyAdded`, `UserSshKeyRemoved`, `UserSshSettingsUpdated`,
`UserProvisioningSettingsUpdated`, `UserSelectionChanged`,
`UserSystemActionLinked`

### Role events (3)

`RoleCreated`, `RoleUpdated`, `UserRoleAssigned`, `UserRoleRevoked`,
`UserRoleChanged`

### User group events (6)

`UserGroupCreated`, `UserGroupUpdated`,
`UserGroupMemberAdded`, `UserGroupMemberRemoved`,
`UserGroupRoleAssigned`, `UserGroupRoleRevoked`,
`UserGroupQueryUpdated`, `UserGroupMaintenanceWindowSet`

### Identity provider events (3)

`IdentityProviderCreated`, `IdentityProviderSCIMEnabled`,
`IdentityProviderSCIMTokenRotated`

### Identity link events (2)

`IdentityLinked`, `IdentityLinkLoginUpdated`, `IdentityUnlinked`

### Device events (5)

`DeviceRegistered`, `DeviceSeen`, `DeviceHeartbeat`,
`DeviceLabelSet`, `DeviceLabelRemoved`, `DeviceLabelsUpdated`,
`DeviceSyncIntervalSet`, `DeviceCertRenewed`

### Device group events (7)

`DeviceGroupCreated`, `DeviceGroupRenamed`,
`DeviceGroupDescriptionUpdated`, `DeviceGroupQueryUpdated`,
`DeviceGroupMemberAdded`, `DeviceGroupMemberRemoved`,
`DeviceGroupSyncIntervalSet`, `DeviceGroupMaintenanceWindowSet`

### Token events (1)

`TokenRenamed`

### Action events (4)

`ActionCreated`, `ActionRenamed`, `ActionDescriptionUpdated`,
`ActionParamsUpdated`

### Action set events (4)

`ActionSetRenamed`, `ActionSetDescriptionUpdated`,
`ActionSetMemberAdded`, `ActionSetMemberRemoved`,
`ActionSetMemberReordered`

### Definition events (4)

`DefinitionRenamed`, `DefinitionDescriptionUpdated`,
`DefinitionMemberAdded`, `DefinitionMemberRemoved`,
`DefinitionMemberReordered`

### Assignment events (3)

`AssignmentCreated`, `AssignmentModeChanged`,
`AssignmentSortOrderChanged`, `DeviceUserAssignment`,
`DeviceGroupAssignment`

### Execution events (7)

`ExecutionCreated`, `ExecutionScheduled`, `ExecutionDispatched`,
`ExecutionTerminal`, `ExecutionReason`, `ExecutionFailedReason`,
`ExecutionFailedCompensating`, `ExecutionTimedOut`

### Command output events (1)

`CommandOutput`, `OutputChunk`

### LUKS events (4)

`LuksKeyRotated`, `LuksDeviceKeyRevocationRequested`,
`LuksDeviceKeyRevocationDispatched`, `LuksDeviceKeyRevoked`,
`LuksDeviceKeyRevocationFailed`

### LPS events (1)

`LpsPasswordRotated`

### Compliance events (6)

`CompliancePolicyCreated`, `CompliancePolicyRenamed`,
`CompliancePolicyDescriptionUpdated`,
`CompliancePolicyRuleAdded`, `CompliancePolicyRuleRemoved`,
`CompliancePolicyRuleUpdated`

### Terminal events (4)

`TerminalSessionStarted`, `TerminalSessionStopped`,
`TerminalSessionTerminated`, `TerminalAdminMembershipRevoked`

### Settings events (1)

`ServerSettingUpdated`

### Security events (1)

`SecurityAlert`

## Database schema

14 Goose migrations in `server/internal/store/migrations/`:

| # | File | Content |
|---|------|---------|
| 001 | `extensions.sql` | pgcrypto, ulid extensions |
| 002 | `event_store.sql` | `events` table (append-only), stream/actor/occurred_at indexing |
| 003 | `identity.sql` | `user_projection`, `role_projection`, `token_projection`, auth tables |
| 004 | `devices.sql` | `device_projection`, enrollment, labels, certificates |
| 005 | `groups_assignments.sql` | `user_group_projection`, `device_group_projection`, `assignment_projection` |
| 006 | `actions_compliance.sql` | `action_projection`, `action_set_projection`, `definition_projection`, `execution_projection`, `compliance_policy_projection` |
| 007 | `foreign_keys.sql` | FK constraints added after data migration |
| 008 | `seeds.sql` | System roles (Admin, User), system actions, admin policy seeds |
| 009 | `role_permission_split_7.sql` | Permission column split for granular RBAC |
| 010 | `role_grant_scope_7.sql` | `:self` / `:assigned` scope grants |
| 011 | `events_append_only.sql` | REVOKE on events table, trigger hardening |
| 012 | `idp_trust_email_assertions.sql` | IdP email assertion trust flag |
| 013 | `luks_token_hash.sql` | LUKS token hash column |
| 014 | `reconciler_owned_role_permissions.sql` | Reconciler role permission ownership |

### Projection tables

Each domain aggregate has a projection table with a corresponding
`*_projection` naming convention. Go-side projector listeners
(`internal/projectors/`) react to committed events for cross-cutting
concerns.

## Internal package map (detailed)

### `internal/api/` — Control server RPC handlers (52 files)

| File | Purpose |
|------|---------|
| `action_crud.go` | Action create/read/update/delete |
| `action_dispatch.go` | Dispatch actions to devices/groups |
| `action_handler.go` | Action handler constructor + wiring |
| `action_params.go` | Action parameter validation |
| `action_schedule.go` | Action scheduling (deferred dispatch) |
| `action_set_handler.go` | Action set CRUD + member management |
| `action_validators.go` | Per-action-type parameter validators |
| `admin_guard.go` | System Admin role protection (can't delete/rename/revoke Admin) |
| `assignment_handler.go` | Assignment CRUD |
| `audit_handler.go` | Audit log query |
| `auth_handler.go` | Login, refresh, logout, GetCurrentUser |
| `certificate_handler.go` | Agent certificate renewal |
| `compliance_handler.go` | Device compliance status |
| `compliance_policy_handler.go` | Compliance policy CRUD + rules |
| `deadline_interceptor.go` | Per-RPC deadline enforcement |
| `definition_handler.go` | Definition CRUD + member management |
| `device_group_handler.go` | Device group CRUD + membership + dynamic query |
| `device_handler.go` | Device CRUD + labels + assignment |
| `errors.go` | Error sentinels + internalError helper |
| `gateway_binding.go` | Gateway-to-device binding verification |
| `handler_base.go` | Base handler struct + common dependencies |
| `helpers.go` | requireAuth, handleGetError, scope helpers |
| `identity_link_handler.go` | Identity link listing + unlinking |
| `idp_handler.go` | Identity provider CRUD + SCIM enable/disable/rotate |
| `internal_handler.go` | InternalService RPC implementations (gateway proxy) |
| `logging_interceptor.go` | Request logging interceptor |
| `logs_handler.go` | Device log query + result retrieval |
| `maintenance_window.go` | Maintenance window validation |
| `osquery_handler.go` | OSQuery dispatch + inventory |
| `registration_handler.go` | User registration |
| `role_handler.go` | Role CRUD + permission list + role assignment |
| `scope_grant.go` | Scope grant data types |
| `scope_resolver.go` | Scope resolution logic |
| `search_handler.go` | Search + rebuild index |
| `search_listener.go` | Event listener → RediSearch index update |
| `service.go` | Service wiring (constructors, dependency injection) |
| `settings_handler.go` | Server settings read/write + propagation |
| `sso_handler.go` | SSO login URL + callback |
| `stream_signing.go` | HMAC signing for stream RPC envelopes |
| `system_actions.go` | System action management (terminal admin, SSH, TTY) |
| `system_actions_listener.go` | Event listener → system action sync |
| `system_actions_scoped.go` | Scoped system action queries |
| `system_action_store.go` | System action persistence |
| `terminal_handler.go` | Terminal session start/stop/list/terminate |
| `terminal_revocation_listener.go` | Event listener → terminal session revocation |
| `token_handler.go` | Token CRUD |
| `totp_handler.go` | TOTP setup, verify, disable, backup codes |
| `user_group_handler.go` | User group CRUD + membership + dynamic query |
| `user_handler.go` | User CRUD + SSH keys + profile |
| `user_selection_handler.go` | User selection (action filtering per user) |
| `util.go` | Shared utility functions |
| `validation_interceptor.go` | Proto validation interceptor (bufvalidate) |
| `validator.go` | Custom validators |

### `internal/store/` — Event store and persistence (57 files)

| File | Purpose |
|------|---------|
| `store.go` | Core Store interface — AppendEvent, Queries, Repos, listener dispatch |
| `eventstore.go` | AppendEvent implementation + trigger notification |
| `repos.go` | Repository aggregator struct |
| `rebuild.go` | Projection rebuild from event stream |
| `notfound.go` | IsNotFound helper (wraps sql.ErrNoRows + domain sentinels) |
| `scope_filter.go` | Scope-based query filtering |
| `action.go`, `action_set.go` | Action/action-set repository interfaces |
| `assignment.go` | Assignment repository interface |
| `auth_state.go` | Auth state (TOTP, refresh tokens) |
| `compliance.go` | Compliance repository interface |
| `definition.go` | Definition repository interface |
| `device.go` | Device repository interface |
| `device_group.go` | Device group repository interface |
| `execution.go` | Execution repository interface |
| `identity_link.go` | Identity link repository interface |
| `identity_provider.go` | Identity provider repository interface |
| `inventory.go`, `logs.go` | Inventory + logs repository interfaces |
| `lps.go`, `luks.go` | LPS password + LUKS key repository interfaces |
| `osquery.go` | OSQuery repository interface |
| `revoked_token.go` | Revoked token repository |
| `role.go` | Role repository interface |
| `scim.go` | SCIM repository interface |
| `settings.go` | Settings repository interface |
| `terminal_session.go` | Terminal session repository |
| `token.go` | Token repository interface |
| `totp.go` | TOTP repository interface |
| `user.go` | User repository interface |
| `user_group.go` | User group repository interface |
| `user_selection.go` | User selection repository interface |
| `postgres/` | 24 Postgres-specific repository implementations |
| `migrations/` | 14 Goose SQL migration files + embed.go |
| `queries/` | sqlc-annotated SQL query files |
| `generated/` | sqlc-generated code (never hand-edited) |

### Remaining packages

| Package | Purpose |
|---------|---------|
| `internal/auth` | JWT, RBAC enforcement, `:self`/`:assigned` scopes, TOTP, rate limiting, interceptors |
| `internal/ca` | Certificate signing, verification, chain validation |
| `internal/connection` | Gateway connection registry (which gateway holds which agent) |
| `internal/control` | Asynq inbox worker — processes agent events from gateway |
| `internal/crypto` | AES-GCM encryption/decryption with domain-separated info tags |
| `internal/gateway` | Per-device Asynq task handlers for action dispatch |
| `internal/handler` | Gateway RPC handlers — agent stream, terminal, LUKS proxy, control proxy |
| `internal/idp` | OIDC provider integration — auth code flow, token exchange, user linking |
| `internal/middleware` | HTTP middleware — request ID, logging, recovery |
| `internal/mtls` | mTLS configuration for gateway + internal service |
| `internal/projectors` | Go-side event listeners that react to committed events |
| `internal/resolution` | Assignment resolution — which devices get which actions |
| `internal/scim` | SCIM v2 provisioning server |
| `internal/search` | RediSearch index management + query building |
| `internal/taskqueue` | Asynq client, task type constants, HMAC-signed payloads |
| `internal/terminal` | Terminal session token minting, validation, revocation |
| `internal/compliance` | Compliance policy evaluation |
| `internal/config` | Configuration loading + validation |
| `internal/crl` | Certificate revocation list management |
| `internal/dynamicquery` | Dynamic group query language parser |
| `internal/dyngroupeval` | Dynamic group query evaluator |
| `internal/archtest` | Architecture fitness functions (CI) |
| `internal/testutil` | Test infrastructure — Postgres containers, factories |
| `internal/actionparams` | Action parameter construction helpers |
| `internal/asynqutil` | Asynq utility functions |
| `internal/eventtypes` | Event type payload structs (93 types) + types.go constants |

## Invariants

1. **No `context.Background()` in request paths.** Two known findings in
   background goroutines (terminal_revocation_listener.go:96,
   settings_handler.go:128) — queued for lifecycle-context injection fix.
2. **Every proto field crossing a trust boundary carries `@gotags validate` tag.**
3. **Every handler validates at boundary (interceptor) + handler level.**
4. **Every `.catch()` logs at minimum debug level.**
5. **No secrets in log fields.**
6. **All crypto calls carry domain-separation info tags.**
7. **Every mutation has owner-scoped WHERE clause.**
8. **Non-owner access returns NotFound, never PermissionDenied.**
9. **Every state-changing RPC is audit-logged.**
10. **IDs are ULIDs. Never `crypto.randomUUID()`.**
11. **Never `math/rand` for cryptographic purposes.**
12. **Generated code regenerated from source, never hand-edited.**
13. **Events are append-only.** REVOKE on events table, trigger-enforced.
14. **Postgres as single writer.** Only the control server writes. Gateway
    and indexer are read-only or have no DB access.

## ADR index

23 Architecture Decision Records in `server/docs/adr/`:

| # | Decision |
|---|----------|
| 0000 | Terminal admin threat model |
| 0001 | AES key rotation strategy |
| 0002 | Architectural fitness functions |
| 0003 | Action signing — full envelope HMAC |
| 0004 | Action event representation is proto-native |
| 0005 | Gateway-control device origin binding |
| 0006 | Scope enforcement at handler level, uniform |
| 0007 | Stream RPC signing |
| 0008 | SCIM / SSO identity boundary |
| 0009 | At-rest secret AAD binding |
| 0010 | LUKS passphrase daemon socket |
| 0011 | Agent update authenticity |
| 0012 | Package argv hardening |
| 0013 | Enrollment trust model |
| 0014 | Secrets at rest hardening |
| 0015 | Auth hardening |
| 0016 | CRL fail-closed |
| 0017 | Agent stream loop fail-closed |
| 0018 | Request boundary resource bounds |
| 0019 | Indexer startup rebuild gate |
| 0020 | Fail-closed error discipline |
| 0021 | Single-source helpers (DRY) |
| 0022 | WS17b boundary hardening |
| 0023 | Carried-forward verification dispositions |
