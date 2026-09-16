import React, { useEffect } from 'react';
import { useAudioPlayer } from '../../stores/audio';

function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function AudioView({
  buffer,
  name,
  path,
}: {
  buffer: ArrayBuffer;
  name: string;
  path: string;
}) {
  const {
    currentTrack,
    isPlaying,
    currentTime,
    duration,
    volume,
    muted,
    playbackRate,
    loop,
    backgroundPlay,
    playTrack,
    togglePlay,
    seek,
    setVolume,
    toggleMute,
    setPlaybackRate,
    toggleLoop,
    setBackgroundPlay,
    skip,
  } = useAudioPlayer();

  useEffect(() => {
    playTrack({ path, title: name, buffer });
  }, [path, name, buffer, playTrack]);

  const ext = name.split('.').pop()?.toUpperCase() || 'AUDIO';
  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="audio-view-wrap">
      <div className="audio-card">
        {/* Visualizer Artwork Hero */}
        <div className="audio-hero">
          <div className={`audio-disc ${isPlaying ? 'spinning' : ''}`}>
            <span className="audio-disc-center">🎵</span>
          </div>
          <div className="audio-waveform-bars">
            {Array.from({ length: 18 }).map((_, i) => (
              <span
                key={i}
                className={`audio-bar ${isPlaying ? 'animated' : ''}`}
                style={{
                  animationDelay: `${(i * 0.08).toFixed(2)}s`,
                  height: isPlaying ? undefined : '20%',
                }}
              />
            ))}
          </div>
        </div>

        {/* Track Metadata */}
        <div className="audio-meta">
          <h2 className="audio-title" title={name}>{name}</h2>
          <div className="audio-badges">
            <span className="audio-badge">{ext} Format</span>
            <span className="audio-badge">
              {(buffer.byteLength / (1024 * 1024)).toFixed(2)} MB
            </span>
            {isPlaying && <span className="audio-badge active">Now Playing</span>}
          </div>
        </div>

        {/* Timeline Progress Bar */}
        <div className="audio-timeline">
          <div
            className="audio-progress-bar"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const pos = (e.clientX - rect.left) / rect.width;
              seek(pos * duration);
            }}
          >
            <div className="audio-progress-fill" style={{ width: `${progressPercent}%` }} />
            <div className="audio-progress-handle" style={{ left: `${progressPercent}%` }} />
          </div>
          <div className="audio-time-row">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        {/* Main Controls */}
        <div className="audio-controls">
          <button
            type="button"
            className="btn btn-ghost audio-skip-btn"
            onClick={() => skip(-10)}
            title="Rewind 10 seconds"
          >
            ↺ 10s
          </button>

          <button
            type="button"
            className="audio-play-btn"
            onClick={togglePlay}
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? '⏸' : '▶'}
          </button>

          <button
            type="button"
            className="btn btn-ghost audio-skip-btn"
            onClick={() => skip(10)}
            title="Fast forward 10 seconds"
          >
            10s ↻
          </button>
        </div>

        {/* Speed, Volume, Loop & Background Play */}
        <div className="audio-secondary-controls">
          <div className="audio-speed-group">
            {[0.75, 1, 1.25, 1.5, 2].map((rate) => (
              <button
                key={rate}
                type="button"
                className={`speed-pill ${playbackRate === rate ? 'active' : ''}`}
                onClick={() => setPlaybackRate(rate)}
              >
                {rate}x
              </button>
            ))}
          </div>

          <div className="audio-volume-group">
            <button
              type="button"
              className="icon-btn"
              onClick={toggleMute}
              title={muted ? 'Unmute' : 'Mute'}
            >
              {muted || volume === 0 ? '🔇' : volume < 0.5 ? '🔉' : '🔊'}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={muted ? 0 : volume}
              onChange={(e) => setVolume(parseFloat(e.target.value))}
              className="volume-slider"
              aria-label="Volume"
            />
          </div>

          <button
            type="button"
            className={`btn btn-sm ${loop ? 'btn-primary' : 'btn-ghost'}`}
            onClick={toggleLoop}
            title={loop ? 'Repeat is ON' : 'Repeat is OFF'}
          >
            🔁 {loop ? 'Looping' : 'Repeat'}
          </button>
        </div>

        {/* Background Play Feature Toggle */}
        <div className="audio-bg-toggle-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 20 }}>🎧</span>
            <div>
              <div style={{ fontWeight: 650, fontSize: 13 }}>Background Play</div>
              <div className="muted small" style={{ fontSize: 11.5 }}>
                Keep listening seamlessly while reading notes, PDFs, or switching tabs
              </div>
            </div>
          </div>
          <button
            type="button"
            className={`btn btn-sm ${backgroundPlay ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setBackgroundPlay(!backgroundPlay)}
          >
            {backgroundPlay ? 'Enabled ✓' : 'Disabled'}
          </button>
        </div>
      </div>
    </div>
  );
}
