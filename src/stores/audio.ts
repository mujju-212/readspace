import { create } from 'zustand';

interface AudioState {
  currentTrack: {
    path: string;
    title: string;
    url: string;
  } | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  playbackRate: number;
  loop: boolean;
  backgroundPlay: boolean;

  playTrack: (track: { path: string; title: string; buffer: ArrayBuffer }) => void;
  togglePlay: () => void;
  seek: (time: number) => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  setPlaybackRate: (rate: number) => void;
  toggleLoop: () => void;
  setBackgroundPlay: (enabled: boolean) => void;
  skip: (seconds: number) => void;
  stop: () => void;
}

// Global audio element shared across background & tab views
let globalAudio: HTMLAudioElement | null = null;
let currentObjectUrl: string | null = null;

function getAudioElement(): HTMLAudioElement {
  if (!globalAudio) {
    globalAudio = new Audio();
    globalAudio.preload = 'auto';

    globalAudio.addEventListener('timeupdate', () => {
      if (globalAudio) {
        useAudioPlayer.setState({
          currentTime: globalAudio.currentTime,
          duration: globalAudio.duration || 0,
        });
      }
    });

    globalAudio.addEventListener('loadedmetadata', () => {
      if (globalAudio) {
        useAudioPlayer.setState({
          duration: globalAudio.duration || 0,
        });
      }
    });

    globalAudio.addEventListener('play', () => {
      useAudioPlayer.setState({ isPlaying: true });
    });

    globalAudio.addEventListener('pause', () => {
      useAudioPlayer.setState({ isPlaying: false });
    });

    globalAudio.addEventListener('ended', () => {
      const { loop } = useAudioPlayer.getState();
      if (!loop) {
        useAudioPlayer.setState({ isPlaying: false, currentTime: 0 });
      }
    });
  }
  return globalAudio;
}

export const useAudioPlayer = create<AudioState>((set, get) => ({
  currentTrack: null,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  volume: 1,
  muted: false,
  playbackRate: 1,
  loop: false,
  backgroundPlay: true,

  playTrack: ({ path, title, buffer }) => {
    const audio = getAudioElement();
    const state = get();

    // If same track is already loaded, don't restart
    if (state.currentTrack?.path === path && currentObjectUrl) {
      if (!state.isPlaying) {
        void audio.play().catch(() => {});
      }
      return;
    }

    // Revoke previous object URL if any
    if (currentObjectUrl) {
      URL.revokeObjectURL(currentObjectUrl);
    }

    const blob = new Blob([buffer]);
    const url = URL.createObjectURL(blob);
    currentObjectUrl = url;

    audio.src = url;
    audio.playbackRate = state.playbackRate;
    audio.volume = state.muted ? 0 : state.volume;
    audio.loop = state.loop;

    set({
      currentTrack: { path, title, url },
      currentTime: 0,
      duration: 0,
    });

    void audio.play().catch(() => {
      // Autoplay might be restricted until user interaction
      set({ isPlaying: false });
    });
  },

  togglePlay: () => {
    const audio = getAudioElement();
    if (audio.paused) {
      void audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  },

  seek: (time: number) => {
    const audio = getAudioElement();
    const clamped = Math.max(0, Math.min(audio.duration || 0, time));
    audio.currentTime = clamped;
    set({ currentTime: clamped });
  },

  setVolume: (volume: number) => {
    const audio = getAudioElement();
    const clamped = Math.max(0, Math.min(1, volume));
    audio.volume = clamped;
    audio.muted = clamped === 0;
    set({ volume: clamped, muted: clamped === 0 });
  },

  toggleMute: () => {
    const audio = getAudioElement();
    const nextMuted = !get().muted;
    audio.muted = nextMuted;
    set({ muted: nextMuted });
  },

  setPlaybackRate: (rate: number) => {
    const audio = getAudioElement();
    audio.playbackRate = rate;
    set({ playbackRate: rate });
  },

  toggleLoop: () => {
    const audio = getAudioElement();
    const nextLoop = !get().loop;
    audio.loop = nextLoop;
    set({ loop: nextLoop });
  },

  setBackgroundPlay: (enabled: boolean) => {
    set({ backgroundPlay: enabled });
  },

  skip: (seconds: number) => {
    const audio = getAudioElement();
    const newTime = Math.max(0, Math.min(audio.duration || 0, audio.currentTime + seconds));
    audio.currentTime = newTime;
    set({ currentTime: newTime });
  },

  stop: () => {
    const audio = getAudioElement();
    audio.pause();
    audio.currentTime = 0;
    if (currentObjectUrl) {
      URL.revokeObjectURL(currentObjectUrl);
      currentObjectUrl = null;
    }
    set({ currentTrack: null, isPlaying: false, currentTime: 0, duration: 0 });
  },
}));
