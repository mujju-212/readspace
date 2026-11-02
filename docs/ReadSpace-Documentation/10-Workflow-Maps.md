# 11. System Workflow Maps

This chapter provides comprehensive architectural diagrams and procedural workflow maps illustrating data flows, authentication handshakes, synchronization pipelines, and error recovery lifecycles across the ReadSpace platform.

---

## 11.1 Platform Connectivity and Data Exchange Map

```text
┌───────────────────────────────────────────────────────────────────────────┐
│                        ReadSpace Web Application                          │
│                   Desktop Workstation / Browser Viewport                  │
│                                                                           │
│   [ Home Dashboard ] ──▶ [ Workspace Explorer ] ──▶ [ Multi-Tab Reader ]  │
└────────┬───────────────────────────────────────────┬──────────────────────┘
         │                                           │
         │ Direct OS Disk IO                         │ REST API Calls
         │ (Chromium FSA / IndexedDB)                │ (HttpOnly Session Cookie)
         ▼                                           ▼
┌─────────────────────────┐                 ┌───────────────────────────────┐
│ Local Operating System  │                 │    ReadSpace Backend API      │
│ Direct File System      │                 │    (Node.js / Express Server) │
│ • Local Folders & Files │                 │                               │
│ • IndexedDB Offline     │                 │ • User Auth & Salted Scrypt   │
│   Cache & Draft Buffers │                 │ • SimpleWebAuthn Passkeys     │
└─────────────────────────┘                 │ • Workspace Session Metadata  │
                                            │ • Saved Links Repository      │
                                            │ • Transfer Coordination Engine│
                                            └───────┬───────────────┬───────┘
                                                    │               │
                                    Encrypted OAuth │               │ Encrypted
                                    Bearer Tokens   │               │ Database IO
                                                    ▼               ▼
┌─────────────────────────┐                 ┌───────────────┐ ┌─────────────┐
│  Expo Mobile Companion  │                 │ Google Cloud  │ │ MongoDB /   │
│  React Native / Expo 52 │                 │ Drive API     │ │ Local JSON  │
│                         │                 │               │ │ Database    │
│ [ Home ]  [ Library ]   │                 │ • Cloud Files │ │             │
│ [ Activity ] [ Settings]│                 │ • User Info   │ │ • Users     │
│ [ HybridReader Engine ] │                 │ • OAuth 2.0   │ │ • Sessions  │
└────────┬────────────────┘                 │ • Export Docs │ │ • Workspaces│
         │                                  └───────────────┘ └─────────────┘
         │ Mobile Native Storage IO                 ▲
         │ (SAF / AsyncStorage / Local Cache)       │
         └──────────────────────────────────────────┘
```

---

## 11.2 Content Source Selection and Provider Pipeline

ReadSpace abstracts disparate document locations behind a uniform Virtual File System Provider interface (`src/services/fs/types.ts`):

```text
                                  User Action
                       Select Content Source on Home View
                                       │
     ┌──────────────────┬──────────────┴───────┬──────────────────┐
     ▼                  ▼                      ▼                  ▼
[ Local Folder ]  [ Sample Workspace]  [ Google Drive ]    [ Shared Link ]
     │                  │                      │                  │
     ▼                  ▼                      ▼                  ▼
Browser FSA /      In-Memory Static      Authenticated        Parsed Google
Directory Picker   Asset Manifest        Drive Directory      Resource Key
     │                  │                      │                  │
     ▼                  ▼                      ▼                  ▼
fsa.ts Provider    sample.ts Provider    cloud.ts Provider  cloudlink.ts Provider
• canWrite: true   • canWrite: false     • canWrite: true   • canWrite: false
     │                  │                      │                  │
     └──────────────────┼──────────────────────┴──────────────────┘
                        │
                        ▼
            Mount Workspace Explorer
                        │
                        ▼
          User Selects Target Document
                        │
                        ▼
             ViewerHost.tsx Dispatches
           Specialized Document Renderer
                        │
      ┌─────────────────┼─────────────────┬─────────────────┐
      ▼                 ▼                 ▼                 ▼
MarkdownViewer      PdfViewer        DocxViewer        MediaViewer
• Rendered MD       • Canvas Zoom    • Mammoth HTML    • Audio Player
• Split Editor      • Continuous     • Slide Parser    • Video Container
```

---

## 11.3 Identity Authentication vs. Google Drive Authorization

ReadSpace strictly decouples user identity management from third-party cloud storage authorization:

```text
                        User Initiates Sign-In
                                   │
         ┌─────────────────────────┴─────────────────────────┐
         ▼                                                   ▼
   [ Web Platform ]                                   [ Mobile App ]
         │                                                   │
 ┌───────┴───────┬───────────────┐                   ┌───────┴───────┐
 ▼               ▼               ▼                   ▼               ▼
Email /       Google         Hardware             Email /         Google
Password     Identity         Passkey            Password        Identity
(Scrypt)     (OAuth 2.0)    (WebAuthn)           (Scrypt)       (OAuth 2.0)
 │               │               │                   │               │
 └───────────────┼───────────────┘                   └───────┬───────┘
                 │                                           │
                 ▼                                           ▼
      Backend Generates 30-Day                    Backend Returns Session ID
      Opaque Session Token                        (Stored in AsyncStorage)
                 │                                           │
      Sets HttpOnly Secure Cookie                 Transmits via x-session-id
                 │                                           │
                 └─────────────────────┬─────────────────────┘
                                       │
                                       ▼
                       ReadSpace User Identity Active
                    (Can sync tabs, saved links, layout)
                                       │
                                       ▼
                    User Clicks "Connect Google Drive"
                     (Explicit Permission Upgrade)
                                       │
                                       ▼
                    Redirect to Google OAuth Consent
                       Scopes: drive.file, drive.readonly
                                       │
                      ┌────────────────┴────────────────┐
                      ▼                                 ▼
                 User Approves                     User Cancels
                      │                                 │
                      ▼                                 ▼
            Google Returns Auth Code             Drive Remains Disconnected
                      │                         (Local features still work)
                      ▼
            Backend Exchanges Code for
            OAuth Refresh Token
                      │
                      ▼
            AES-256-GCM Encrypts Token
            Using TOKEN_ENCRYPTION_KEY
                      │
                      ▼
            Drive Status: CONNECTED
            (Can browse, stream, and sync cloud files)
```

---

## 11.4 Local-to-Drive Workspace Synchronization Pipeline

Moving local documents to Google Drive follows a controlled, user-governed five-stage pipeline:

```text
[ STAGE 1: INITIATION ]
User Mounts Local Workspace + Connects Google Drive
Opens Transfer Panel and Selects Target Remote Destination Folder
                             │
                             ▼
[ STAGE 2: MANIFEST CRAWL ]
Client-Side Crawler Traverses Local Directory Tree
Extracts Relative Paths, Byte Sizes, and Modified Timestamps
(Enforces Safety Cap: Maximum 1,000 files per run)
                             │
                             ▼
[ STAGE 3: SERVER COMPARISON ]
Client Transmits Manifest to: POST /api/transfers/scan
Backend Compares Local Manifest against Remote Drive Directory
Classifies Each Item into Three Distinct Candidate Buckets:
  • likely_new:     Path does not exist in remote Drive folder
  • same_candidate: Path exists with identical byte size
  • name_collision: Path exists with differing byte size
                             │
                             ▼
[ STAGE 4: USER CONFIRMATION ]
UI Displays Classified Candidate Table
User Explicitly Selects Upload Action:
  [ Upload New Only ] ──▶ Filters strictly to likely_new files
  [ Upload All ]      ──▶ Includes new files and collisions
  [ Upload Selected ] ──▶ Transfers user-checked checkboxes
                             │
                             ▼
[ STAGE 5: BATCH TRANSFER EXECUTION ]
Client Queues Selected Files
Executes Concurrent Upload Requests via: POST /api/drive/files
Real-Time Progress Bar Tracks Completed Bytes and Transfer Rate
Transfer Job Logged to Database transfers Collection
Destination Verified in Google Drive
```

---

## 11.5 Optimistic Concurrency and Remote Conflict Resolution

When editing cloud documents directly in Google Drive, ReadSpace protects against silent multi-user overwrite bugs:

```text
User Opens Remote Document in ReadSpace
Captures Remote modifiedTime: T1
                  │
                  ▼
User Edits Text in Split View or In-Place Editor
                  │
                  ▼
User Presses Ctrl+S to Save
                  │
                  ▼
Backend Fetches Latest Metadata for File ID: /api/drive/files/:id/meta
                  │
                  ▼
Does Remote modifiedTime Match T1?
                  │
        ┌─────────┴─────────┐
        ▼                   ▼
     [ YES ]              [ NO ]
Remote is Unchanged   Remote was Modified Externally (T2)
        │                   │
        ▼                   ▼
Backend Saves Text    Backend Intercepts Save and Returns HTTP 409
Updates modifiedTime  ReadSpace Mounts Cloud Conflict Dialog
                            │
       ┌────────────────────┼────────────────────┐
       ▼                    ▼                    ▼
[ Overwrite Remote ] [ Save My Copy ]  [ Load Remote Version ]
Disregards T2;       Creates New File: Discards Local Edits;
Forces Local Text    "Doc (Conflict).md" Reloads Latest Cloud
onto Remote File     Both Files Kept   Content (T2) into Editor
```

---

## 11.6 Multi-Tier Persistence Architecture

ReadSpace categorizes data into clear operational tiers with defined persistence lifecycles:

```text
┌───────────────────────────────────────────────────────────────────────────┐
│                      TIER 1: EPHEMERAL BROWSER TIERS                      │
│ • React Zustand State: In-memory active tab list, filter strings, modals  │
│ • DOM Session State: Active scroll offset, text cursor position           │
└─────────────────────────────────────┬─────────────────────────────────────┘
                                      │
┌─────────────────────────────────────▼─────────────────────────────────────┐
│                      TIER 2: LOCAL DEVICE PERSISTENCE                     │
│ • localStorage: Theme choice, typography settings, workspace tab keys     │
│ • IndexedDB (readspace_fsa): Persistent FileSystemDirectoryHandle tokens  │
│ • IndexedDB (readspace_drafts): Debounced unsaved text drafts             │
│ • Mobile AsyncStorage: Offline bookmarks, recents, custom server URL      │
└─────────────────────────────────────┬─────────────────────────────────────┘
                                      │
┌─────────────────────────────────────▼─────────────────────────────────────┐
│                    TIER 3: BACKEND METADATA PERSISTENCE                   │
│ • MongoDB users: Salted Scrypt hashes, registered WebAuthn credentials    │
│ • MongoDB connections: AES-256-GCM encrypted Google OAuth refresh tokens   │
│ • MongoDB workspaces: Workspace layout, tab ordering, active documents   │
│ • MongoDB savedLinks: Curated Drive links, collection tags, progress      │
└─────────────────────────────────────┬─────────────────────────────────────┘
                                      │
┌─────────────────────────────────────▼─────────────────────────────────────┐
│                     TIER 4: REMOTE CLOUD FILE STORAGE                     │
│ • Google Drive: Authoritative binary storage for cloud PDFs, images, docs │
│ • Physical Hard Drive: Authoritative storage for local desktop documents  │
└───────────────────────────────────────────────────────────────────────────┘
```

---

## 11.7 Mobile Navigation and HybridReader Lifecycle

```text
                            Application Launch
                                     │
                                     ▼
                      RootNavigator Bottom Tabs
          ┌──────────────┬───────────┴───────────┬──────────────┐
          ▼              ▼                       ▼              ▼
     [ HomeTab ]   [ LibraryTab ]          [ ActivityTab ] [ SettingsTab ]
          │              │                       │              │
          │              ├─ On Device Source     └─ Mock Feed   ├─ Theme Switcher
          │              ├─ Saved Links Source      (Sample)    ├─ Backend URL
          │              └─ Google Drive Source                 └─ Check Updates
          │                      │
          └──────────────┬───────┘
                         │ User Selects Document
                         ▼
               Mount ReaderScreen.tsx
                         │
                         ▼
             Format & Target Inspection
                         │
        ┌────────────────┴────────────────┐
        ▼                                 ▼
[ Android / iOS Native ]            [ Expo Web Target ]
        │                                 │
        ▼                                 ▼
Mount Native WebView              Mount Web DOM Viewers
Load Bundled offlineVendors       Load Standard Viewport Engines
Inject Base64 Document Bytes      Stream Binary Object URLs
        │                                 │
        └────────────────┬────────────────┘
                         │
                         ▼
             Display Reading Controls
     • Touch-Friendly Typography & Status Badge
     • Slide-Out Workspace Drawer Tree
     • Distraction-Free Zen Mode Toggle
     • Reading Position Auto-Sync
```

---

## 11.8 Offline Document Retrieval and Error Recovery Tree

```text
User Attempts to Open Document
              │
              ▼
Is Network Online?
              │
      ┌───────┴───────┐
      ▼               ▼
   [ YES ]         [ NO ]
      │               │
      │               ▼
      │    Is Document Present in Local Cache / Disk?
      │               │
      │       ┌───────┴───────┐
      │       ▼               ▼
      │    [ YES ]         [ NO ]
      │       │               │
      │       ▼               ▼
      │   Mount Document   Display Offline Warning Banner:
      │   from Local Cache "Document not cached. Connect to network."
      │
      ▼
Fetch Latest from Source (Local FSA Handle / Google Drive)
      │
      ▼
Did Read Operation Succeed?
      │
      ┌───────┴───────┐
      ▼               ▼
   [ YES ]         [ NO ]
      │               │
      ▼               ▼
Mount Viewer    Evaluate Failure Root Cause:
Update Cache      │
                  ├─▶ Cause: Browser Handle Permission Expired
                  │   Action: Display "Verify Permission" button
                  │
                  ├─▶ Cause: Google Drive Token Expired
                  │   Action: Prompt user to re-authenticate session
                  │
                  ├─▶ Cause: File Locked or Read-Only Provider
                  │   Action: Enable viewing; route saves to file download
                  │
                  └─▶ Cause: Corrupt or Malformed Binary Data
                      Action: Offer plain-text raw decoding fallback
```

---

**Codebase References:**
- Web App Shell: [src/App.tsx](file:///d:/AVTIVE%20PROJ/readspace/src/App.tsx)
- Viewer Host: [src/components/ViewerHost.tsx](file:///d:/AVTIVE%20PROJ/readspace/src/components/ViewerHost.tsx)
- Cloud Synchronization Engine: [src/features/cloud/autoSync.ts](file:///d:/AVTIVE%20PROJ/readspace/src/features/cloud/autoSync.ts)
- Mobile Navigator: [readspace_app/src/navigation/RootNavigator.tsx](file:///d:/AVTIVE%20PROJ/readspace/readspace_app/src/navigation/RootNavigator.tsx)
- Backend Router: [server/lib/routes.mjs](file:///d:/AVTIVE%20PROJ/readspace/server/lib/routes.mjs)
