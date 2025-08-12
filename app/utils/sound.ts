/**
 * Sound utility for playing notification sounds
 */

let audioCache: { [key: string]: HTMLAudioElement } = {};
let audioContext: AudioContext | null = null;
let isUserInteracted = false;

/**
 * Initialize audio context and user interaction tracking
 */
function initializeAudio(): void {
  if (typeof window === 'undefined') {
    return;
  }

  // Track user interaction
  if (!isUserInteracted) {
    const handleUserInteraction = () => {
      isUserInteracted = true;

      // Initialize AudioContext on first interaction
      if (!audioContext && window.AudioContext) {
        try {
          audioContext = new AudioContext();
        } catch (error) {
          console.warn('[Sound] AudioContext not supported:', error);
        }
      }

      // Remove listeners after first interaction
      document.removeEventListener('click', handleUserInteraction);
      document.removeEventListener('keydown', handleUserInteraction);
      document.removeEventListener('touchstart', handleUserInteraction);
    };

    document.addEventListener('click', handleUserInteraction, { once: true });
    document.addEventListener('keydown', handleUserInteraction, { once: true });
    document.addEventListener('touchstart', handleUserInteraction, { once: true });
  }
}

/**
 * Play a sound file
 * @param soundPath - Path to the sound file (relative to public folder)
 * @param volume - Volume level (0.0 to 1.0)
 */
export function playSound(soundPath: string, volume: number = 0.5): void {
  try {
    // Check if we're in a browser environment
    if (typeof window === 'undefined' || typeof Audio === 'undefined') {
      return;
    }

    // Initialize audio on first call
    initializeAudio();

    // Use cached audio or create new one
    if (!audioCache[soundPath]) {
      audioCache[soundPath] = new Audio(soundPath);
      audioCache[soundPath].preload = 'auto';

      // Set attributes to help with autoplay policies
      audioCache[soundPath].muted = false;
      audioCache[soundPath].loop = false;
    }

    const audio = audioCache[soundPath];
    audio.volume = Math.max(0, Math.min(1, volume));

    // Reset audio to beginning
    audio.currentTime = 0;

    // Try to play the audio
    const playPromise = audio.play();

    if (playPromise !== undefined) {
      playPromise.catch((error) => {
        // If normal audio fails, try with user gesture workaround
        if (error.name === 'NotAllowedError') {
          console.warn('[Sound] Autoplay blocked, trying alternative method');

          // Try to resume AudioContext if available
          if (audioContext && audioContext.state === 'suspended') {
            audioContext.resume().then(() => {
              audio.play().catch((retryError) => {
                console.warn('[Sound] Failed to play sound after AudioContext resume:', soundPath, retryError);
              });
            });
          } else {
            console.warn('[Sound] Failed to play sound (autoplay blocked):', soundPath, error);
          }
        } else {
          console.warn('[Sound] Failed to play sound:', soundPath, error);
        }
      });
    }
  } catch (error) {
    console.warn('[Sound] Error playing sound:', soundPath, error);
  }
}

/**
 * Check if the page/window is currently in background
 */
function isPageInBackground(): boolean {
  if (typeof document === 'undefined') {
    return false;
  }

  // Check if tab is hidden (switched to another tab)
  const isTabHidden = document.visibilityState === 'hidden';

  // Check if window has lost focus (switched to another program)
  const hasWindowFocus = document.hasFocus();

  return isTabHidden || !hasWindowFocus;
}

/**
 * Play the completion notification sound
 * Always plays sound, shows notification only when page is in background
 */
export function playCompletionSound(): void {
  // Always play completion sound
  playSound('/sound/noti.mp3');

  // Show notification only if page is in background
  if (isPageInBackground()) {
    showNotification('Task Completed', 'Your preview is ready!');
  }
}

/**
 * Show browser notification
 */
function showNotification(title: string, body: string): void {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return;
  }

  // Request permission if not granted
  if (Notification.permission === 'default') {
    Notification.requestPermission().then((permission) => {
      if (permission === 'granted') {
        createNotification(title, body);
      }
    });
  } else if (Notification.permission === 'granted') {
    createNotification(title, body);
  }
}

/**
 * Create and show notification
 */
function createNotification(title: string, body: string): void {
  try {
    const notification = new Notification(title, {
      body,
      icon: '/favicon.ico',
      tag: 'task-completion', // Prevents duplicate notifications
      requireInteraction: false,
      silent: false, // Allow notification sound
    });

    // Auto-close notification after 5 seconds
    setTimeout(() => {
      notification.close();
    }, 5000);

    // Focus window when notification is clicked
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  } catch (error) {
    console.warn('[Sound] Failed to create notification:', error);
  }
}

/**
 * Request notification permission
 */
export function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return Promise.resolve('denied');
  }

  return Notification.requestPermission();
}

/**
 * Initialize sound system with user permissions
 */
export function initializeSoundSystem(): void {
  if (typeof window === 'undefined') {
    return;
  }

  // Preload completion sound
  preloadSounds(['/sound/noti.mp3']);

  // Request notification permission after a brief delay
  setTimeout(() => {
    if (Notification.permission === 'default') {
      console.log('[Sound] Notification permission not set. Consider requesting permission for better experience.');
    }
  }, 2000);
}

/**
 * Preload sounds for better performance
 * @param soundPaths - Array of sound file paths to preload
 */
export function preloadSounds(soundPaths: string[]): void {
  if (typeof window === 'undefined' || typeof Audio === 'undefined') {
    return;
  }

  soundPaths.forEach((soundPath) => {
    if (!audioCache[soundPath]) {
      audioCache[soundPath] = new Audio(soundPath);
      audioCache[soundPath].preload = 'auto';
    }
  });
}

/**
 * Clear the audio cache
 */
export function clearSoundCache(): void {
  audioCache = {};
}
