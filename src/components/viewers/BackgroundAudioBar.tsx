import React from 'react';
import { useAudioPlayer } from '../../stores/audio';
import { useTabs } from '../../stores/tabs';

function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function BackgroundAudioBar() {
  const {
    currentTrack,
    isPlaying,
    currentTime,
    duration,
    volume,
    muted,
    backgroundPlay,
    togglePlay,
    toggleMute,
    seek,
    stop,
  } = useAudioPlayer();

  const activeTab = useTabs((s) => s.tabs.find((t) => t.id === s.activeId));
  const openPath = useTabs((s) => s.openPath);

  // If no track is loaded, backgroundPlay is disabled, or the user is currently viewing this audio tab
  if (!currentTrack || !backgroundPlay || activeTab?.path === currentTrack.path) {
    return null;
  }

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="bg-audio-bar" role="region" aria-label="Background audio player">
      <div className="bg-audio-left">
        <span className={`bg-audio-icon ${isPlaying ? 'pulse' : ''}`}>🎵</span>
        <div className="bg-audio-info">
          <span className="bg-audio-title" title={currentTrack.title}>
            {currentTrack.title}
          </span>
          <span className="bg-audio-time muted small">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
        </div>
      </div>

      <div className="bg-audio-center">
        <div
          className="bg-audio-progress"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const pos = (e.clientX - rect.left) / rect.width;
            seek(pos * duration);
          }}
        >
          <div className="bg-audio-progress-fill" style={{ width: `${progressPercent}%` }} />
        </div>
      </div>

      <div className="bg-audio-right">
        <button
          type="button"
          className="bg-audio-btn-play"
          onClick={togglePlay}
          aria-label={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? '⏸' : '▶'}
        </button>

        <button
          type="button"
          className="icon-btn"
          onClick={toggleMute}
          title={muted ? 'Unmute' : 'Mute'}
        >
          {muted || volume === 0 ? '🔇' : '🔊'}
        </button>

        <button
          type="button"
          className="btn btn-sm btn-ghost"
          onClick={() => {
            openPath(currentTrack.path);
          }}
          title="Open audio file tab"
        >
          Open Tab
        </button>

        <button
          type="button"
          className="icon-btn bg-audio-close"
          onClick={stop}
          title="Stop & Close Audio"
          aria-label="Stop audio"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
