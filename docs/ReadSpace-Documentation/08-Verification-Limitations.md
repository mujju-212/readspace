# 9. Verification Matrix and Known Limitations

This chapter provides an objective, transparent assessment of the ReadSpace platform. It distinguishes verified runtime behavior from theoretical code capabilities, documents source-level discrepancies, and outlines the required acceptance test suite.

---

## 9.1 Verification Methodology and Evidence Hierarchy

To ensure absolute technical accuracy, every claim in this documentation is categorized according to an empirical evidence hierarchy:

| Status Badge | Verification Definition | Scope & Confidence |
|---|---|---|
| `[Observed Live]` | Explicitly executed and visually confirmed on the deployed production web instance. | **Highest Confidence:** Functionality verified under real user conditions. |
| `[Build-Checked]` | Cleanly compiled through TypeScript (`tsc`) and Vite build pipelines without compilation errors. | **High Confidence:** Confirms structural validity, type safety, and syntax correctness. |
| `[Code-Based]` | Path exists in reviewed source code; logic and error paths have been traced through static analysis. | **Moderate Confidence:** Logic is implemented, but runtime edge cases may exist. |
| `[Target-Specific]` | Requires physical Android/iOS hardware, specific browser engines, or authenticated third-party accounts. | **Requires External Test:** Behavior depends on external runtime environments. |

### Source Code Snapshots Reviewed:
- **Web Platform & Backend:** Commit `ed7476c18ea6ce5db7c79778f7585dab4be7c845`
- **Mobile Companion Application:** Commit `8071a88341bbbae8ffe3c548fa18ad16165e3943`
- **Deployed Production URL:** `https://readspace-livid.vercel.app/`

---

## 9.2 Scope of Empirical Verification Performed

During this rigorous architectural audit, the following empirical tests were successfully executed:

1. **Production Web Application Inspection:**
   - Navigated the deployed web application on desktop viewports and responsive mobile viewports (390 × 844 px).
   - Confirmed home dashboard layout, quick-action cards, theme transitions, and reader settings drawers.
2. **Sample Workspace Exploration:**
   - Mounted the sample workspace; traversed directory trees in the file explorer.
   - Rendered the sample `README.md`; verified headers, typography, code blocks, and links.
   - Mounted `papers/readspace-demo.pdf`; verified PDF canvas rendering, continuous scrolling, pagination buttons, and zoom controls.
3. **Backend Health & Capability Probing:**
   - Queried `/api/config`: Confirmed JSON response reporting Google OAuth readiness mode.
   - Queried anonymous `/api/auth/me`: Confirmed null session response and Drive disconnected status.
4. **Static Analysis & Compilation:**
   - **Web:** Executed `npm ci`, `npm run typecheck` (`tsc -b`), and `npm run build` (`vite build`). Compilation completed successfully with non-fatal dynamic import chunking advisories.
   - **Mobile:** Executed `npm ci` and `npm run typecheck` (`tsc --noEmit`). Compilation passed with zero type errors.

---

## 9.3 Comprehensive Format and Platform Compatibility Matrix

The table below indicates feature implementation across all five supported execution targets:
- `O` = Observed Live
- `B` = Build Checked & Type Checked
- `C` = Code-Based Path Present
- `?` = Requires Target Device Verification

| Document Format / Feature Area | Desktop Web (Chrome / Edge) | Responsive Web (Mobile Safari) | Expo Web (Mobile Target) | Android Native (APK / Build) | iOS Native (IPA / Build) |
|---|:---:|:---:|:---:|:---:|:---:|
| **Home Dashboard & Recents** | O | O | B | C | C |
| **Sample Workspace** | O | C | C | C | C |
| **Markdown Rendering (`.md`)** | O | C | C | C | C |
| **PDF Viewing (`.pdf`)** | O | C | C | C | C |
| **Plain Text & Code Editor** | C | C | C | C | C |
| **Split-View Markdown Editing** | C | C | Not Applicable | Not Applicable | Not Applicable |
| **Local Folder Traversal** | O (FSA) | C (Snapshot) | C (Snapshot) | C (SAF Tree) | C (Multi-Import) |
| **HTML Preview (Sandboxed)** | C | C | C | C | C |
| **Word Documents (`.docx`)** | C | C | C | C | C |
| **Presentations (`.pptx`)** | C | C | C | C | C |
| **Image & Media Playback** | C | C | C | C | C |
| **Theme Switching (4 Themes)** | O | O | C | C | C |
| **Zen Reading Mode** | O | C | C | C | C |
| **Google Drive Browsing** | C | C | C | C | C |
| **Cloud Transfer & Sync** | C | C | C | C | C |
| **Hardware Passkey (WebAuthn)**| C | C | C | **Simulated UI** | **Simulated UI** |

---

## 9.4 Detailed Source-Level Findings & Security Boundaries

A forensic review of the source code identified several critical architectural findings and contract discrepancies:

### 1. Critical Finding: Simulated Mobile Passkeys
- **Locations:** `readspace_app/src/components/AccountSecurityModal.tsx` (`handleRegisterPasskey`) and `readspace_app/src/components/AuthModal.tsx` (`handlePasskeyQuickLogin`).
- **Mechanism:** In the mobile client, `handleRegisterPasskey` invokes `setTimeout` for 1,200 ms and presents an alert: *"Passkey created successfully!"* It does not call native biometric APIs (`expo-local-authentication`) or register a public key credential. Similarly, `handlePasskeyQuickLogin` verifies an existing local user record and displays a simulated verification dialog.
- **Impact:** **The mobile passkey controls are illustrative placeholders, not cryptographic security controls.** Do not describe mobile passkeys as biometric security until native FIDO2/WebAuthn APIs are integrated.

### 2. High Finding: Password Update Payload Mismatch
- **Locations:** Mobile client `readspace_app/src/services/api.ts` vs. Backend `server/lib/routes.mjs`.
- **Mechanism:** The mobile `Api.setPassword` method submits `{ newPassword, currentPassword }`. However, the backend route handler explicitly reads `const { password } = req.body`.
- **Impact:** Submitting a password change from the mobile Settings screen will fail because the backend rejects the missing `password` property. The mobile payload should be updated to send `{ password: newPassword, currentPassword }`.

### 3. High Finding: Mock Records in Mobile Activity Screen
- **Location:** `readspace_app/src/screens/ActivityScreen.tsx`.
- **Mechanism:** The component initializes its state with two static, hard-coded download records (*"CS301-Algorithms-Lecture.pdf"* and *"Distributed-Systems-Research.pdf"*).
- **Impact:** The Activity tab does not reflect live cloud transfers. It should not be presented as proof of real-time transfer monitoring until wired to a dynamic transfer store.

### 4. Medium Finding: Mobile Bookmark Removal ID Mismatch
- **Location:** `readspace_app/src/screens/ReaderScreen.tsx`.
- **Mechanism:** When adding a bookmark, the reader generates a unique `bookmark.id`. However, when toggling the bookmark off, the code calls `Storage.removeBookmark(currentDoc.id)`, passing the document ID instead of the bookmark ID.
- **Impact:** Bookmarks cannot be deselected directly from the reader toolbar on mobile because `removeBookmark` searches for matching bookmark IDs.

### 5. High Finding: Heuristic Limits of Workspace Scanning
- **Location:** Web `src/features/cloud/autoSync.ts`.
- **Mechanism:** The local workspace crawler caps its scan at the first 1,000 files to avoid browser memory saturation. Furthermore, the server diffing algorithm classifies identical files (`same_candidate`) by comparing relative path and byte size—it does not compute cryptographic hash checksums (SHA-256).
- **Impact:** Large repositories exceeding 1,000 files will not be fully scanned in a single pass. Files with identical byte sizes but modified contents could theoretically be misclassified.

### 6. High Finding: Ephemeral Database Fallback in Serverless Deployments
- **Location:** Backend `server/lib/db.mjs`.
- **Mechanism:** If `MONGODB_URI` is not configured, the backend initializes a local JSON file adapter. In serverless environments like Vercel with read-only ephemeral file systems, changes written to disk are lost when serverless containers recycle.
- **Impact:** Production deployments on Vercel **must** provide a valid `MONGODB_URI` to ensure account credentials, sessions, and saved links persist reliably.

---

## 9.5 Acceptance Test Suite Specification

Before certifying a new ReadSpace deployment for production release, the following twelve acceptance tests must be executed:

| Test ID | Test Name & Scenario | Execution Procedure | Minimum Acceptance Evidence |
|---|---|---|---|
| **T01** | Local Folder Read/Write & Fallback | Open a local folder in Chrome and Firefox; edit a Markdown file in Split View; press `Ctrl+S`. | In Chrome, physical file on disk is modified. In Firefox, automated file download is triggered. |
| **T02** | Real Google OAuth & Drive Connect | Connect Google Drive using a real test account; grant `drive.file` scope; browse cloud folder. | Backend logs successful token exchange; Drive status displays green `Connected` badge. |
| **T03** | Saved Links Lifecycle | Paste a Google Drive file link with a `resourcekey`; assign title and tags; save link; reopen link. | Link is stored in database; clicking link opens the remote document correctly. |
| **T04** | Cloud Transfer & Classification | Scan a workspace with new files and modified files; execute **Upload New Only**. | Only new files appear in Drive; modified files remain untouched; progress reaches 100%. |
| **T05** | Optimistic Concurrency Conflict | Modify a cloud file externally; attempt to save local edits in ReadSpace; choose **Save My Copy**. | Cloud Conflict Dialog appears; a new timestamped duplicate file is created in Google Drive. |
| **T06** | Cross-Device Session Sync | Open a cloud PDF on desktop, scroll to page 15; open mobile app; tap **Continue Reading**. | Mobile reader opens the exact same PDF and restores scroll position to page 15. |
| **T07** | Offline Document Caching | Open a cloud document on mobile; enable Airplane Mode; force close and reopen app. | Document loads instantly from local cache without displaying network failure modals. |
| **T08** | Mobile Password Update Fix | Harmonize mobile API payload; submit new password from mobile settings; log in with new password. | Backend accepts payload; user logs in successfully with the new password. |
| **T09** | Native Platform Verification | Build standalone APK for Android and IPA for iOS; test SAF directory picker and native reader. | Directory tree renders smoothly; touch scrolling and drawer navigation operate fluidly. |
| **T10** | Document Fidelity Benchmark | Open sample test suite of complex PDFs, DOCX tables, PPTX slides, and nested HTML. | Content displays without formatting corruption; code blocks maintain syntax highlighting. |
| **T11** | Production Security Audit | Audit token encryption keys, cookie security attributes, CORS origins, and iframe sandbox flags. | `TOKEN_ENCRYPTION_KEY` enforced; cookies set to `Secure` and `HttpOnly`; iframes sandboxed. |
| **T12** | Accessibility & Keyboard Audit | Navigate entire web application using keyboard only (`Tab`, `Enter`, `Ctrl+P`, `Ctrl+B`, `Ctrl+Alt+Z`). | All interactive controls receive visible focus rings; screen readers announce document headings. |

---

**Codebase References:**
- Web App Shell: [src/App.tsx](file:///d:/AVTIVE%20PROJ/readspace/src/App.tsx)
- Cloud Sync Engine: [src/features/cloud/autoSync.ts](file:///d:/AVTIVE%20PROJ/readspace/src/features/cloud/autoSync.ts)
- Mobile Security Modal: [readspace_app/src/components/AccountSecurityModal.tsx](file:///d:/AVTIVE%20PROJ/readspace/readspace_app/src/components/AccountSecurityModal.tsx)
- Mobile Auth Modal: [readspace_app/src/components/AuthModal.tsx](file:///d:/AVTIVE%20PROJ/readspace/readspace_app/src/components/AuthModal.tsx)
- Mobile API Layer: [readspace_app/src/services/api.ts](file:///d:/AVTIVE%20PROJ/readspace/readspace_app/src/services/api.ts)
- Mobile Reader Screen: [readspace_app/src/screens/ReaderScreen.tsx](file:///d:/AVTIVE%20PROJ/readspace/readspace_app/src/screens/ReaderScreen.tsx)
- Backend Database Adapter: [server/lib/db.mjs](file:///d:/AVTIVE%20PROJ/readspace/server/lib/db.mjs)
