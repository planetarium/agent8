'use client';

import { useState, useCallback, useRef, useEffect, type ReactNode } from 'react';
import { setTurnstileTokenGetter } from '~/lib/turnstile/client';

export class TurnstileCancelledError extends Error {
  constructor() {
    super('Turnstile cancelled by user');
    this.name = 'TurnstileCancelledError';
  }
}

export class TurnstileFailedError extends Error {
  constructor() {
    super('Turnstile verification failed');
    this.name = 'TurnstileFailedError';
  }
}

interface ResolverRef {
  resolve: (token: string | null) => void;
  reject: (error: Error) => void;
}

interface TurnstileProviderProps {
  children: ReactNode;
  siteKey: string;
}

const MAX_RETRY_COUNT = 30; // 3s timeout (100ms * 30)

export function TurnstileProvider({ children, siteKey }: TurnstileProviderProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const resolverRef = useRef<ResolverRef | null>(null);
  const widgetIdRef = useRef<string | undefined>(undefined);
  const pendingRequestRef = useRef<Promise<string> | null>(null);

  const cleanup = useCallback(() => {
    if (widgetIdRef.current && window.turnstile) {
      try {
        window.turnstile.remove(widgetIdRef.current);
      } catch {
        // Already removed
      }
    }

    widgetIdRef.current = undefined;
  }, []);

  const finish = useCallback((token: string | null) => {
    setIsModalOpen(false);
    resolverRef.current?.resolve(token);
    resolverRef.current = null;

    // Don't cleanup widget here - keep it for reset() on next token request
  }, []);

  const cancel = useCallback(() => {
    setIsModalOpen(false);
    resolverRef.current?.reject(new TurnstileCancelledError());
    resolverRef.current = null;
    cleanup();
  }, [cleanup]);

  const fail = useCallback(() => {
    setIsModalOpen(false);
    resolverRef.current?.reject(new TurnstileFailedError());
    resolverRef.current = null;
    cleanup();
  }, [cleanup]);

  const getToken = useCallback((): Promise<string> => {
    // Reuse pending request to avoid concurrent widget issues
    if (pendingRequestRef.current) {
      return pendingRequestRef.current;
    }

    const tokenPromise = new Promise<string>((resolve, reject) => {
      if (!siteKey) {
        reject(new Error('Turnstile site key not configured'));

        return;
      }

      resolverRef.current = {
        resolve: (token) => {
          pendingRequestRef.current = null;

          if (token) {
            resolve(token);
          } else {
            reject(new TurnstileFailedError());
          }
        },
        reject: (error) => {
          pendingRequestRef.current = null;
          reject(error);
        },
      };

      // Try to reset existing widget first (avoids re-render and multiple CF requests)
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.reset(widgetIdRef.current);

          return; // reset triggers callback with new token
        } catch {
          // Widget invalid, will render new one below
          widgetIdRef.current = undefined;
        }
      }

      let retryCount = 0;

      const tryRender = () => {
        if (retryCount++ > MAX_RETRY_COUNT) {
          fail();

          return;
        }

        if (!window.turnstile || !containerRef.current) {
          setTimeout(tryRender, 100);

          return;
        }

        try {
          widgetIdRef.current = window.turnstile.render(containerRef.current, {
            sitekey: siteKey,
            theme: 'dark',
            size: 'normal',
            appearance: 'interaction-only',
            retry: 'never',
            callback: (token: string) => finish(token),
            'error-callback': () => {
              fail();

              return true;
            },
            'before-interactive-callback': () => setIsModalOpen(true),
            'expired-callback': () => {
              if (widgetIdRef.current && window.turnstile) {
                try {
                  window.turnstile.reset(widgetIdRef.current);
                } catch {
                  // Widget already removed
                }
              }
            },
          });
        } catch {
          fail();
        }
      };

      tryRender();
    });

    pendingRequestRef.current = tokenPromise;

    return tokenPromise;
  }, [siteKey, finish, fail]);

  useEffect(() => {
    setTurnstileTokenGetter(getToken);
  }, [getToken]);

  // Cleanup widget on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      cancel();
    }
  };

  return (
    <>
      {children}

      {/* Turnstile Modal */}
      <div
        onClick={handleBackdropClick}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 99999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          backdropFilter: 'blur(4px)',
          opacity: isModalOpen ? 1 : 0,
          pointerEvents: isModalOpen ? 'auto' : 'none',
          transition: 'opacity 0.2s ease-in-out',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '16px',
            padding: '24px',
            borderRadius: '12px',
            backgroundColor: 'var(--bolt-elements-background-depth-1, #1a1a1a)',
            border: '1px solid var(--bolt-elements-borderColor, #333)',
            boxShadow: '0 4px 24px rgba(0, 0, 0, 0.3)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%',
            }}
          >
            <span
              style={{
                color: 'var(--bolt-elements-textPrimary, #fff)',
                fontSize: '16px',
                fontWeight: 500,
              }}
            >
              Security check
            </span>
            <button
              onClick={cancel}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--bolt-elements-textSecondary, #888)',
                cursor: 'pointer',
                padding: '4px',
                fontSize: '18px',
                lineHeight: 1,
              }}
            >
              ✕
            </button>
          </div>
          <div ref={containerRef} style={{ display: 'flex', justifyContent: 'center' }} />
        </div>
      </div>
    </>
  );
}
