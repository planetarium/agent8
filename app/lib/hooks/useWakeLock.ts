import { useEffect, useRef, useCallback } from 'react';
import NoSleep from 'nosleep.js';

/**
 * Custom hook to manage Wake Lock API with NoSleep.js fallback
 * Prevents screen from turning off during active sessions
 */
export function useWakeLock(isActive: boolean) {
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const noSleepRef = useRef<NoSleep | null>(null);
  const isEnabledRef = useRef<boolean>(false);
  const shouldBeEnabledRef = useRef<boolean>(false); // Track intended state

  // Initialize NoSleep instance once
  useEffect(() => {
    noSleepRef.current = new NoSleep();

    return () => {
      if (noSleepRef.current) {
        noSleepRef.current.disable();
      }
    };
  }, []);

  const enableWakeLock = useCallback(async () => {
    if (isEnabledRef.current) {
      return;
    }

    try {
      // Try standard Wake Lock API first
      if ('wakeLock' in navigator && navigator.wakeLock) {
        wakeLockRef.current = await navigator.wakeLock.request('screen');
        wakeLockRef.current.addEventListener('release', () => {
          wakeLockRef.current = null;
          isEnabledRef.current = false; // Mark as disabled when auto-released
        });
        isEnabledRef.current = true;

        return;
      }
    } catch (error) {
      // NotAllowedError or other errors - fall back to NoSleep
      console.warn('Wake Lock API failed, using NoSleep fallback:', error);
    }

    // Fallback: NoSleep (hidden video playback)
    try {
      if (noSleepRef.current) {
        await noSleepRef.current.enable();
        isEnabledRef.current = true;
      }
    } catch (error) {
      console.error('Failed to enable NoSleep:', error);
    }
  }, []);

  const disableWakeLock = useCallback(async () => {
    if (!isEnabledRef.current) {
      return;
    }

    try {
      // Release standard Wake Lock
      if (wakeLockRef.current) {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
      }
    } catch (error) {
      console.warn('Failed to release Wake Lock:', error);
    }

    // Disable NoSleep
    try {
      if (noSleepRef.current) {
        noSleepRef.current.disable();
      }
    } catch (error) {
      console.warn('Failed to disable NoSleep:', error);
    }

    isEnabledRef.current = false;
  }, []);

  // Enable/disable based on isActive state
  useEffect(() => {
    shouldBeEnabledRef.current = isActive; // Track intended state

    if (isActive) {
      enableWakeLock();
    } else {
      disableWakeLock();
    }
  }, [isActive, enableWakeLock, disableWakeLock]);

  // Re-acquire Wake Lock when tab becomes visible again
  useEffect(() => {
    const handleVisibilityChange = async () => {
      // Re-enable if it was intentionally enabled (regardless of current state)
      if (shouldBeEnabledRef.current && document.visibilityState === 'visible') {
        try {
          await enableWakeLock();
        } catch (error) {
          console.warn('Failed to re-acquire Wake Lock on visibility change:', error);
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [enableWakeLock]);

  return { enableWakeLock, disableWakeLock };
}
