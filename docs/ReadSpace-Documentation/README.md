# ReadSpace — Complete Platform Documentation Suite

Welcome to the comprehensive, source-based documentation suite for the **ReadSpace** platform. This guide covers every facet of the ecosystem: the desktop and responsive web application, the React Native/Expo mobile companion, the Node.js/Vercel serverless backend, and the Google Drive cloud integration.

---

## Documentation Architecture & Chapters

The documentation is organized into twelve modular, deeply detailed chapters designed for both end users and software engineers:

1. [**00-Overview.md — Platform Overview & Feature Catalog**](00-Overview.md)  
   High-level vision of the platform, the three architectural pillars, core system concepts, visual tour, capability matrix, and explicit system boundaries.

2. [**01-Getting-Started.md — Getting Started & Account Setup**](01-Getting-Started.md)  
   First-visit onboarding on web, sample workspace exploration, local folder mounting with Chromium File System Access vs. snapshot fallback, user account authentication (Scrypt & WebAuthn passkeys), Google Drive connection, and mobile companion setup.

3. [**02-Web-Guide.md — Web Application User Guide**](02-Web-Guide.md)  
   Exhaustive guide to the desktop web workbench: home dashboard, workspace file explorer, multi-tab buffer management, format renderers (Markdown, PDF.js, Mammoth DOCX, custom PPTX, sandboxed HTML, media), live split-view editing, disk persistence, optimistic cloud conflict resolution, themes, and keyboard shortcuts.

4. [**03-Mobile-Guide.md — Mobile Companion Guide**](03-Mobile-Guide.md)  
   Detailed guide to the React Native / Expo SDK 52 mobile application: native architecture vs. responsive web, local file pickers, Android SAF directory trees, iOS multi-document import, mobile Reader mode, slide-out workspace drawer, Google Drive browsing, settings, app updates, and critical security findings (simulated passkeys, password payload mismatch).

5. [**04-Cloud-Data.md — Cloud, Synchronization & Data Architecture**](04-Cloud-Data.md)  
   Deep dive into data flows and boundaries: the four distinct cloud layers (Identity, Drive Authorization, Session Sync, Cloud Transfer), AES-256-GCM token encryption, salted Scrypt hashing, Google Workspace export formats, manifest scan and diffing algorithms, optimistic concurrency guards, complete persistence matrix, and offline policies.

6. [**05-Walkthroughs.md — End-to-End User Walkthroughs**](05-Walkthroughs.md)  
   Twenty structured, step-by-step guided user journeys (W01 through W20) complete with objectives, prerequisites, numbered actions, expected outcomes, troubleshooting steps, and embedded screenshots.

7. [**06-Use-Cases.md — Real-World Use Cases**](06-Use-Cases.md)  
   Eighteen realistic, persona-driven scenarios (UC01 through UC18) detailing how students, researchers, software engineers, and mobile readers leverage ReadSpace to solve daily document workflows.

8. [**07-Technical-Reference.md — Technical Architecture & Deployment Reference**](07-Technical-Reference.md)  
   Engineering reference guide: multi-tier architecture diagrams, web and mobile codebase maps, full backend REST API endpoint specification table, database schema models (MongoDB / JSON fallback), local development setup, environment variables, and Vercel serverless deployment (`vercel.json`).

9. [**08-Verification-Limitations.md — Verification Matrix & Known Limitations**](08-Verification-Limitations.md)  
   Empirical verification report: evidence criteria hierarchy (`[Observed Live]`, `[Build-Checked]`, `[Code-Based]`, `[Target-Specific]`), format compatibility matrix, in-depth analysis of critical source-level findings, and the 12-point release acceptance test suite.

10. [**09-Quick-Reference.md — Quick Reference, FAQ & Glossary**](09-Quick-Reference.md)  
    Rapid-lookup operational reference: quick-action index, full keyboard shortcuts cheat sheet (Windows/Linux/macOS), 16 comprehensive FAQs, and a standardized 20-term architectural glossary.

11. [**10-Workflow-Maps.md — System Workflow Maps**](10-Workflow-Maps.md)  
    Eight high-resolution ASCII and flowchart workflow maps detailing platform connectivity, provider pipelines, authentication lifecycles, manifest comparison pipelines, conflict resolution, multi-tier persistence, mobile execution, and error recovery trees.

12. [**11-Interface-Gallery.md — Visual Interface Gallery**](11-Interface-Gallery.md)  
    Visual showcase containing 18 annotated screenshots of every major interface state across the web workbench and mobile companion, complete with UI component breakdowns and source code references.

---

## Compiling the Consolidated Platform Handbook

All twelve Markdown chapters can be automatically compiled into a single publication-ready Microsoft Word document (`ReadSpace-Platform-Handbook.docx`) using the included Python build script:

```bash
# Navigate to the documentation directory
cd docs/ReadSpace-Documentation

# Run the handbook compiler
python build_handbook.py
```

The script parses each Markdown file via `mistune`, embeds all referenced screenshots using `Pillow`, formats tables with professional shading and borders, applies custom typography styles (Calibri / Consolas), and generates `../ReadSpace-Platform-Handbook.docx`.

---

## Verified Codebase Repositories

- **Web Platform & Backend Repository:** [github.com/mujju-212/readspace](https://github.com/mujju-212/readspace) (Snapshot: `ed7476c18ea6ce5db7c79778f7585dab4be7c845`)
- **Mobile Companion Repository:** [github.com/mujju-212/readspaceapp](https://github.com/mujju-212/readspaceapp) (Snapshot: `8071a88341bbbae8ffe3c548fa18ad16165e3943`)
- **Deployed Production Web Application:** [readspace-livid.vercel.app](https://readspace-livid.vercel.app/)
