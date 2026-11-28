# Security Specification — Multi-Tenant Sunday School Platform

## 1. Data Invariants
1. Every workspace sub-collection document (`/workspaces/{workspaceId}/...`) MUST belong to an existing parent `/workspaces/{workspaceId}` document (`exists(...)`).
2. Cross-tenant isolation: A user who is a member of Workspace A cannot read, list, create, update, or delete any document inside Workspace B (`members/{uid}` Master Gate).
3. Privilege escalation prevention: Users cannot assign themselves `environment_owner`, `head_servant`, `assistant_head`, or `servant` roles on `/globalUsers`, `/loginDirectory`, `/activeSessions`, or `/workspaces/{workspaceId}/members`. Only the verified Environment Owner (`jovanni.ayman@gmail.com` with `email_verified == true`) can provision workspaces and create `head_servant` bindings; workspace members can only self-claim a `members/{uid}` or `activeSessions/{uid}` binding by presenting an unforgeable `claimProof` whose SHA-256 matches `loginDirectory/{loginKey}.claimVerifier`.
4. PII Isolation & No Enumeration: `/loginDirectory/{loginKey}` blocks all `allow list` queries (`if false`) and contains zero PII (no raw phone/email/address); self-service phone reset verifies `sha256(lastResetProof) == existing().phoneProofVerifier`. Sensitive phone numbers, email addresses, and credential hashes live under `/globalUsers/{userId}/private/{docId}`, readable only by the verified owner of that `userId` or the Environment Owner.
5. Broadcast & Custom Group Chat Isolation: The global broadcast channel `global_leaders` is strictly read-only for `head_servant` accounts; only the Environment Owner may create or send messages to it. Custom groups (`isCustomGroup == true`) are readable and writable only by the Environment Owner and listed `memberIds`.
6. ID & Volumetric Hardening: Every path ID must match `^[a-zA-Z0-9_\\-]+$` and enforce strict `.size()` upper bounds. `workspaceId` and `createdAt` remain immutable after creation.

## 2. The "Dirty Dozen" Payloads (Attack Scenarios Blocked by Rules)
1. **Cross-Tenant Student Read**: Member of `ws_alpha` attempts `get(/workspaces/ws_beta/students/stu_1)` -> `PERMISSION_DENIED`.
2. **Self-Assigned Admin Role**: Anonymous/authenticated user creates `/globalUsers/attacker` or `/loginDirectory/u_evil` with `role: "environment_owner"` -> `PERMISSION_DENIED`.
3. **Email Spoof Attack**: User with `email: "jovanni.ayman@gmail.com"` and `email_verified: false` attempts to create `/workspaces/ws_hack` -> `PERMISSION_DENIED`.
4. **Shadow Field Injection**: Workspace servant updates a student with an extra ghost key `isSuperAdmin: true` -> `PERMISSION_DENIED` (`hasOnly` rejection).
5. **ID Poisoning**: User attempts to write `/workspaces/<1500-char-junk-id>` -> `PERMISSION_DENIED` (`isValidId` check).
6. **Orphaned Subcollection Write**: User attempts to create `/workspaces/nonexistent_ws/students/stu_99` -> `PERMISSION_DENIED` (`exists()` parent workspace check).
7. **PII Scraping (`allow list`)**: Unrelated user runs `getDocs(collection(db, 'globalUsers'))`, `getDocs(collection(db, 'loginDirectory'))`, or reads `/globalUsers/otherUser/private/info` -> `PERMISSION_DENIED`.
8. **Student Mutating Points**: A student (`role == 'student'`) attempts to update their own `/workspaces/ws_alpha/students/stu_1` `points` field -> `PERMISSION_DENIED`.
9. **Terminal State Bypass on Change Request**: Student attempts to update a `changeRequest` whose status is already `'approved'` -> `PERMISSION_DENIED`.
10. **Cross-Workspace Move**: Servant attempts to update `workspaceId` field on a student document from `ws_alpha` to `ws_beta` -> `PERMISSION_DENIED`.
11. **Broadcast Write & Unauthorized Group Chat**: A `head_servant` attempts to post a message to `/environmentChat/global_leaders/messages/msg_1` or read a custom group they are not in -> `PERMISSION_DENIED`.
12. **Forged Session Claim / Unauthenticated Read**: Anonymous client attempts to claim `/workspaces/ws_alpha/members/uid` without a valid `claimProof` matching `loginDirectory/{loginKey}.claimVerifier`, or unauthenticated client reads `/workspaces/ws_alpha` -> `PERMISSION_DENIED`.
