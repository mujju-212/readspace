import React, { useCallback, useEffect, useRef, useState } from 'react';

function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function VideoView({
  buffer,
  name,
  path,
}: {
  buffer: ArrayBuffer;
  name: string;
  path: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsTimeoutRef = useRef<number | null>(null);

  const [videoUrl, setVideoUrl] = useState<string>('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [videoWidth, setVideoWidth] = useState(0);
  const [videoHeight, setVideoHeight] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Generate object URL from buffer
  useEffect(() => {
    try {
      const ext = name.split('.').pop()?.toLowerCase();
      let mime = 'video/mp4';
      if (ext === 'webm') mime = 'video/webm';
      else if (ext === 'ogv' || ext === 'ogg') mime = 'video/ogg';
      else if (ext === 'mov') mime = 'video/quicktime';
      else if (ext === 'mkv') mime = 'video/x-matroska';

      const blob = new Blob([buffer], { type: mime });
      const url = URL.createObjectURL(blob);
      setVideoUrl(url);
      setError(null);

      return () => {
        URL.revokeObjectURL(url);
      };
    } catch (e) {
      setError('Unable to load video file buffer');
    }
  }, [buffer, name]);

  // Video event handlers
  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration || 0);
      setVideoWidth(videoRef.current.videoWidth || 0);
      setVideoHeight(videoRef.current.videoHeight || 0);
    }
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const handlePlay = () => setIsPlaying(true);
  const handlePause = () => setIsPlaying(false);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, []);

  const seek = (time: number) => {
    const video = videoRef.current;
    if (!video) return;
    const clamped = Math.max(0, Math.min(duration, time));
    video.currentTime = clamped;
    setCurrentTime(clamped);
  };

  const skip = (seconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    seek(video.currentTime + seconds);
  };

  const handleVolumeChange = (newVolume: number) => {
    const video = videoRef.current;
    if (!video) return;
    const clamped = Math.max(0, Math.min(1, newVolume));
    video.volume = clamped;
    video.muted = clamped === 0;
    setVolume(clamped);
    setMuted(clamped === 0);
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    const nextMuted = !muted;
    video.muted = nextMuted;
    setMuted(nextMuted);
  };

  const handleRateChange = (rate: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = rate;
    setPlaybackRate(rate);
  };

  const toggleFullscreen = async () => {
    const container = containerRef.current;
    if (!container) return;
    if (!document.fullscreenElement) {
      try {
        await container.requestFullscreen();
        setIsFullscreen(true);
      } catch {
        /* full screen may be denied */
      }
    } else {
      try {
        await document.exitFullscreen();
        setIsFullscreen(false);
      } catch {
        /* exit error */
      }
    }
  };

  const togglePiP = async () => {
    const video = videoRef.current;
    if (!video || !document.pictureInPictureEnabled) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await video.requestPictureInPicture();
      }
    } catch {
      /* PiP error or not supported */
    }
  };

  // Auto-hide controls
  const handleMouseMove = () => {
    setControlsVisible(true);
    if (controlsTimeoutRef.current) {
      window.clearTimeout(controlsTimeoutRef.current);
    }
    if (isPlaying) {
      controlsTimeoutRef.current = window.setTimeout(() => {
        setControlsVisible(false);
      }, 2500);
    }
  };

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === ' ' || e.key === 'k') {
      e.preventDefault();
      togglePlay();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      skip(-5);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      skip(5);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      handleVolumeChange(volume + 0.05);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      handleVolumeChange(volume - 0.05);
    } else if (e.key === 'm') {
      e.preventDefault();
      toggleMute();
    } else if (e.key === 'f') {
      e.preventDefault();
      void toggleFullscreen();
    }
  };

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
  const ext = name.split('.').pop()?.toUpperCase() || 'VIDEO';

  return (
    <div
      ref={containerRef}
      className={`video-player-wrap ${isFullscreen ? 'fullscreen' : ''}`}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => isPlaying && setControlsVisible(false)}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="region"
      aria-label={`Video player for ${name}`}
    >
      {/* Video Header / File Info */}
      <div className={`video-header ${controlsVisible ? 'visible' : 'hidden'}`}>
        <div className="video-title-wrap">
          <span className="video-title">{name}</span>
          <div className="video-badges">
            <span className="video-badge">{ext}</span>
            {videoWidth > 0 && videoHeight > 0 && (
              <span className="video-badge">{videoWidth}×{videoHeight}</span>
            )}
            <span className="video-badge">
              {(buffer.byteLength / (1024 * 1024)).toFixed(1)} MB
            </span>
          </div>
        </div>
      </div>

      {/* Main Video Element */}
      <div className="video-canvas-box" onClick={togglePlay}>
        <video
          ref={videoRef}
          src={videoUrl}
          className="video-element"
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={handleTimeUpdate}
          onPlay={handlePlay}
          onPause={handlePause}
          onError={() => setError('Browser unable to decode this video format')}
          playsInline
        />

        {/* Center Play Overlay when paused */}
        {!isPlaying && (
          <div className="video-play-overlay">
            <button
              type="button"
              className="video-big-play-btn"
              onClick={(e) => {
                e.stopPropagation();
                togglePlay();
              }}
              aria-label="Play video"
            >
              ▶
            </button>
          </div>
        )}

        {error && (
          <div className="video-error-overlay">
            <div className="video-error-card">
              <span>⚠️</span>
              <p>{error}</p>
              <div className="small muted">
                You can still download or inspect the raw media file.
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Video Bottom Control Bar */}
      <div className={`video-controls-bar ${controlsVisible ? 'visible' : 'hidden'}`}>
        {/* Scrubber Timeline */}
        <div
          className="video-scrubber"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const pos = (e.clientX - rect.left) / rect.width;
            seek(pos * duration);
          }}
        >
          <div className="video-scrubber-fill" style={{ width: `${progressPercent}%` }} />
          <div className="video-scrubber-handle" style={{ left: `${progressPercent}%` }} />
        </div>

        <div className="video-control-row">
          {/* Left Actions: Play, Skip, Time */}
          <div className="video-actions-left">
            <button
              type="button"
              className="video-btn-play"
              onClick={togglePlay}
              aria-label={isPlaying ? 'Pause' : 'Play'}
              title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
            >
              {isPlaying ? '⏸' : '▶'}
            </button>

            <button
              type="button"
              className="video-btn-skip"
              onClick={() => skip(-10)}
              title="Rewind 10 seconds (←)"
            >
              ↺ 10s
            </button>
            <button
              type="button"
              className="video-btn-skip"
              onClick={() => skip(10)}
              title="Fast forward 10 seconds (→)"
            >
              10s ↻
            </button>

            <div className="video-time-display">
              <span>{formatTime(currentTime)}</span>
              <span className="muted">/</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>

          {/* Right Actions: Volume, Speed, PiP, Fullscreen */}
          <div className="video-actions-right">
            {/* Volume control */}
            <div className="video-volume-group">
              <button
                type="button"
                className="video-icon-btn"
                onClick={toggleMute}
                title={muted ? 'Unmute (M)' : 'Mute (M)'}
              >
                {muted || volume === 0 ? '🔇' : volume < 0.5 ? '🔉' : '🔊'}
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={muted ? 0 : volume}
                onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                className="video-volume-slider"
                aria-label="Volume"
              />
            </div>

            {/* Playback speed */}
            <div className="video-speed-selector">
              {[0.75, 1, 1.25, 1.5, 2].map((rate) => (
                <button
                  key={rate}
                  type="button"
                  className={`video-speed-pill ${playbackRate === rate ? 'active' : ''}`}
                  onClick={() => handleRateChange(rate)}
                >
                  {rate}x
                </button>
              ))}
            </div>

            {/* Picture in Picture */}
            {'pictureInPictureEnabled' in document && (
              <button
                type="button"
                className="video-icon-btn"
                onClick={togglePiP}
                title="Picture in Picture"
              >
                📺
              </button>
            )}

            {/* Fullscreen */}
            <button
              type="button"
              className="video-icon-btn"
              onClick={toggleFullscreen}
              title={isFullscreen ? 'Exit Fullscreen (F)' : 'Fullscreen (F)'}
            >
              {isFullscreen ? '⤦' : '⤢'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
