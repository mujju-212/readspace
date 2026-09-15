import { useTransfers } from '../stores/transfers';
import { useWorkspace } from '../stores/workspace';

/**
 * Mobile bottom navigation (PRD v1.3 §21): Home, Files, Activity, Settings.
 * Home = the dashboard page; Files = explorer drawer; Activity = transfers;
 * Settings = the reader-settings sheet (dispatched to the title bar anchor).
 */
export function BottomNav({ home, files, onHome, onFiles }: {
  home: boolean;
  files: boolean;
  onHome: () => void;
  onFiles: () => void;
}) {
  const panelOpen = useTransfers((s) => s.panelOpen);
  const setPanelOpen = useTransfers((s) => s.setPanelOpen);
  const provider = useWorkspace((s) => s.provider);

  return (
    <nav className="bottom-nav" aria-label="Main navigation">
      <button type="button" className={home ? 'on' : ''} onClick={onHome} aria-label="Home">
        <span className="bn-icon" aria-hidden>⌂</span>
        Home
      </button>
      <button type="button" className={files ? 'on' : ''} onClick={onFiles} disabled={!provider} aria-label="Files">
        <span className="bn-icon" aria-hidden>▤</span>
        Files
      </button>
      <button
        type="button"
        className={panelOpen ? 'on' : ''}
        onClick={() => setPanelOpen(!panelOpen)}
        aria-label="Activity"
      >
        <span className="bn-icon" aria-hidden>⇅</span>
        Activity
      </button>
      <button
        type="button"
        onClick={() => window.dispatchEvent(new CustomEvent('rs:open-settings'))}
        aria-label="Settings"
      >
        <span className="bn-icon" aria-hidden>⚙</span>
        Settings
      </button>
    </nav>
  );
}
