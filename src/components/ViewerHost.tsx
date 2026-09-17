import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useTabs, type Tab } from '../stores/tabs';
import { useWorkspace } from '../stores/workspace';
import { toast } from '../stores/toast';
import { EDITABLE_RENDERERS, rendererForExt, rendererLabel } from '../services/fs/types';
import { DriveConflictError } from '../services/fs/cloud';
import { confirmOptions } from '../stores/confirm';
import { countWords, downloadText } from '../services/assets';
import { clearDraft, loadDraft, scheduleDraft } from '../services/persistence';
import ErrorBoundary from './ErrorBoundary';
import MarkdownView from './viewers/MarkdownView';
import TextView from './viewers/TextView';
import HtmlView from './viewers/HtmlView';
import ImageView from './viewers/ImageView';
import UnsupportedView from './viewers/UnsupportedView';
import PlainEditor from './editors/PlainEditor';
import { Spinner } from './viewers/PdfView';
import { Eye, Pencil, Split } from './Icons';

const PdfView = React.lazy(() => import('./viewers/PdfView'));
const DocxView = React.lazy(() => import('./viewers/DocxView'));
const AudioView = React.lazy(() => import('./viewers/AudioView'));
const VideoView = React.lazy(() => import('./viewers/VideoView'));
const PptxView = React.lazy(() => import('./viewers/PptxView'));
const CodeEditor = React.lazy(() => import('./editors/CodeEditor'));

/** text cache so toggling Preview↔Edit never re-reads the file */
const textCache = new Map<string, string>();
function trimCache(m: Map<string, string>, max: number) {
  while (m.size > max) m.delete(m.keys().next().value as string);
}

/** scroll position per file, restored when a tab is re-activated (FR-50);
 *  exported so account-level session sync (PRD §17.1) can persist positions */
const scrollMemory = new Map<string, number>();
export function getScrollFor(path: string): number | undefined {
  return scrollMemory.get(path);
}
export function setScrollFor(path: string, top: number): void {
  scrollMemory.set(path, top);
}

type Loaded =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; fileText?: string; buffer?: ArrayBuffer };

/**
 * The content area from the sketch ("Cont") — renders the active tab with the
 * right viewer, owns the Preview | Edit toggle (top-right, FR-30) and saving
 * (FR-32). PDF/DOCX hide the toggle (FR-35).
 */
export function ViewerHost({ tab }: { tab: Tab }) {
  const provider = useWorkspace((s) => s.provider)!;
  const version = useWorkspace((s) => s.versions[tab.path] ?? 0);
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  const [text, setText] = useState('');
  const [reloadTick, setReloadTick] = useState(0);
  const baseline = useRef('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const rendererId: string = tab.forceText ? 'text' : rendererForExt(tab.ext);
  const editable = tab.forceText || EDITABLE_RENDERERS.has(rendererId as never);
  const isTextual = editable || rendererId === 'text';

  /* ---------- load ---------- */
  useEffect(() => {
    let alive = true;
    setLoaded({ status: 'loading' });
    void (async () => {
      try {
        const key = `${provider.id}::${tab.path}`;
        if (isTextual) {
          let t = textCache.get(key);
          if (t === undefined) {
            t = await provider.readText(tab.path);
            textCache.set(key, t);
            trimCache(textCache, 24);
          }
          if (!alive) return;
          // crash recovery: unsaved draft beats file content (NFR: reliability)
          let draft: string | null = null;
          try {
            draft = await loadDraft(provider.id, tab.path);
          } catch { /* draft is optional, never fail file opening */ }
          const restored = draft !== null && draft !== t ? draft : t;
          baseline.current = t;
          setText(restored);
          useTabs.getState().setDirty(tab.id, restored !== t);
          if (restored !== t) toast('Restored unsaved edits from your last session', 'warn');
          setLoaded({ status: 'ready', fileText: t });
        } else {
          const buf = await provider.readFile(tab.path);
          if (!alive) return;
          setLoaded({ status: 'ready', buffer: buf });
        }
      } catch (e) {
        if (alive) setLoaded({ status: 'error', message: String((e as Error).message ?? e) });
      }
    })();
    return () => { alive = false; };
  }, [provider, tab.path, tab.id, isTextual, version, reloadTick]);

  /* ---------- scroll memory ---------- */
  const pathAtEffect = useRef(tab.path);
  pathAtEffect.current = tab.path;
  const scrolled = loaded.status === 'ready';
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = scrollMemory.get(tab.path) ?? 0;
    const onScroll = () => scrollMemory.set(pathAtEffect.current, el.scrollTop);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [tab.path, scrolled]);

  /* ---------- editing ---------- */
  const onEdit = useCallback(
    (v: string) => {
      setText(v);
      useTabs.getState().setDirty(tab.id, v !== baseline.current);
      scheduleDraft(provider.id, tab.path, v);
    },
    [tab.id, tab.path, provider.id],
  );

  /* ---------- save (FR-32, Ctrl+S; DRV-07 + SYNC-01 for cloud files) ---------- */
  const save = useCallback(async () => {
    if (loaded.status !== 'ready') return;
    try {
      await provider.writeFile(tab.path, text);
      textCache.set(`${provider.id}::${tab.path}`, text);
      baseline.current = text;
      useTabs.getState().setDirty(tab.id, false);
      void clearDraft(provider.id, tab.path);
      useWorkspace.getState().bumpVersion(tab.path);
      toast(`Saved ${tab.title}`, 'ok');
    } catch (e) {
      if (e instanceof DriveConflictError) {
        // SYNC-01: remote changed after we opened it — never silently overwrite
        const choice = await confirmOptions(
          `“${tab.title}” changed on Google Drive${e.remote.modifiedTime ? ` (${new Date(e.remote.modifiedTime).toLocaleString()})` : ''} after you opened it.\nYour edits are safe as a draft. What now?`,
          [
            { value: 'overwrite', label: 'Overwrite remote', kind: 'danger' },
            { value: 'copy', label: 'Save my copy' },
            { value: 'remote', label: 'Load remote version', kind: 'primary' },
          ],
        );
        try {
          if (choice === 'overwrite' && 'writeFileForce' in provider) {
            await (provider as { writeFileForce: (p: string, d: string) => Promise<void> }).writeFileForce(tab.path, text);
            textCache.set(`${provider.id}::${tab.path}`, text);
            baseline.current = text;
            useTabs.getState().setDirty(tab.id, false);
            void clearDraft(provider.id, tab.path);
            useWorkspace.getState().bumpVersion(tab.path);
            toast(`Overwrote remote ${tab.title}`, 'warn');
          } else if (choice === 'copy' && 'saveCopy' in provider) {
            await (provider as { saveCopy: (p: string, d: string) => Promise<void> }).saveCopy(tab.path, text);
            useTabs.getState().setDirty(tab.id, false);
            toast('Saved a copy alongside the original', 'ok');
          } else if (choice === 'remote') {
            const remoteText = await provider.readText(tab.path);
            textCache.set(`${provider.id}::${tab.path}`, remoteText);
            baseline.current = remoteText;
            setText(remoteText);
            useTabs.getState().setDirty(tab.id, false);
            void clearDraft(provider.id, tab.path);
            useWorkspace.getState().bumpVersion(tab.path);
            toast('Loaded the remote version — your draft was discarded', 'warn');
          }
        } catch (err) {
          toast(String((err as Error).message), 'warn');
        }
        return;
      }
      downloadText(tab.title, text);
      toast('Workspace is read-only — downloaded a copy instead', 'warn');
    }
  }, [loaded.status, provider, tab.path, tab.title, tab.id, text]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save]);

  if (loaded.status === 'loading') return <Spinner label={`Opening ${tab.title}…`} />;

  if (loaded.status === 'error') {
    const isPermission = loaded.message.toLowerCase().includes('not allowed') ||
                         loaded.message.toLowerCase().includes('permission') ||
                         loaded.message.toLowerCase().includes('notallowederror');
    return (
      <div className="empty-state">
        <div className="empty-icon">{isPermission ? '📂' : '⚠️'}</div>
        <h2>{isPermission ? `Permission needed for ${tab.title}` : `Couldn't open ${tab.title}`}</h2>
        <p className="muted">{isPermission ? 'Click below to allow ReadSpace to read this file.' : loaded.message}</p>
        <div className="empty-actions">
          {isPermission && provider && 'handle' in provider ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={async () => {
                const { reconnectFsa } = await import('../services/fs/open');
                const ok = await reconnectFsa((provider as any).handle);
                if (ok) {
                  setReloadTick((t) => t + 1);
                  void useWorkspace.getState().refreshRoot();
                } else {
                  toast('Please allow permission in the browser prompt', 'warn');
                }
              }}
            >
              Grant Permission
            </button>
          ) : (
            <button type="button" className="btn" onClick={() => setReloadTick((t) => t + 1)}>Retry</button>
          )}
        </div>
      </div>
    );
  }

  const renderPreview = () => {
    switch (rendererId) {
      case 'markdown':
        return <ErrorBoundary><MarkdownView text={text} path={tab.path} /></ErrorBoundary>;
      case 'html':
        return <ErrorBoundary><HtmlView text={text} path={tab.path} /></ErrorBoundary>;
      case 'text':
        return <TextView text={text} />;
      case 'pdf':
        return (
          <Suspense fallback={<Spinner label="Loading PDF engine…" />}>
            <ErrorBoundary><PdfView buffer={loaded.buffer!} name={tab.title} /></ErrorBoundary>
          </Suspense>
        );
      case 'docx':
        return (
          <Suspense fallback={<Spinner label="Loading document engine…" />}>
            <ErrorBoundary><DocxView buffer={loaded.buffer!} name={tab.title} /></ErrorBoundary>
          </Suspense>
        );
      case 'image':
        return <ImageView buffer={loaded.buffer!} name={tab.title} />;
      case 'audio':
        return (
          <Suspense fallback={<Spinner label="Loading audio player…" />}>
            <ErrorBoundary><AudioView buffer={loaded.buffer!} name={tab.title} path={tab.path} /></ErrorBoundary>
          </Suspense>
        );
      case 'video':
        return (
          <Suspense fallback={<Spinner label="Loading video player…" />}>
            <ErrorBoundary><VideoView buffer={loaded.buffer!} name={tab.title} path={tab.path} /></ErrorBoundary>
          </Suspense>
        );
      case 'pptx':
        return (
          <Suspense fallback={<Spinner label="Loading presentation engine…" />}>
            <ErrorBoundary><PptxView buffer={loaded.buffer!} name={tab.title} /></ErrorBoundary>
          </Suspense>
        );
      default:
        return <UnsupportedView path={tab.path} />;
    }
  };

  const editorPane = (
    <div className="editor-pane">
      <Suspense fallback={<PlainEditor value={text} onChange={onEdit} />}>
        <ErrorBoundary fallback={<PlainEditor value={text} onChange={onEdit} />}>
          <CodeEditor
            value={text}
            onChange={onEdit}
            lang={rendererId === 'markdown' ? 'markdown' : rendererId === 'html' ? 'html' : 'text'}
          />
        </ErrorBoundary>
      </Suspense>
    </div>
  );

  return (
    <div className="viewer" data-ext={tab.ext}>
      {editable && (
        <div className="mode-toggle" role="group" aria-label="Preview or edit">
          <ModeButton tab={tab} mode="preview" icon={<Eye size={13} />} label="Preview" />
          <ModeButton tab={tab} mode="split" icon={<Split size={13} />} label="Split" />
          <ModeButton tab={tab} mode="edit" icon={<Pencil size={13} />} label="Edit" />
        </div>
      )}
      {tab.dirty && (
        <button type="button" className="save-hint" onClick={() => void save()} title="Save (Ctrl+S)">
          <span className="save-dot" /> Unsaved — click or press Ctrl+S
        </button>
      )}

      {tab.mode === 'edit' && editable ? (
        editorPane
      ) : tab.mode === 'split' && editable ? (
        <div className="split">
          {editorPane}
          <div className="split-divider" aria-hidden="true" />
          <div className="split-preview">
            <div className="viewer-scroll">{renderPreview()}</div>
          </div>
        </div>
      ) : (
        <div className="viewer-scroll" ref={scrollRef}>
          {renderPreview()}
        </div>
      )}
    </div>
  );
}

function ModeButton({ tab, mode, icon, label }: { tab: Tab; mode: 'preview' | 'edit' | 'split'; icon: React.ReactNode; label: string }) {
  const setMode = useTabs((s) => s.setMode);
  const active = tab.mode === mode;
  return (
    <button
      type="button"
      className={`mode-btn${active ? ' active' : ''}`}
      aria-pressed={active}
      onClick={() => setMode(tab.id, mode)}
      title={`${label} mode`}
    >
      {icon} {label}
    </button>
  );
}

/** Word count etc. for the status bar (read from cache so it stays cheap). */
export function statsFor(tab: Tab | null): string | null {
  if (!tab) return null;
  const rendererId = tab.forceText ? 'text' : rendererForExt(tab.ext);
  if (!['markdown', 'text', 'html'].includes(rendererId)) return null;
  const key = `${useWorkspace.getState().provider!.id}::${tab.path}`;
  const t = textCache.get(key);
  return t !== undefined ? `${countWords(t).toLocaleString()} words` : null;
}
