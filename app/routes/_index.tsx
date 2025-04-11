import { json, type MetaFunction } from '@remix-run/cloudflare';
import { useLoaderData } from '@remix-run/react';
import { useEffect, useState } from 'react';
import { ClientOnly } from 'remix-utils/client-only';
import { BaseChat } from '~/components/chat/BaseChat';
import { Chat } from '~/components/chat/Chat.client';
import { Header } from '~/components/header/Header';
import BackgroundRays from '~/components/ui/BackgroundRays';
import { repoStore } from '~/lib/stores/repo';
import { updateV8AccessToken, V8_ACCESS_TOKEN_KEY, verifyV8AccessToken } from '~/lib/verse8/userAuth';

export const meta: MetaFunction = () => {
  return [{ title: 'Agent8' }, { name: 'description', content: 'AI Game Maker' }];
};

export const loader = () => json({});

/**
 * 접근 제어 없이 바로 채팅 UI를 렌더링하는 단순 컴포넌트
 */
function DirectChatAccess() {
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

  useEffect(() => {
    if (accessToken) {
      const verifyToken = async () => {
        try {
          const v8ApiEndpoint = import.meta.env.VITE_V8_API_ENDPOINT;
          const { isActivated } = await verifyV8AccessToken(v8ApiEndpoint, accessToken);

          setIsActivated(isActivated);
        } catch (error) {
          console.error('Failed to verify token:', error);
          setIsActivated(false);
        } finally {
          setIsLoading(false);
        }
      };
      verifyToken();
    }
  }, [accessToken]);

  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      if (event.data && event.data.type === 'INIT') {
        const token = event.data.payload?.accessToken;

        if (token) {
          updateV8AccessToken(token);
          setAccessToken(token);
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

  return (
    <div className="flex flex-col h-full w-full bg-bolt-elements-background-depth-1">
      <BackgroundRays />
      <Header />

      {isLoading ? (
        <LoadingScreen />
      ) : isActivated === false ? (
        <AccessRestricted />
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
      });
    }
  }, [repoPath, repoName]);

  const isAccessControlEnabled = import.meta.env.VITE_ACCESS_CONTROL_ENABLED === 'true';

  return isAccessControlEnabled ? <AccessControlledChat /> : <DirectChatAccess />;
}
