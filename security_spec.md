# Security Specification — Multi-Tenant Sunday School Platform

## 1. Data Invariants
1. Every workspace sub-collection document (`/workspaces/{workspaceId}/...`) MUST belong to an existing parent `/workspaces/{workspaceId}` document (`exists(...)`).
2. Cross-tenant isolation: A user who is a member of Workspace A cannot read, list, create, update, or delete any document inside Workspace B (`members/{uid}` Master Gate).
3. Privilege escalation prevention: Users cannot assign themselves `environment_owner`, `head_servant`, `assistant_head`, or `servant` roles on `/globalUsers` or `/workspaces/{workspaceId}/members`. Only the verified Environment Owner (`jovanni.ayman@gmail.com` with `email_verified == true` or `/admins/{uid}`) can provision workspaces and create `head_servant` bindings.
4. PII Isolation: Sensitive phone numbers, email addresses, and password hashes live under `/globalUsers/{userId}/private/{docId}`, readable only by the owner (`request.auth.uid == userId`) or the verified Environment Owner.
5. ID & Volumetric Hardening: Every path ID must match `^[a-zA-Z0-9_\\-]+$` and be `<= 128` characters. Every string field enforces strict `.size()` upper bounds.
6. Immutable ownership & workspace linkage: `workspaceId` and `createdAt` cannot be mutated after document creation.

## 2. The "Dirty Dozen" Payloads (Attack Scenarios Blocked by Rules)
1. **Cross-Tenant Student Read**: Member of `ws_alpha` attempts `get(/workspaces/ws_beta/students/stu_1)` -> `PERMISSION_DENIED`.
2. **Self-Assigned Admin Role**: Anonymous/authenticated user creates `/globalUsers/attacker` with `role: "environment_owner"` -> `PERMISSION_DENIED`.
3. **Email Spoof Attack**: User with `email: "jovanni.ayman@gmail.com"` and `email_verified: false` attempts to create `/workspaces/ws_hack` -> `PERMISSION_DENIED`.
4. **Shadow Field Injection**: Workspace servant updates a student with an extra ghost key `isSuperAdmin: true` -> `PERMISSION_DENIED` (`hasOnly` rejection).
5. **ID Poisoning**: User attempts to write `/workspaces/<1500-char-junk-id>` -> `PERMISSION_DENIED` (`isValidId` check).
6. **Orphaned Subcollection Write**: User attempts to create `/workspaces/nonexistent_ws/students/stu_99` -> `PERMISSION_DENIED` (`exists()` parent workspace check).
7. **PII Scraping (`allow list`)**: Unrelated user runs `getDocs(collection(db, 'globalUsers'))` or tries reading `/globalUsers/otherUser/private/info` -> `PERMISSION_DENIED`.
8. **Student Mutating Points**: A student (`role == 'student'`) attempts to update their own `/workspaces/ws_alpha/students/stu_1` `points` field -> `PERMISSION_DENIED`.
9. **Terminal State Bypass on Change Request**: Student attempts to update a `changeRequest` whose status is already `'approved'` -> `PERMISSION_DENIED`.
10. **Cross-Workspace Move**: Servant attempts to update `workspaceId` field on a student document from `ws_alpha` to `ws_beta` -> `PERMISSION_DENIED`.
11. **Applicant Reading Another Applicant's Direct Chat**: Applicant A attempts to read `/environmentChat/direct_applicantB/messages/msg1` -> `PERMISSION_DENIED`.
12. **Unauthenticated Blanket Read**: Unauthenticated client (`request.auth == null`) attempts to read `/workspaces/ws_alpha` or `/environmentChat/global_leaders/messages` -> `PERMISSION_DENIED`.
