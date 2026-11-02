# 7. Real-World Use Cases

This chapter details eighteen practical scenarios demonstrating how ReadSpace solves real-world challenges for students, researchers, software engineers, technical writers, and everyday readers. Each scenario outlines user motivations, step-by-step workflows, underlying technical mechanisms, and empirical verification status.

---

## UC01 — Zero-Install Evaluation and Exploration
- **Primary Persona:** First-Time Web Visitor / Technology Evaluator.
- **Context & Motivation:** A user lands on the ReadSpace website and wants to evaluate its reading interface, format support, and responsiveness immediately without creating an account or selecting private local folders.
- **Preconditions:** Deployed web application is accessible via an internet browser.
- **Narrative Workflow:**
  1. The user visits the ReadSpace home page.
  2. Rather than clicking sign-in, they click **Try the sample workspace**.
  3. The app mounts an in-memory virtual workspace loaded with sample technical guides and an academic research PDF.
  4. The user opens `README.md`, evaluates Markdown typography and code highlighting, switches to `papers/readspace-demo.pdf`, and tests page zooming and pagination.
  5. The user tests theme switching between Ice Blue, Light, Dark, and Sepia before deciding whether to use the app for their personal files.
- **Technical Mechanism:** Virtual `sample` provider (`src/services/fs/sample.ts`) serving bundled assets directly from the application's static distribution.
- **Evidence:** `[Observed Live]` on the production Vercel deployment.

---

## UC02 — Academic Research & Coursework Study
- **Primary Persona:** University Student / Academic Researcher.
- **Context & Motivation:** A student has a local directory on their laptop containing hundreds of lecture slides (PPTX), research papers (PDF), syllabi, and Markdown reading notes across multiple semester courses.
- **Preconditions:** Chromium-based browser supporting the File System Access API; local coursework folder on disk.
- **Narrative Workflow:**
  1. The student clicks **Local Files** and selects their `University/Semester-4` folder.
  2. The workspace explorer indexes the entire semester hierarchy, hiding build clutter.
  3. The student opens `CS301-Syllabus.md` in one tab and `Lecture04-Concurrency.pdf` in an adjacent tab.
  4. As they read the PDF on one side of their screen, they open their notes, entering **Split Mode** to jot down summaries while cross-referencing slides.
  5. Pressing `Ctrl+S` writes their notes directly to their laptop disk.
- **Technical Mechanism:** Chromium `showDirectoryPicker` with persistent directory handle storage in IndexedDB (`src/services/fs/fsa.ts`).
- **Evidence:** `[Code-Based]` file system provider; `[Observed Live]` PDF and Markdown rendering engines.

---

## UC03 — Technical Documentation & Code Review
- **Primary Persona:** Software Engineer / Technical Writer.
- **Context & Motivation:** An engineer needs to review an open-source project's architecture documents, RFC drafts, and configuration files without launching a heavy IDE.
- **Preconditions:** Local repository cloned on disk; modern desktop browser.
- **Narrative Workflow:**
  1. The engineer opens the cloned repository directory in ReadSpace.
  2. ReadSpace automatically ignores `.git`, `node_modules`, `dist`, and binary build directories, presenting a clean architectural overview.
  3. The engineer uses **Quick Open (`Ctrl+P`)** to fuzzy-search `ARCHITECTURE.md` and opens it.
  4. They review architecture diagrams, navigate to related source files, and fix typos directly within ReadSpace's text editor.
  5. Saving the file updates the physical repository working tree, ready for `git commit`.
- **Technical Mechanism:** Automated directory filtering in `src/components/Explorer.tsx`; in-place disk writeback via `FileSystemWritableFileStream`.
- **Evidence:** `[Code-Based]` workspace explorer filtering and editor writeback.

---

## UC04 — Business Presentation & Document Review
- **Primary Persona:** Product Manager / Executive.
- **Context & Motivation:** A manager receives a project folder containing Microsoft Word specifications (`.docx`) and slide presentations (`.pptx`) and wants to review them quickly in a calm, focused reading view.
- **Preconditions:** Accessible `.docx` and `.pptx` documents in the active workspace.
- **Narrative Workflow:**
  1. The manager opens the client proposal folder in ReadSpace.
  2. Clicking `Roadmap.pptx` mounts the custom slide presentation viewer, allowing sequential slide navigation with thumbnail previews.
  3. Clicking `Specification.docx` invokes Mammoth client-side parsing, rendering headers, formatted tables, and inline images cleanly without requiring Microsoft Office installed on the machine.
- **Technical Mechanism:** Mammoth HTML extraction for DOCX; custom presentation slide interpreter (`src/components/viewers/PptxViewer.tsx`).
- **Evidence:** `[Code-Based]` parser implementations and viewer routing.

---

## UC05 — Distraction-Free Long-Form Reading
- **Primary Persona:** Avid Reader / Literature Enthusiast / Legal Analyst.
- **Context & Motivation:** A reader studying an extensive 150-page technical monograph or legal brief wants to eliminate digital distractions, notification clutter, and ocular fatigue.
- **Preconditions:** Accessible document in ReadSpace.
- **Narrative Workflow:**
  1. The reader opens the target document in ReadSpace.
  2. They open **Reader Settings**, selecting the **Sepia** warm paper theme, **Serif** typography, and a generous **Line Height (1.8)** with a constrained **Content Width (75ch)**.
  3. They press `Ctrl+Alt+Z` to activate **Zen Mode**.
  4. The sidebar explorer, top navigation bars, status counters, and tabs vanish entirely. Only the serene, centered text remains on screen.
  5. When finished, pressing `Ctrl+Alt+Z` or clicking the subtle **Exit Zen** button restores standard navigation.
- **Technical Mechanism:** Global CSS layout state toggled via `src/stores/settings.ts`; responsive viewport centering.
- **Evidence:** `[Observed Live]` theme and typography controls; earlier mobile Zen mode demonstrated.

---

## UC06 — Centralized Cloud Workspace on Google Drive
- **Primary Persona:** Remote Knowledge Worker / Consultant.
- **Context & Motivation:** A consultant maintains project deliverables and client briefing documents inside a shared Google Drive folder and wants to read and organize them from any computer without syncing everything locally.
- **Preconditions:** Authenticated ReadSpace user account with authorized Google Drive access.
- **Narrative Workflow:**
  1. The consultant signs in and navigates to **Google Drive → Browse Google Drive**.
  2. They select their `Client-Projects/Acme-Corp` folder and click **Select Folder**.
  3. ReadSpace mounts the remote Drive folder as their active workspace.
  4. The consultant streams PDFs, reviews meeting notes, and edits project agendas directly in the cloud.
- **Technical Mechanism:** Virtual `clouddrive` file system provider (`src/services/fs/cloud.ts`) communicating via authenticated backend proxy routes (`/api/drive/*`).
- **Evidence:** `[Code-Based]` cloud provider and API routes; real Google OAuth requires deployment credentials.

---

## UC07 — Curating Cross-Project Shared Links
- **Primary Persona:** Research Collaborator / Team Lead.
- **Context & Motivation:** A team lead is sent multiple individual Google Drive links by colleagues across different departments and needs a single organized place to bookmark, tag, and read them.
- **Preconditions:** Valid Google Drive file URLs and read permissions.
- **Narrative Workflow:**
  1. The lead opens **Save Link** on the ReadSpace home dashboard.
  2. They paste a Google Drive URL (`https://drive.google.com/file/d/1a2b3c.../view?usp=sharing`).
  3. ReadSpace extracts the file ID and `resourcekey`, prompting for a custom title (*Q4 Budget Analysis*) and collection tag (*Finance*).
  4. The lead saves the link and later accesses it from the **Saved Links** explorer tab on both desktop and mobile companion apps.
- **Technical Mechanism:** Client-side Google Drive URL parsing (`src/features/cloud/cloudLinkUtils.ts`); backend metadata persistence in MongoDB/JSON collections (`/api/saved-links`).
- **Evidence:** `[Code-Based]` link parser and API storage routines.

---

## UC08 — Controlled Local-to-Cloud Workspace Archival
- **Primary Persona:** Project Archivist / Cautious User.
- **Context & Motivation:** A user completes a research project on their local laptop and wants to back up all new files to Google Drive while avoiding accidental duplicate uploads or overwriting existing cloud assets.
- **Preconditions:** Active local workspace; connected Google Drive account with target backup folder.
- **Narrative Workflow:**
  1. The user opens the **Transfer Panel** in ReadSpace.
  2. They select their target Drive destination folder and click **Scan Local Files**.
  3. The system scans the local workspace manifest and classifies all files: 12 new notes (`likely_new`), 4 unchanged PDFs (`same_candidate`), and 1 modified document (`name_collision`).
  4. The user clicks **Upload New Only**, ensuring that only the 12 new notes are uploaded without wasting bandwidth or creating cloud duplicates.
- **Technical Mechanism:** Client manifest generator + `POST /api/transfers/scan` classification engine (`src/features/cloud/autoSync.ts`).
- **Evidence:** `[Code-Based]` manifest scanning and transfer job queue.

---

## UC09 — Selective Cloud Asset Extraction for Offline Work
- **Primary Persona:** Field Engineer / Traveling Consultant.
- **Context & Motivation:** Prior to boarding a flight, an engineer needs local offline copies of specific equipment schematics stored in a remote Google Drive folder.
- **Preconditions:** Connected Google Drive workspace; local destination directory.
- **Narrative Workflow:**
  1. The engineer browses their Google Drive workspace in ReadSpace.
  2. They select the `Schematics/Site-B` folder, right-click, and choose **Download to Local**.
  3. They designate a local folder via the File System Access API.
  4. ReadSpace streams the remote files through the backend and writes them directly into the local folder.
  5. The engineer confirms the downloaded files appear in their local explorer, ready for offline reading during transit.
- **Technical Mechanism:** Chunked file streaming via `/api/drive/files/:id/content` piped to local `FileSystemDirectoryHandle`.
- **Evidence:** `[Code-Based]` transfer download pipeline.

---

## UC10 — Guarded Multi-Device Collaborative Editing
- **Primary Persona:** Technical Co-Author.
- **Context & Motivation:** Two authors collaborate on a shared Google Drive Markdown manuscript. Author A begins editing section 4 on their laptop while Author B makes edits to section 2 from another computer.
- **Preconditions:** Shared editable Markdown file in a Google Drive workspace.
- **Narrative Workflow:**
  1. Author A opens the cloud document in ReadSpace; the app captures the remote `modifiedTime` timestamp ($T_1$).
  2. While Author A is typing, Author B saves external changes to Google Drive ($T_2$).
  3. Author A presses `Ctrl+S` to save. ReadSpace detects that the remote timestamp ($T_2$) differs from their initial baseline ($T_1$).
  4. The **Cloud Conflict Dialog** halts the write and presents options.
  5. Author A selects **Save My Copy**, creating a separate file in Drive preserving their edits while leaving Author B's changes unharmed.
- **Technical Mechanism:** Concurrency guard checking Google Drive `modifiedTime` in `src/components/ViewerHost.tsx`.
- **Evidence:** `[Code-Based]` conflict dialog and concurrency interceptor.

---

## UC11 — Touch-Optimized Reading on Mobile Companion
- **Primary Persona:** Daily Commuter / Mobile Reader.
- **Context & Motivation:** A reader commuting via subway wants to read downloaded papers on their smartphone using touch gestures, clean typography, and quick chapter navigation.
- **Preconditions:** ReadSpace Mobile Companion installed on iOS or Android.
- **Narrative Workflow:**
  1. The reader launches the mobile app and taps **Library → On Device**.
  2. They open a 40-page technical paper.
  3. The Reader screen opens in distraction-free reading mode with optimal font scaling.
  4. To jump between chapters, the reader taps the **Folder Tree** icon in the header, sliding out the workspace drawer.
  5. They select chapter 3, bookmark their location, and resume reading with one-handed scrolling.
- **Technical Mechanism:** React Native `HybridReader` component with slide-out `WorkspaceDrawer` navigation.
- **Evidence:** `[Code-Based]` mobile screen stack; earlier mobile web prototype demonstrated.

---

## UC12 — Intermittent Offline Reading in Remote Areas
- **Primary Persona:** Field Geologist / Remote Inspector.
- **Context & Motivation:** A worker operates in areas with spotty or nonexistent cellular data and needs guaranteed access to previously inspected field manuals.
- **Preconditions:** Documents opened and cached on the mobile device while connected.
- **Narrative Workflow:**
  1. While in the office on Wi-Fi, the inspector browses their Google Drive library and opens all required site manuals.
  2. The mobile companion caches the document binary data and indexes metadata in local `AsyncStorage`.
  3. In the field with zero cellular coverage, the inspector opens the app.
  4. The app detects offline status and loads the manuals instantly from local cache via bundled offline rendering engines.
- **Technical Mechanism:** Local file storage in device cache directory combined with bundled reader engines (`src/vendor/offlineVendors.ts`).
- **Evidence:** `[Code-Based]` offline vendor bundles and storage layer.

---

## UC13 — Seamless Desktop-to-Mobile Continuity
- **Primary Persona:** Cross-Platform Professional.
- **Context & Motivation:** A professional begins reading an industry report at their office desktop and wants to continue reading from the exact same page on their phone during their commute home.
- **Preconditions:** Signed-in user account on both Web and Mobile; shared document stored in Google Drive or Saved Links.
- **Narrative Workflow:**
  1. The user reads page 14 of a cloud PDF on their desktop browser.
  2. ReadSpace debounces and syncs the reading progress to `/api/workspaces/sync`.
  3. The user shuts down their computer and boards their train.
  4. Opening the ReadSpace Mobile Companion on their phone, the **Continue Reading** card highlights the exact same report.
  5. Tapping the card opens the PDF and scrolls directly to page 14.
- **Technical Mechanism:** Backend workspace session tracking in `workspaceSessions` collection; mobile Home screen session resume handler.
- **Evidence:** `[Code-Based]` session synchronization routes and client stores.

---

## UC14 — Multimedia Lecture Study & Audio Notes
- **Primary Persona:** Online Course Student.
- **Context & Motivation:** A student studying an online course has a folder containing audio lecture recordings (`.m4a`), summary slides (`.pptx`), and Markdown notes.
- **Preconditions:** Media files and documents in the active workspace.
- **Narrative Workflow:**
  1. The student mounts their course folder in ReadSpace.
  2. They open `Lecture-Audio.m4a` in one tab and their Markdown note file in an adjacent tab.
  3. Using the integrated media player, the student plays the lecture at 1.25x speed.
  4. They switch to the note tab, typing notes in Split View while the audio continues playing smoothly in the background.
- **Technical Mechanism:** HTML5 Audio API in Web; Expo AV / Background Audio thread in Mobile Companion (`readspace_app/src/screens/SettingsScreen.tsx`).
- **Evidence:** `[Code-Based]` media viewer and background audio preference.

---

## UC15 — Privacy Audit and Complete Local Storage Purge
- **Primary Persona:** Privacy-Conscious User / Shared Computer Operator.
- **Context & Motivation:** A user accessing ReadSpace on a borrowed laptop or temporary workstation wants to ensure that all local directory handles, cached document drafts, and cloud credentials are completely erased before departing.
- **Preconditions:** Active reading session on web or mobile.
- **Narrative Workflow:**
  1. The user clicks **Account → Disconnect Google Drive**. ReadSpace deletes all encrypted OAuth tokens from the backend database.
  2. The user signs out of their account, clearing session cookies and authorization headers.
  3. On mobile or web settings, the user clicks **Clear Storage & Cache**.
  4. ReadSpace purges all IndexedDB object stores (`handles`, `drafts`, `snapshots`), clears `localStorage`, and wipes application caches.
- **Technical Mechanism:** Explicit database document deletion (`server/lib/routes.mjs`) + client IndexedDB database deletion (`src/services/persistence.ts`).
- **Evidence:** `[Code-Based]` storage clearance routines.

---

## UC16 — Self-Hosting a Private ReadSpace Node
- **Primary Persona:** DevOps Engineer / Privacy Advocate.
- **Context & Motivation:** An organization wants to host a private ReadSpace instance on their own internal server, connecting it to an enterprise MongoDB cluster and Google Cloud enterprise project.
- **Preconditions:** Node.js 18+ runtime, Google Cloud OAuth credentials, and MongoDB connection string.
- **Narrative Workflow:**
  1. The engineer clones the repository, configures `.env` with `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY`, and `MONGODB_URI`.
  2. They build the frontend via `npm run build` and launch the server using `npm run serve`.
  3. Team members connect their browsers and mobile apps to `https://readspace.internal.corp`, enjoying secure internal reading with full database durability.
- **Technical Mechanism:** Combined Express/Vercel serverless runtime (`server/index.mjs`) supporting MongoDB with automated JSON/memory fallback.
- **Evidence:** `[Code-Based]` environment configuration and build scripts; web build and typecheck verified.

---

## UC17 — Resilient Error Recovery from Lost Permissions
- **Primary Persona:** Standard Everyday User.
- **Context & Motivation:** A user reboots their operating system and returns to ReadSpace. The browser has revoked active directory permissions for security reasons.
- **Preconditions:** Reopened browser tab with a previously accessed local workspace.
- **Narrative Workflow:**
  1. The user opens ReadSpace; the explorer sidebar displays a warning banner: *"Permission to local folder has expired."*
  2. Rather than re-picking the folder and losing their tab layout, the user clicks **Verify Permission**.
  3. The browser prompts: *"Allow ReadSpace to view files in Documents?"*
  4. The user clicks **Allow**. ReadSpace instantly re-validates the stored handle, restoring their workspace, open tabs, and reading offsets without data loss.
- **Technical Mechanism:** `FileSystemHandle.requestPermission()` re-verification workflow in `src/services/fs/fsa.ts`.
- **Evidence:** `[Code-Based]` permission re-verification loop.

---

## UC18 — Seamless Mobile Application Updates
- **Primary Persona:** Mobile Companion User.
- **Context & Motivation:** A mobile user wants to ensure their app receives the latest performance optimizations, reader bug fixes, and security patches automatically.
- **Preconditions:** Mobile app installed on smartphone with internet access.
- **Narrative Workflow:**
  1. The user opens mobile **Settings** and taps **Check for Updates**.
  2. The app contacts the update service. If an Expo OTA update is available, it downloads in the background.
  3. The app prompts: *"Update installed. Restart app to apply?"*
  4. The user taps **Restart**; the app reloads instantly with the updated code bundle without requiring an app store download.
- **Technical Mechanism:** `expo-updates` integration with automated GitHub Release tag fallback (`readspace_app/src/services/update.ts`).
- **Evidence:** `[Code-Based]` update checking service.

---

**Codebase References:**
- Sample Provider: [src/services/fs/sample.ts](file:///d:/AVTIVE%20PROJ/readspace/src/services/fs/sample.ts)
- File System Access: [src/services/fs/fsa.ts](file:///d:/AVTIVE%20PROJ/readspace/src/services/fs/fsa.ts)
- Cloud Sync Engine: [src/features/cloud/autoSync.ts](file:///d:/AVTIVE%20PROJ/readspace/src/features/cloud/autoSync.ts)
- Viewer Host: [src/components/ViewerHost.tsx](file:///d:/AVTIVE%20PROJ/readspace/src/components/ViewerHost.tsx)
- Mobile Settings Screen: [readspace_app/src/screens/SettingsScreen.tsx](file:///d:/AVTIVE%20PROJ/readspace/readspace_app/src/screens/SettingsScreen.tsx)
- Mobile Update Service: [readspace_app/src/services/update.ts](file:///d:/AVTIVE%20PROJ/readspace/readspace_app/src/services/update.ts)
