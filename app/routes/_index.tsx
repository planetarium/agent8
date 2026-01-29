import { json, type MetaFunction } from '@remix-run/cloudflare';
import { useLoaderData } from '@remix-run/react';
import { useEffect, useState, useRef } from 'react';
import { ClientOnly } from 'remix-utils/client-only';
import Cookies from 'js-cookie';

import { BaseChat } from '~/components/chat/BaseChat';
import { Chat } from '~/components/chat/Chat.client';
import { Header } from '~/components/header/Header';

import { DEFAULT_TASK_BRANCH, repoStore } from '~/lib/stores/repo';
import { updateV8AccessToken, V8_ACCESS_TOKEN_KEY, verifyV8AccessToken } from '~/lib/verse8/userAuth';
import { workbenchStore } from '~/lib/stores/workbench';
import { v8UserStore } from '~/lib/stores/v8User';
import { VERSE8_BASE_URL } from '~/utils/constants';

export const meta: MetaFunction = () => {
  return [{ title: 'Agent8' }, { name: 'description', content: 'AI Game Maker' }];
};

export const loader = () => json({});

/**
 * 접근 제어 없이 바로 채팅 UI를 렌더링하는 단순 컴포넌트
 */
function DirectChatAccess() {
  useEffect(() => {
    // we don't await here because we want to wait in the workbench
    const token = localStorage.getItem(V8_ACCESS_TOKEN_KEY);

    if (token) {
      workbenchStore.initializeContainer(token);
    }
  }, []);

  return (
    <div className="flex flex-col h-full w-full bg-bolt-elements-background-depth-1">
      <Header />
      <ClientOnly fallback={<BaseChat />}>{() => <Chat />}</ClientOnly>
    </div>
  );
}

/**
 * 접근 제어 기능이 있는 컴포넌트
 */
function AccessControlledChat() {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isActivated, setIsActivated] = useState<boolean | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(localStorage.getItem(V8_ACCESS_TOKEN_KEY));
  const [loadedContainer, setLoadedContainer] = useState<boolean>(false);
  const handleStopRef = useRef<(() => void) | null>(null);
  const [hasReceivedInit, setHasReceivedInit] = useState<boolean>(false);

  // localStorage에 토큰이 있으면 바로 준비 완료 상태로 시작
  const [isReady, setIsReady] = useState<boolean>(!!accessToken);

  // Helper function to send postMessage to allowed parent origins
  const sendMessageToParent = (message: any) => {
    if (window.parent && window.parent !== window) {
      const allowedOriginsEnv = import.meta.env.VITE_ALLOWED_PARENT_ORIGINS;
      const allowedOrigins = allowedOriginsEnv
        ? allowedOriginsEnv.split(',').map((origin: string) => origin.trim())
        : [VERSE8_BASE_URL]; // fallback
      const parentOrigin = document.referrer ? new URL(document.referrer).origin : null;
      const targetOrigin = parentOrigin && allowedOrigins.includes(parentOrigin) ? parentOrigin : allowedOrigins[0];

      window.parent.postMessage(message, targetOrigin);
    }
  };

  useEffect(() => {
    if (accessToken) {
      const verifyToken = async () => {
        try {
          const v8AuthApiEndpoint = import.meta.env.VITE_V8_AUTH_API_ENDPOINT;
          const userInfo = await verifyV8AccessToken(v8AuthApiEndpoint, accessToken);

          v8UserStore.set({ loading: false, user: userInfo });
          updateV8AccessToken(accessToken);

          try {
            const gitlabUser = await fetch('/api/gitlab/user', {
              headers: {
                Authorization: `Bearer ${accessToken}`,
              },
            });
            console.log('GITLAB USER', await gitlabUser.json());
          } catch {}

          setIsActivated(userInfo.isActivated);
        } catch (error) {
          console.error('Failed to verify token:', error);
          setIsActivated(false);
          v8UserStore.set({ loading: false, user: null });
        } finally {
          setIsLoading(false);
        }
      };
      verifyToken();
    } else {
      setIsLoading(false);
      setIsActivated(false);
    }
  }, [accessToken]);

  useEffect(() => {
    // RemoteContainer는 항상 사용 가능
    setLoadedContainer(true);

    sendMessageToParent({
      type: 'REQUEST_AUTH',
    });
  }, []);

  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      if (event.data && event.data.type === 'INIT') {
        const token = event.data.payload?.accessToken;
        const containerReady = workbenchStore.containerReady;

        console.log('🎯 _index.tsx: INIT event received', {
          timestamp: Date.now(),
          containerReady,
          hasToken: !!token,
        });

        // INIT 메시지를 받았으므로 준비 완료
        setHasReceivedInit(true);
        setIsReady(true);

        if (token) {
          updateV8AccessToken(token);
          setAccessToken(token);

          // Ignore if container is already ready
          if (containerReady) {
            console.log('🚫 _index.tsx: Container is already ready, skipping container initialization');

            return;
          }

          try {
            console.log('🔄 _index.tsx: Container is not ready, reinitializeContainer called');
            await workbenchStore.reinitializeContainer(token);
            console.log('✅ _index.tsx: reinitializeContainer completed');
          } catch (error) {
            console.error('❌ _index.tsx: Failed to reinitialize container:', error);
          }
        } else {
          if (handleStopRef.current) {
            handleStopRef.current();
          }

          // Handle logout when token is null/undefined
          localStorage.removeItem(V8_ACCESS_TOKEN_KEY);
          Cookies.remove(V8_ACCESS_TOKEN_KEY);
          setAccessToken(null);
          setIsActivated(false);
          v8UserStore.set({ loading: false, user: null });
        }
      }
    };

    window.addEventListener('message', handleMessage);

    // 5초 타임아웃 후에도 INIT이 안 오면 준비 완료 상태로 진행
    const timeout = setTimeout(() => {
      if (isLoading && !accessToken) {
        setIsLoading(false);
        setIsActivated(false);
      }

      // INIT을 받지 못했더라도 타임아웃 후 준비 완료
      if (!hasReceivedInit) {
        setIsReady(true);
      }
    }, 5000);

    return () => {
      window.removeEventListener('message', handleMessage);
      clearTimeout(timeout);
    };
  }, [isLoading, accessToken, hasReceivedInit]);

  const handleAuthRequired = () => {
    sendMessageToParent({
      type: 'AUTH_REQUIRED',
      action: 'SHOW_LOGIN_MODAL',
    });
  };

  // 컨테이너가 로딩되지 않았을 때 표시할 컴포넌트
  const NotLoadedContainer = () => {
    const [countdown, setCountdown] = useState(5);
    const [showMessage, setShowMessage] = useState(false);

    useEffect(() => {
      // 1.5초 후에 메시지 표시
      const messageTimer = setTimeout(() => {
        setShowMessage(true);
      }, 1500);

      return () => {
        clearTimeout(messageTimer);
      };
    }, []);

    useEffect(() => {
      if (showMessage) {
        const countdownTimer = setInterval(() => {
          setCountdown((prevCount) => {
            if (prevCount <= 1) {
              clearInterval(countdownTimer);
              location.reload();

              return 0;
            }

            return prevCount - 1;
          });
        }, 1000);

        return () => {
          clearInterval(countdownTimer);
        };
      }

      return () => {
        // No cleanup needed
      };
    }, [showMessage]);

    if (!showMessage) {
      return <div className="flex flex-col items-center justify-center h-full w-full"></div>;
    }

    return (
      <div className="flex flex-col items-center justify-center h-full w-full text-center px-4">
        <div className="bg-gradient-to-br from-gray-900 to-cyan-950 p-8 rounded-lg border border-cyan-700 max-w-md shadow-lg shadow-cyan-800/50 min-w-[500px]">
          <h2 className="text-2xl font-bold text-cyan-300 mb-3">The service is temporarily busy.</h2>
          <p className="text-gray-400 mb-4">
            Please wait a moment.
            <br /> We will reload the page in {countdown} seconds.
          </p>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full w-full bg-bolt-elements-background-depth-1">
      <Header />

      {!loadedContainer ? (
        <NotLoadedContainer />
      ) : (
        <ClientOnly fallback={<BaseChat />}>
          {() => {
            return (
              <Chat
                isAuthenticated={isActivated === true}
                onAuthRequired={handleAuthRequired}
                handleStopRef={handleStopRef}
                hasReceivedInit={isReady}
              />
            );
          }}
        </ClientOnly>
      )}
    </div>
  );
}

export default function Index() {
  const { repoName, repoPath } = useLoaderData<{ repoName?: string; repoPath?: string }>();
  useEffect(() => {
    if (repoPath && repoName) {
      repoStore.set({
        name: repoName,
        path: repoPath,
        title: repoName,
        taskBranch: DEFAULT_TASK_BRANCH,
      });
    }
  }, [repoPath, repoName]);

  const isAccessControlEnabled = import.meta.env.VITE_ACCESS_CONTROL_ENABLED === 'true';

  return isAccessControlEnabled ? <AccessControlledChat /> : <DirectChatAccess />;
}
