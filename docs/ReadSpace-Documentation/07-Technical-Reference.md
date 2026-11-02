# 8. Technical Architecture and Deployment Reference

This chapter provides a comprehensive technical reference for the ReadSpace platform, detailing component structures, state stores, virtualized file systems, the backend REST API surface, cryptographic mechanisms, database schemas, and step-by-step local development and production deployment instructions.

---

## 8.1 System Architecture Overview

The ReadSpace platform operates as a decoupled, multi-tier system uniting client applications with cloud infrastructure:

```text
┌───────────────────────────────────────────────────────────────────────────┐
│                           WEB FRONTEND TIER                               │
│                   React 18 • Vite • Tailwind CSS • Zustand                │
│                                                                           │
│   ┌─────────────────┐   ┌──────────────────┐   ┌──────────────────────┐   │
│   │  Zustand Stores │   │  Virtualized FS  │   │      ViewerHost      │   │
│   │  • tabs.ts      │   │  • fsa.ts        │   │  • MarkdownViewer    │   │
│   │  • settings.ts  │◀─▶│  • fallback.ts   │◀─▶│  • PdfViewer (PDF.js)│   │
│   │  • transfer.ts  │   │  • clouddrive.ts │   │  • DocxViewer        │   │
│   │  • auth.ts      │   │  • cloudlink.ts  │   │  • PptxViewer        │   │
│   └─────────────────┘   └──────────────────┘   └──────────────────────┘   │
│            ▲                      ▲                        ▲              │
└────────────┼──────────────────────┼────────────────────────┼──────────────┘
             │ Direct Browser IO    │ /api HTTP Proxy        │
             ▼                      ▼                        │
┌─────────────────────────┐   ┌──────────────────────────────┴──────────────┐
│  Browser Storage Tiers  │   │             BACKEND API SERVICE             │
│  • localStorage         │   │         Node.js 18+ • Express / Vercel      │
│    (Settings, tab list) │   │                                             │
│  • IndexedDB            │   │  ┌─────────────────┐  ┌───────────────────┐ │
│    - readspace_fsa      │   │  │ Authentication  │  │ Google Cloud Hub  │ │
│    - readspace_drafts   │   │  │ • Salted Scrypt │  │ • OAuth 2.0 Auth  │ │
│    - readspace_blobs    │   │  │ • SimpleWebAuthn│  │ • Token Encrypt   │ │
│                         │   │  │ • Cookie / Token│  │ • Drive API Proxy │ │
└─────────────────────────┘   │  └─────────────────┘  └───────────────────┘ │
                              │           ▲                     ▲           │
                              │           │                     │           │
                              │  ┌────────┴────────┐  ┌─────────┴─────────┐ │
                              │  │ Session Sync    │  │ Transfer Manager  │ │
                              │  │ • Workspaces    │  │ • Scan engine     │ │
                              │  │ • Saved Links   │  │ • Batch upload/dl │ │
                              │  └─────────────────┘  └───────────────────┘ │
                              └──────────────────────┬──────────────────────┘
                                                     │
                                      ┌──────────────┴──────────────┐
                                      ▼                             ▼
                          ┌──────────────────────┐    ┌─────────────────────┐
                          │   Database Storage   │    │ Google Cloud APIs   │
                          │ • MongoDB Atlas      │    │ • Google Drive API  │
                          │ • JSON / Memory (Dev)│    │ • UserInfo API      │
                          └──────────────────────┘    └─────────────────────┘
```

---

## 8.2 Web Codebase Map

| File / Directory Path | Module Role & Architectural Responsibility |
|---|---|
| `src/App.tsx` | Root application component; initializes theme, mounts layout, registers global keyboard shortcuts, handles session restoration, and triggers debounced workspace session sync. |
| `src/components/ViewerHost.tsx` | Dynamic viewer router; inspects file MIME types and extensions, mounts the appropriate renderer, coordinates in-place editing, manages split-view layout, handles auto-draft IndexedDB persistence, and intercepts Google Drive write conflicts. |
| `src/components/Explorer.tsx` | Virtualized hierarchical tree view for workspace directories; provides inline search filtering, directory expansion state, and automated noise exclusion (`.git`, `node_modules`). |
| `src/components/TabBar.tsx` | Multi-tab document buffer bar; handles tab switching, tab reordering via drag-and-drop, dirty edit indicators, and tab close confirmations. |
| `src/components/QuickOpen.tsx` | Fast `Ctrl+P` modal fuzzy-finder for instantaneous workspace file switching. |
| `src/components/viewers/` | Format-specific renderers: `MarkdownViewer.tsx`, `PdfViewer.tsx`, `DocxViewer.tsx`, `PptxViewer.tsx`, `HtmlViewer.tsx`, `MediaViewer.tsx`. |
| `src/services/fs/types.ts` | Core virtual file system interface (`FileSystemProvider`), declaring `listDir`, `readFile`, `readText`, `writeFile`, and `stat`. |
| `src/services/fs/fsa.ts` | Chromium File System Access API provider; communicates directly with local operating system folders with read/write handle persistence. |
| `src/services/fs/fallback.ts` | Read-only directory snapshot provider for browsers lacking the File System Access API (WebKit / Firefox). |
| `src/services/fs/cloud.ts` | Authenticated Google Drive provider; communicates with backend `/api/drive/*` endpoints and enforces concurrency guards. |
| `src/services/fs/cloudlink.ts` | Read-only provider for mounted Google Drive shared links and resource keys. |
| `src/services/persistence.ts` | Client-side IndexedDB wrapper managing `readspace_fsa` (handles), `readspace_drafts` (unsaved edits), and `readspace_blobs` (cached assets). |
| `src/features/cloud/` | Cloud workflows: `autoSync.ts` (manifest scan & diffing), `cloudLinkUtils.ts` (Drive URL parsing), and transfer UI components. |
| `src/stores/` | Zustand state stores: `tabs.ts` (open buffers), `settings.ts` (themes & typography), `auth.ts` (user credentials), `transfer.ts` (transfer queues). |

---

## 8.3 Mobile Codebase Map

The Mobile Companion codebase (`readspaceapp`) is built on React Native and Expo SDK 52:

| File / Directory Path | Module Role & Architectural Responsibility |
|---|---|
| `readspace_app/App.tsx` | Mobile entry point; initializes font bundles, safe area contexts, and root theme providers. |
| `readspace_app/src/navigation/RootNavigator.tsx` | React Navigation stack and bottom tab navigator managing **Home**, **Library**, **Activity**, and **Settings** tabs plus the modal **Reader** screen. |
| `readspace_app/src/screens/` | Feature screens: `HomeScreen.tsx`, `LibraryScreen.tsx`, `ReaderScreen.tsx`, `ActivityScreen.tsx`, `SettingsScreen.tsx`. |
| `readspace_app/src/components/HybridReader.tsx` | Touch-optimized document viewing engine. On native targets (Android/iOS), it leverages a high-performance native WebView container; on Expo Web targets, it mounts optimized DOM renderers. |
| `readspace_app/src/components/WorkspaceDrawer.tsx` | Slide-out directory navigation drawer allowing intra-workspace file switching directly within the mobile Reader screen. |
| `readspace_app/src/services/folder.ts` | Native directory abstraction; interfaces with Android Storage Access Framework (SAF) and provides an imported collection fallback on iOS. |
| `readspace_app/src/services/picker.ts` | Wrapper around `expo-document-picker` for opening individual documents from device storage. |
| `readspace_app/src/services/storage.ts` | Local persistence manager wrapping `AsyncStorage` for document metadata, recents, bookmarks, and settings. |
| `readspace_app/src/services/api.ts` | Mobile HTTP client communicating with the ReadSpace backend using session headers. |
| `readspace_app/src/services/update.ts` | Automated update coordinator combining `expo-updates` (OTA channels) and GitHub Releases API fallbacks. |
| `readspace_app/src/vendor/offlineVendors.ts` | Embedded client-side rendering engine bundles enabling offline document viewing. |

---

## 8.4 Backend REST API Specification

The ReadSpace backend is implemented in Node.js ES Modules (`server/lib/routes.mjs`) and can be hosted via an Express HTTP server (`server/index.mjs`) or deployed to Vercel Serverless Functions (`api/index.mjs`).

### Comprehensive Endpoint Reference

| Endpoint Route | Method | Authentication Required | Payload / Query Parameters | Response Format & Description |
|---|---|---|---|---|
| `/api/config` | `GET` | None | None | `{ mode: 'google'\|'mock', auth: true }` — Returns backend operational capabilities and OAuth mode. |
| `/api/auth/register` | `POST` | None | `{ email, password, name? }` | `{ success: true, user: { id, email } }` — Hashes password with Scrypt and sets session cookie. |
| `/api/auth/login` | `POST` | None | `{ email, password }` | `{ success: true, user: { id, email } }` — Verifies password against Scrypt hash. |
| `/api/auth/me` | `GET` | Optional | None | `{ user: { id, email } \| null, driveConnected: boolean }` — Returns current session and Drive status. |
| `/api/auth/logout` | `POST` | Required | None | `{ success: true }` — Invalidates session token and clears cookie. |
| `/api/auth/set-password` | `POST` | Required | `{ password }` *(Backend expects `password`)* | `{ success: true }` — Updates current user's password hash. |
| `/api/auth/google/start` | `GET` | Optional | `?scope=drive\|identity` | HTTP 302 Redirect to Google OAuth 2.0 authorization URL. |
| `/api/auth/google/callback` | `GET` | None | `?code=...&state=...` | Exchanges OAuth code, encrypts refresh token, and redirects to client app. |
| `/api/auth/passkey/register-options` | `POST` | Required | None | Returns SimpleWebAuthn registration options with server challenge. |
| `/api/auth/passkey/register-verify` | `POST` | Required | WebAuthn attestation response | Verifies cryptographic signature and registers public key credential. |
| `/api/auth/passkey/login-options` | `POST` | None | `{ email? }` | Returns SimpleWebAuthn assertion challenge options. |
| `/api/auth/passkey/login-verify` | `POST` | None | WebAuthn assertion response | Verifies challenge signature and issues authenticated session cookie. |
| `/api/drive/status` | `GET` | Required | None | `{ connected: boolean, email?: string }` — Returns Google Drive authorization state. |
| `/api/drive/files` | `GET` | Required + Drive | `?folderId=...&query=...` | `{ files: Array<{ id, name, mimeType, size, modifiedTime }> }` — Lists Drive folder contents. |
| `/api/drive/files/:id/meta` | `GET` | Required + Drive | None | Returns metadata, file size, and remote `modifiedTime` for a specific Drive file. |
| `/api/drive/files/:id/content` | `GET` | Required + Drive | None | Streams binary or exported text content directly from Google Drive. |
| `/api/drive/files` | `POST` | Required + Drive | Multipart / JSON file stream | Creates a new file or folder in Google Drive. |
| `/api/drive/files/:id` | `PATCH` | Required + Drive | `{ content, modifiedTime? }` | Updates cloud file content; verifies `modifiedTime` for optimistic concurrency. |
| `/api/drive/disconnect` | `POST` | Required | None | Revokes and purges encrypted Google tokens from the database. |
| `/api/saved-links` | `GET` | Required | `?collection=...` | Returns user's saved Google Drive link records. |
| `/api/saved-links` | `POST` | Required | `{ url, title, collection?, resourceKey? }` | Stores a new saved link reference with parsed Drive metadata. |
| `/api/saved-links/:id` | `DELETE` | Required | None | Deletes a saved link record. |
| `/api/workspaces` | `GET` | Required | None | Returns all workspace session records associated with the user account. |
| `/api/workspaces/sync` | `POST` | Required | `{ workspaceKey, tabs, activeTab, layout }` | Upserts workspace session metadata for cross-device restoration. |
| `/api/transfers/scan` | `POST` | Required + Drive | `{ folderId, manifest: Array<{ path, size, modifiedTime }> }` | Returns classified manifest: `likely_new`, `same_candidate`, `name_collision`. |
| `/api/transfers` | `POST` | Required + Drive | `{ destinationFolderId, items: Array<{ path, action }> }` | Initiates a batch transfer job and returns job tracking ID. |

---

## 8.5 Storage and Cryptographic Security Implementation

### 1. Database Tier: MongoDB with Automatic Fallback
ReadSpace implements a unified database abstraction layer (`server/lib/db.mjs`):
- **MongoDB Atlas (`MONGODB_URI`):** When configured, the backend establishes a connection to MongoDB, utilizing collections for `users`, `connections`, `sessions`, `workspaces`, `savedLinks`, and `transfers`.
- **Local JSON / Memory Fallback:** If `MONGODB_URI` is not set or the cluster is unreachable, ReadSpace logs a warning and initializes a localized JSON database adapter. In serverless environments with read-only file systems (e.g., Vercel), this fallback operates in memory for development and demonstration.

### 2. Google OAuth Token Encryption (AES-256-GCM)
OAuth refresh tokens grant programmatic access to user documents. ReadSpace mandates encryption at rest (`server/lib/crypto.mjs`):
$$\text{Ciphertext} = \text{AES-256-GCM}_{K}(\text{Token}, \text{IV})$$
- The encryption key $K$ is derived from `TOKEN_ENCRYPTION_KEY`.
- Stored database records are formatted as:
  `enc:v1:<base64-iv>:<base64-ciphertext>:<base64-auth-tag>`
- The 16-byte authentication tag guarantees that tokens cannot be tampered with or modified in the database.

### 3. Password Hashing (Salted Scrypt)
Passwords submitted during authentication are processed using Node's cryptographic Scrypt module:
- Salt: 16 cryptographically secure random bytes generated via `crypto.randomBytes(16)`.
- Key Length: 64 bytes.
- Hashing Cost Parameters: $N = 16384$, $r = 8$, $p = 1$.
- Database format: `<hex-salt>:<hex-scrypt-hash>`.

### 4. Hardware Passkey Authentication (WebAuthn)
ReadSpace integrates `@simplewebauthn/server` and `@simplewebauthn/browser`:
- Generates cryptographically secure, time-bounded challenge nonces stored in backend memory and the database.
- Verifies FIDO2 / WebAuthn signature credentials against registered public keys.
- Enforces Origin and Relying Party (RP) ID matching against the requesting host.

### 5. HTML Document Sandboxing
When previewing user-supplied `.html` documents, ReadSpace mounts them inside an `<iframe>` configured with:
```html
<iframe sandbox="allow-same-origin" srcDoc="..." />
```
JavaScript execution is strictly disabled by default. If the user clicks **Enable Scripts**, ReadSpace switches the attribute to `sandbox="allow-scripts"`, deliberately omitting `allow-same-origin` to ensure scripts cannot access the parent application's cookies, `localStorage`, or IndexedDB handles.

---

## 8.6 Local Development Setup

Follow these steps to run the complete ReadSpace platform locally on your development workstation:

### Prerequisites:
- **Node.js:** v18.0.0 or higher
- **npm:** v9.0.0 or higher
- **Git**

### 1. Web Application & Backend Setup
```bash
# Clone the repository
git clone https://github.com/mujju-212/readspace.git
cd readspace

# Install dependencies cleanly
npm ci

# Run static type-checking
npm run typecheck

# Build the production frontend distribution
npm run build

# Launch the integrated server (serves frontend + backend on port 5173)
npm run serve
```

For active frontend development with hot-module replacement (HMR):
```bash
# Terminal 1: Launch backend API server on port 5174
PORT=5174 npm run server

# Terminal 2: Launch Vite development server on port 5173
npm run dev
```
*(The Vite development server automatically proxies all `/api/*` and `/mock/*` requests to `http://localhost:5174`).*

### 2. Mobile Companion Setup
```bash
# Clone the mobile companion repository
git clone https://github.com/mujju-212/readspaceapp.git
cd readspaceapp

# Install mobile dependencies
npm ci

# Run static type-checking
npm run typecheck

# Launch Expo development server for Web testing
npm run web

# Or launch for native development (requires Android Studio / Xcode)
npm run android
npm run ios
```

---

## 8.7 Configuration and Production Deployment

### Environment Variables Reference (`.env`)

Create a `.env` file in the project root:

```ini
# Server Port (default: 5173 for serve; 5174 for standalone server)
PORT=5173

# Application Base URL (used for OAuth redirects and CORS origin validation)
APP_BASE_URL=https://readspace-livid.vercel.app

# Google Cloud OAuth 2.0 Credentials
# (Obtain from Google Cloud Console -> APIs & Services -> Credentials)
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_REDIRECT_URI=https://readspace-livid.vercel.app/api/auth/google/callback

# Token Encryption Secret (Generate with: openssl rand -hex 32)
# MUST BE SET IN PRODUCTION to secure Google OAuth tokens!
TOKEN_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef

# Database Connection (MongoDB Atlas connection string)
# If omitted, ReadSpace operates in local JSON / in-memory fallback mode
MONGODB_URI=mongodb+srv://user:password@cluster.example.mongodb.net/readspace?retryWrites=true&w=majority
```

### Vercel Serverless Deployment Architecture

ReadSpace includes native deployment configuration for **Vercel** (`vercel.json`):
```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api/index.mjs" },
    { "source": "/mock/(.*)", "destination": "/api/index.mjs" },
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```
- **Static Assets:** The Vite-built single page application in `dist/` is deployed to Vercel's global CDN edge network.
- **Serverless API:** Requests to `/api/*` and `/mock/*` are routed to `api/index.mjs`, which initializes the Express API router within a Vercel Serverless Function container.
- **Client-Side Routing:** All remaining URLs route to `/index.html` to allow React Router / client-side tab state management.

---

**Codebase References:**
- Web Shell: [src/App.tsx](file:///d:/AVTIVE%20PROJ/readspace/src/App.tsx)
- Server Entry: [server/index.mjs](file:///d:/AVTIVE%20PROJ/readspace/server/index.mjs)
- Serverless Entry: [api/index.mjs](file:///d:/AVTIVE%20PROJ/readspace/api/index.mjs)
- Backend Router: [server/lib/routes.mjs](file:///d:/AVTIVE%20PROJ/readspace/server/lib/routes.mjs)
- Crypto Engine: [server/lib/crypto.mjs](file:///d:/AVTIVE%20PROJ/readspace/server/lib/crypto.mjs)
- Database Layer: [server/lib/db.mjs](file:///d:/AVTIVE%20PROJ/readspace/server/lib/db.mjs)
- Mobile Entry: [readspace_app/App.tsx](file:///d:/AVTIVE%20PROJ/readspace/readspace_app/App.tsx)
- Vercel Config: [vercel.json](file:///d:/AVTIVE%20PROJ/readspace/vercel.json)
