import { json, type MetaFunction } from '@remix-run/cloudflare';
import { useLoaderData } from '@remix-run/react';
import { useEffect, useState } from 'react';
import { ClientOnly } from 'remix-utils/client-only';
import { BaseChat } from '~/components/chat/BaseChat';
import { Chat } from '~/components/chat/Chat.client';
import { Header } from '~/components/header/Header';
import BackgroundRays from '~/components/ui/BackgroundRays';
import { DEFAULT_TASK_BRANCH, repoStore } from '~/lib/stores/repo';
import { updateV8AccessToken, V8_ACCESS_TOKEN_KEY, verifyV8AccessToken } from '~/lib/verse8/userAuth';
import { container, containerType, initializeContainer } from '~/lib/container';
import { v8UserStore } from '~/lib/stores/v8User';

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
    initializeContainer(localStorage.getItem(V8_ACCESS_TOKEN_KEY));
  }, []);

  return (
    <div className="flex flex-col h-full w-full bg-bolt-elements-background-depth-1">
      <BackgroundRays />
      <Header />
      <ClientOnly fallback={<BaseChat />}>{() => <Chat />}</ClientOnly>
    </div>
  );
}

/**
 * 접근 제어 기능이 있는 컴포넌트
 */
function AccessControlledChat() {
  const [isLoading, setIsLoading] = useState(true);
  const [isActivated, setIsActivated] = useState<boolean | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(localStorage.getItem(V8_ACCESS_TOKEN_KEY));
  const [loadedWebcontainer, setLoadedWebcontainer] = useState(false);

  useEffect(() => {
    if (accessToken) {
      const verifyToken = async () => {
        try {
          const v8ApiEndpoint = import.meta.env.VITE_V8_API_ENDPOINT;
          const userInfo = await verifyV8AccessToken(v8ApiEndpoint, accessToken);

          v8UserStore.set({ loading: false, user: userInfo });

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
    }
  }, [accessToken]);

  useEffect(() => {
    if (containerType === 'webcontainer') {
      container.then((wc) => {
        if (wc?.workdir) {
          setLoadedWebcontainer(true);
        }
      });
    } else {
      setLoadedWebcontainer(true);
    }
  }, [container]);

  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      if (event.data && event.data.type === 'INIT') {
        const token = event.data.payload?.accessToken;

        if (token) {
          updateV8AccessToken(token);
          setAccessToken(token);

          // Reinitialize container with the new token to recover from potential failures
          try {
            await initializeContainer(token, true);
          } catch (error) {
            console.error('Failed to reinitialize container:', error);
          }
        }
      }
    };

    window.addEventListener('message', handleMessage);

    // 일정 시간 후에도 메시지가 오지 않으면 로딩 상태 해제
    const timeout = setTimeout(() => {
      if (isLoading && !accessToken) {
        setIsLoading(false);
        setIsActivated(false);
      }
    }, 5000);

    return () => {
      window.removeEventListener('message', handleMessage);
      clearTimeout(timeout);
    };
  }, [isLoading, accessToken]);

  // 로딩 화면 컴포넌트
  const LoadingScreen = () => (
    <div className="flex flex-col items-center justify-center h-full w-full">
      <p className="mt-4 text-lg text-gray-600"></p>
    </div>
  );

  // 접근 제한 화면 컴포넌트
  const AccessRestricted = () => (
    <div className="flex flex-col items-center justify-center h-full w-full text-center px-4">
      <div className="bg-gradient-to-br from-purple-900 to-indigo-950 p-8 rounded-lg border border-purple-500 max-w-md shadow-lg shadow-purple-900/30">
        <h2 className="text-2xl font-bold text-purple-200 mb-3">Access Restricted</h2>
        <p className="text-purple-300 mb-4">Currently, Agent8 is only available to invited users.</p>
      </div>
    </div>
  );

  // 웹컨테이너가 로딩되지 않았을 때 표시할 컴포넌트
  const NotLoadedWebcontainer = () => {
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

      return () => {};
    }, [showMessage]);

    if (!showMessage) {
      return <div className="flex flex-col items-center justify-center h-full w-full"></div>;
    }

    return (
      <div className="flex flex-col items-center justify-center h-full w-full text-center px-4">
        <div className="bg-gradient-to-br from-gray-900 to-purple-950 p-8 rounded-lg border border-purple-800 max-w-md shadow-lg shadow-purple-900/50 min-w-[500px]">
          <h2 className="text-2xl font-bold text-purple-300 mb-3">The service is temporarily busy.</h2>
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
      <BackgroundRays />
      <Header />

      {isLoading ? (
        <LoadingScreen />
      ) : isActivated === false ? (
        <AccessRestricted />
      ) : !loadedWebcontainer ? (
        <NotLoadedWebcontainer />
      ) : (
        <ClientOnly fallback={<BaseChat />}>{() => <Chat />}</ClientOnly>
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
