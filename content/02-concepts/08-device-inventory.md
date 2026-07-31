---
title: Device inventory
---
# Device inventory

The agent reports hardware, operating-system, package, and network facts. The
latest inventory is ordinary mutable state; it is not reconstructed from an
event stream.

## Collection

The baseline SDK collector gathers system, kernel, OS, block-device, and
interface facts. When `osqueryi` is available, the agent adds the approved
osquery inventory tables. Missing optional tools never prevent the agent from
starting or running unrelated capabilities.

## Refresh flow

1. Control commits an inventory request as durable device work.
2. The dispatcher offers it on the device's direct mTLS stream.
3. The agent collects the allowlisted tables and returns the result.
4. Control replaces the current inventory snapshot and records the operation
   in the audit log.

The database-backed scheduler also creates refresh work when inventory becomes
due. A device-level interval overrides group policy; otherwise the smallest
applicable group interval wins.

## Privacy

Inventory does not collect user files or home-directory contents. Access is
limited by device-scoped authorization. Secret values never belong in
inventory or searchable documents.
