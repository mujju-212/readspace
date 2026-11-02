# 10. Quick Reference, FAQ, and Glossary

This chapter provides a rapid-lookup operational reference for ReadSpace, including quick-action cheat sheets, comprehensive keyboard shortcut bindings, answers to frequently asked questions, and a standardized architectural glossary.

---

## 10.1 Quick Actions Index

| User Goal | Starting Point in App | Shortcut / Action | Key Operational Note |
|---|---|---|---|
| **Test Without Account** | Web Home Screen | Click **Try the sample workspace** | Instant zero-install sandbox; runs in browser memory. |
| **Open Local PC Folder** | Web Home or Top Toolbar | Click **Local Files** or **Open Folder** | Chrome/Edge support direct read/write; Firefox/Safari are read-only. |
| **Open Mobile Document** | Mobile Home or Library | Tap **Open File** | Invokes native system picker (`expo-document-picker`). |
| **Mount Mobile Directory** | Mobile Home or Library | Tap **Open Folder** | Android uses Storage Access Framework; iOS uses multi-file import. |
| **Find File in Workspace** | Anywhere in Workspace | Press `Ctrl+P` (Mac: `Cmd+P`) | Instant modal fuzzy search across the active file index. |
| **Toggle File Explorer** | Anywhere in Workspace | Press `Ctrl+B` (Mac: `Cmd+B`) | Collapses or expands the left sidebar to maximize reading area. |
| **Read Without Clutter** | Any Open Document | Press `Ctrl+Alt+Z` (Mac: `Cmd+Opt+Z`) | Enters Zen Mode; hides all peripheral bars and tools. |
| **Edit Markdown / Notes** | Open Text / Markdown File | Click **Split** in viewer toolbar | Divides canvas into synchronized editor and rendered preview panes. |
| **Save Document Edits** | Open Editor / Split View | Press `Ctrl+S` (Mac: `Cmd+S`) | Writes changes to local disk (Chromium) or triggers download. |
| **Connect Google Drive** | Web Home or Account Menu | Click **Google Drive → Connect Drive** | Authorizes Google Drive access via OAuth 2.0 consent flow. |
| **Mount Remote Drive** | Web Top Toolbar | Click **Google Drive → Browse Drive** | Mounts a cloud folder hierarchy directly into the workspace tree. |
| **Save Cloud Bookmark** | Web Home or Mobile Library | Click / Tap **Save Link** | Stores a direct Google Drive link with resource keys and tags. |
| **Upload to Google Drive** | Web Toolbar (Cloud Workspace)| Click **Transfer / Sync** | Scans local files, compares against Drive, and executes batch upload. |
| **Download from Drive** | Workspace Explorer | Right-click file/folder → **Download** | Streams remote files to local disk or triggers browser download. |
| **Switch Visual Palette** | Web Toolbar or Mobile Settings | Click Theme Icon / Tap Theme Name | Cycles through **Ice Blue**, **Light**, **Dark**, and **Sepia**. |
| **Clear Local Cache** | Mobile Settings or Web Browser| Tap **Clear Cache** in Settings | Purges offline metadata and document cache; preserves original files. |

---

## 10.2 Complete Keyboard Shortcuts Reference

| Windows / Linux | macOS | Scope | Action Performed |
|---|---|---|---|
| `Ctrl+P` | `Cmd+P` | Global Workspace | Opens Quick Open fuzzy file search dialog. |
| `Ctrl+B` | `Cmd+B` | Global Workspace | Toggles left Workspace Explorer sidebar visibility. |
| `Ctrl+S` | `Cmd+S` | Document Editor | Saves active file edits to disk or Google Drive. |
| `Ctrl+W` | `Cmd+W` | Open Tabs | Closes active document tab (prompts if unsaved edits exist). |
| `Ctrl+Tab` | `Ctrl+Tab` | Open Tabs | Cycles focus to the next document tab. |
| `Ctrl+Shift+Tab` | `Ctrl+Shift+Tab` | Open Tabs | Cycles focus to the previous document tab. |
| `Ctrl+Alt+Z` | `Cmd+Option+Z` | Global Reader | Toggles Zen distraction-free reading mode. |
| `Escape` | `Escape` | Modals / Dialogs | Closes Quick Open dialog, transfer panel, or settings drawer. |
| `Arrow Left` / `Right` | `Arrow Left` / `Right` | PDF / Slide Viewer | Navigates to previous or next document page/slide. |

---

## 10.3 Frequently Asked Questions (FAQ)

### General & Setup
**Q: Do I need to create an account or sign in to read documents?**
> **No.** ReadSpace is built as a local-first application. You can explore the sample workspace or open and read local folders on your computer completely anonymously without creating an account. Accounts are only needed if you want Google Drive integration or cross-device session synchronization.

**Q: Is ReadSpace a cloud-only service like Google Docs or Notion?**
> **No.** Your documents are never uploaded to a ReadSpace server simply by opening or reading them. All local folder parsing, Markdown rendering, and PDF viewing happen directly on your local device.

### Local Files & Editing
**Q: Can I edit Markdown or text files directly on my computer?**
> **Yes, on supported browsers.** When using Google Chrome, Microsoft Edge, Brave, or Opera on desktop, ReadSpace leverages the File System Access API. Pressing `Ctrl+S` writes changes directly back to your physical file on disk.

**Q: Why did pressing `Ctrl+S` trigger a browser download instead of saving directly to disk?**
> This occurs if your browser does not support direct disk writing (such as Apple Safari or Mozilla Firefox), or if you granted read-only permission when selecting the folder. To avoid losing your edits, ReadSpace automatically downloads the updated file to your computer.

**Q: Can I edit PDF, Word (`.docx`), or PowerPoint (`.pptx`) files in ReadSpace?**
> **No.** ReadSpace is designed as a reading, annotation, and review workspace for rich media. Editing capabilities are intentionally restricted to plain text, Markdown, HTML, and configuration code files.

### Cloud & Google Drive
**Q: Does connecting my Google Drive upload all my computer's files?**
> **Absolutely not.** Connecting Google Drive simply grants ReadSpace permission to browse and stream your existing Drive files. ReadSpace will never upload your local files unless you explicitly open the Transfer Panel, scan a directory, and click **Upload Selected**.

**Q: Is ReadSpace an automatic two-way background sync client like Google Drive for Desktop?**
> **No.** ReadSpace intentionally avoids automatic continuous background sync to prevent unexpected bandwidth consumption, battery drain, and accidental file overwrites. All transfers between local storage and Google Drive are explicitly initiated and confirmed by the user.

**Q: What happens if someone else edits a Google Drive file while I am working on it?**
> ReadSpace checks remote timestamps before saving. If a remote modification is detected, ReadSpace intercepts the save and presents the **Cloud Conflict Dialog**, allowing you to overwrite the remote file, save your edits as a separate timestamped copy, or reload the remote version.

### Mobile Companion App
**Q: Is the Mobile Companion app just a mobile web browser bookmark?**
> **No.** The ReadSpace Mobile Companion is a standalone React Native application built with Expo SDK 52. It includes native file pickers, native document rendering engines, persistent local storage (`AsyncStorage`), and background audio support.

**Q: Are mobile passkeys real biometric credentials?**
> **Not in the current mobile companion build.** While the web platform integrates SimpleWebAuthn, the current mobile client uses a placeholder simulation (`AccountSecurityModal.tsx`). Do not treat mobile passkeys as biometric security controls; use email/password or Google OAuth on mobile.

**Q: Does the mobile Activity tab show all my previous file transfers?**
> **No.** The current mobile Activity screen contains static demonstration records. Live transfer tracking is fully operational on the web platform's Transfer Panel.

### Offline & Data Safety
**Q: Can I read my documents while offline or on an airplane?**
> **Yes.** Local files and previously cached Google Drive documents remain fully accessible offline. The app shell and rendering engines are bundled within the application package, allowing you to read without an active internet connection.

**Q: What happens if I click "Clear Cache" in Settings?**
> Clearing cache removes temporary offline metadata, document history, and cached thumbnails. **It never deletes your physical files on your computer's hard drive or deletes your files in Google Drive.**

---

## 10.4 Standardized Technical Glossary

| Term | Technical Definition in ReadSpace Architecture |
|---|---|
| **Workspace** | A self-contained directory hierarchy mounted within the app, originating from a local folder handle, directory snapshot, Google Drive folder, or sample project. |
| **Provider (`FileSystemProvider`)** | The abstraction layer (`src/services/fs/types.ts`) exposing uniform asynchronous methods (`listDir`, `readFile`, `readText`, `writeFile`, `stat`) across local and cloud backends. |
| **File System Access API (FSA)** | Modern web standard (`window.showDirectoryPicker`) allowing Chromium browsers to read and write directly to physical operating system files. |
| **Read-Only Snapshot** | An in-memory and IndexedDB buffered representation of a folder created via standard HTML5 directory inputs on browsers lacking FSA. |
| **ViewerHost** | The dynamic component (`src/components/ViewerHost.tsx`) responsible for inspecting file formats and mounting specialized rendering engines. |
| **Tab Store** | Zustand state store (`src/stores/tabs.ts`) managing open document buffers, active tab focus, and unsaved edit tracking. |
| **Session Metadata** | JSON metadata tracking active workspace configuration (open tabs, active file, scroll offsets) synchronized to the backend for cross-device continuity. |
| **Saved Link** | A stored reference to a Google Drive file or folder, complete with extracted resource keys, collection tags, custom titles, and reading progress records. |
| **Resource Key (`resourcekey`)** | A Google Drive security query parameter required to access certain shared files and folders. |
| **Cloud Transfer** | A user-initiated batch upload or download operation moving binary content between local storage and Google Drive via backend proxy streams. |
| **Manifest Scan** | A client-side traversal of up to 1,000 local files generating relative paths, byte sizes, and timestamps for comparison against remote cloud folders. |
| **Optimistic Concurrency** | A concurrency control mechanism where writes to cloud files verify that remote `modifiedTime` has not changed since the document was opened. |
| **Auto-Draft** | An automatic client-side backup mechanism that debounces in-flight text edits into browser IndexedDB storage to prevent accidental data loss. |
| **Zen Mode** | An immersive reading view that collapses all peripheral toolbars, sidebars, and tab bars, centering document typography. |
| **HybridReader** | The mobile reading component (`readspace_app/src/components/HybridReader.tsx`) that mounts a native WebView container on Android/iOS and DOM renderers on Expo Web. |
| **Storage Access Framework (SAF)** | Android operating system API providing secure, persistent directory traversal permissions for sandboxed applications. |
| **Scrypt** | Cryptographic key derivation function used on the backend to securely salt and hash user passwords. |
| **AES-256-GCM** | Authenticated symmetric encryption algorithm used by the backend to encrypt Google OAuth refresh tokens at rest. |
| **SimpleWebAuthn** | Library implementing FIDO2 / WebAuthn hardware passkey registration and assertion verification on the backend. |
| **OTA Update** | Over-The-Air application update mechanism enabling Expo to deploy JavaScript bundle patches without requiring app store resubmission. |

---

**Codebase References:**
- Tab State Store: [src/stores/tabs.ts](file:///d:/AVTIVE%20PROJ/readspace/src/stores/tabs.ts)
- Settings Store: [src/stores/settings.ts](file:///d:/AVTIVE%20PROJ/readspace/src/stores/settings.ts)
- File System Contracts: [src/services/fs/types.ts](file:///d:/AVTIVE%20PROJ/readspace/src/services/fs/types.ts)
- Backend Router: [server/lib/routes.mjs](file:///d:/AVTIVE%20PROJ/readspace/server/lib/routes.mjs)
- Mobile Storage: [readspace_app/src/services/storage.ts](file:///d:/AVTIVE%20PROJ/readspace/readspace_app/src/services/storage.ts)
