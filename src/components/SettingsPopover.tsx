import React from 'react';
import { useSettings, type ThemeName, type FontChoice } from '../stores/settings';
import { useAuth } from '../stores/auth';

/** Reader customization (FR-43, FR-44): theme, font, size, line height, width. */
export function SettingsPopover({ onClose }: { onClose: () => void }) {
  const s = useSettings();
  const set = s.set;
  const { user, setAccountModal, setAuthModal } = useAuth();

  return (
    <div className="settings-pop" role="dialog" aria-label="Reader settings">
      <div className="settings-row">
        <label htmlFor="set-theme">Theme</label>
        <select id="set-theme" value={s.theme} onChange={(e) => set({ theme: e.target.value as ThemeName })}>
          <option value="ice">Ice Blue (default)</option>
          <option value="light">Light</option>
          <option value="sepia">Sepia</option>
          <option value="dark">Dark</option>
          <option value="system">System / Auto</option>
        </select>
      </div>

      <div className="settings-row">
        <label htmlFor="set-font">Reader font</label>
        <select id="set-font" value={s.font} onChange={(e) => set({ font: e.target.value as FontChoice })}>
          <option value="sans">Sans (system)</option>
          <option value="serif">Serif</option>
          <option value="mono">Monospace</option>
        </select>
      </div>

      <div className="settings-row">
        <label htmlFor="set-size">Font size <b>{s.fontSize}px</b></label>
        <input id="set-size" type="range" min={12} max={26} step={1} value={s.fontSize} onChange={(e) => set({ fontSize: Number(e.target.value) })} />
      </div>

      <div className="settings-row">
        <label htmlFor="set-line">Line height <b>{s.lineHeight.toFixed(1)}</b></label>
        <input id="set-line" type="range" min={1.2} max={2.4} step={0.1} value={s.lineHeight} onChange={(e) => set({ lineHeight: Number(e.target.value) })} />
      </div>

      <div className="settings-row">
        <label htmlFor="set-width">Content width <b>{s.contentWidth}px</b></label>
        <input id="set-width" type="range" min={560} max={1400} step={20} value={s.contentWidth} onChange={(e) => set({ contentWidth: Number(e.target.value) })} />
      </div>

      <div className="settings-row">
        <label htmlFor="set-hidden">Show hidden files</label>
        <input
          id="set-hidden"
          type="checkbox"
          checked={s.showHidden}
          onChange={(e) => set({ showHidden: e.target.checked })}
        />
      </div>

      <div className="settings-row" style={{ marginTop: 4 }}>
        {user ? (
          <button
            type="button"
            className="btn btn-sm"
            style={{ width: '100%', justifyContent: 'center', gap: 6 }}
            onClick={() => { onClose(); setAccountModal(true); }}
          >
            <span>🔒</span> Password & Passkeys
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-sm btn-primary"
            style={{ width: '100%', justifyContent: 'center' }}
            onClick={() => { onClose(); setAuthModal(true); }}
          >
            Sign in / Register
          </button>
        )}
      </div>

      <div className="settings-foot">
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => set({ fontSize: 16, lineHeight: 1.7, contentWidth: 820, font: 'sans' })}
        >
          Reset reading defaults
        </button>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}
