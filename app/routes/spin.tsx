import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from '@remix-run/react';
import { toast } from 'react-toastify';
import { motion } from 'framer-motion';
import { Button } from '~/components/ui/Button';
import { createScopedLogger } from '~/utils/logger';
import { forkProject } from '~/lib/persistenceGitbase/api.client';
import { fetchVerse, extractProjectInfoFromPlayUrl, type VerseData } from '~/lib/verse8/api';
import { updateV8AccessToken, V8_ACCESS_TOKEN_KEY, verifyV8AccessToken } from '~/lib/verse8/userAuth';
import { workbenchStore } from '~/lib/stores/workbench';
import { v8UserStore } from '~/lib/stores/v8User';

const logger = createScopedLogger('Spin');

export default function Spin() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [isLoading, setIsLoading] = useState(true);
  const [verse, setVerse] = useState<VerseData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSpinning, setIsSpinning] = useState(false);

  // Token authentication states
  const [isActivated, setIsActivated] = useState<boolean | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(localStorage.getItem(V8_ACCESS_TOKEN_KEY));
  const [loadedContainer, setLoadedContainer] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);

  const fromVerse = searchParams.get('fromVerse');
  const requestSha = searchParams.get('sha');

  useEffect(() => {
    if (!fromVerse) {
      setError('Verse ID is required');
      setIsLoading(false);

      return;
    }

    const isAccessControlEnabled = import.meta.env.VITE_ACCESS_CONTROL_ENABLED === 'true';

    // If access control is disabled, load verse info immediately
    if (!isAccessControlEnabled) {
      loadVerseInfo();

      return;
    }

    // If access control is enabled, wait for authentication to complete
    if (!authLoading && isActivated === true && loadedContainer) {
      loadVerseInfo();
    }
  }, [fromVerse, authLoading, isActivated, loadedContainer]);

  // Token verification effect
  useEffect(() => {
    if (accessToken) {
      const verifyToken = async () => {
        try {
          const v8ApiEndpoint = import.meta.env.VITE_V8_API_ENDPOINT;
          const userInfo = await verifyV8AccessToken(v8ApiEndpoint, accessToken);

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
          setAuthLoading(false);
        }
      };
      verifyToken();
    } else {
      setAuthLoading(false);
    }
  }, [accessToken]);

  // Container loading effect
  useEffect(() => {
    // RemoteContainer는 항상 사용 가능
    setLoadedContainer(true);

    // Initialize container if access control is disabled and we have a token
    if (!import.meta.env.VITE_ACCESS_CONTROL_ENABLED && accessToken) {
      console.log('🔄 spin.tsx: useEffect accessToken 변경으로 initializeContainer 호출', {
        accessToken: accessToken?.substring(0, 10) + '...',
        timestamp: Date.now(),
      });
      workbenchStore.initializeContainer(accessToken);
    }
  }, [accessToken]);

  // Message event listener for token initialization
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      if (event.data && event.data.type === 'INIT') {
        const token = event.data.payload?.accessToken;
        const containerReady = workbenchStore.containerReady;

        console.log('🎯 spin.tsx: INIT event received', {
          timestamp: Date.now(),
          containerReady,
          hasToken: !!token,
        });

        if (token) {
          updateV8AccessToken(token);
          setAccessToken(token);

          // Ignore if container is already ready
          if (containerReady) {
            console.log('🚫 spin.tsx: Container is already ready, skipping container initialization');

            return;
          }

          try {
            console.log('🔄 spin.tsx: Container is not ready, reinitializeContainer called');
            await workbenchStore.reinitializeContainer(token);
            console.log('✅ spin.tsx: reinitializeContainer completed');
          } catch (error) {
            console.error('❌ spin.tsx: Failed to reinitialize container:', error);
          }
        }
      }
    };

    window.addEventListener('message', handleMessage);

    // 일정 시간 후에도 메시지가 오지 않으면 로딩 상태 해제
    const timeout = setTimeout(() => {
      if (authLoading && !accessToken) {
        setAuthLoading(false);
        setIsActivated(false);
      }
    }, 5000);

    return () => {
      window.removeEventListener('message', handleMessage);
      clearTimeout(timeout);
    };
  }, [authLoading, accessToken]);

  const loadVerseInfo = async () => {
    if (!fromVerse) {
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      // Fetch verse data
      const verseData = await fetchVerse(fromVerse);

      if (!verseData) {
        throw new Error('Verse not found or not accessible');
      }

      // Check if remix is allowed
      if (!verseData.allowRemix) {
        throw new Error('This verse does not allow remixing');
      }

      setVerse(verseData);
      setIsLoading(false);

      // Start creating spin immediately after a short delay for better UX
      setTimeout(() => createSpin(verseData), 500);
    } catch (error) {
      logger.error('Error loading verse info:', error);

      const errorMessage = error instanceof Error ? error.message : 'Failed to load verse information';
      setError(errorMessage);
      setIsLoading(false);
    }
  };

  const createSpin = async (verseData: VerseData) => {
    if (!verseData || !fromVerse) {
      return;
    }

    try {
      setIsSpinning(true);
      setError(null);

      // Extract project path and SHA from playUrl
      const { projectPath, sha } = extractProjectInfoFromPlayUrl(verseData.playUrl);

      // Generate new repository name with better uniqueness
      const nameWords = verseData.title.split(/[^a-zA-Z0-9]+/).filter((word) => word.length > 0);
      let newRepoName = nameWords.join('-').toLowerCase();

      // Add timestamp and random suffix for better uniqueness
      const timestamp = Date.now().toString(36).slice(-6);
      const randomSuffix = Math.random().toString(36).slice(-3);
      newRepoName = `${newRepoName}-spin-${timestamp}${randomSuffix}`;

      // Fork the project with verse information
      const forkedProject = await forkProject(
        projectPath,
        newRepoName,
        requestSha || sha,
        `Spin from ${verseData.title}`,
        {
          resetEnv: true,
          fromVerseId: fromVerse,
        },
      );

      if (forkedProject && forkedProject.success) {
        toast.success('Spin created successfully!');

        // Build URL with search params (excluding 'fromVerse')
        const chatUrl = new URL(`/chat/${forkedProject.project.path}`, window.location.origin);

        // Copy all search params except 'fromVerse'
        for (const [key, value] of searchParams.entries()) {
          if (key !== 'fromVerse') {
            chatUrl.searchParams.set(key, value);
          }
        }

        // Navigate to the new project with search params
        location.href = chatUrl.toString();
      } else {
        throw new Error('Failed to create spin');
      }
    } catch (error) {
      logger.error('Error creating spin:', error);

      const errorMessage = error instanceof Error ? error.message : 'Failed to create spin';
      setError(errorMessage);
      setIsSpinning(false);
    }
  };

  const handleRetry = () => {
    if (verse) {
      createSpin(verse);
    } else {
      loadVerseInfo();
    }
  };

  const handleCancel = () => {
    navigate(-1);
  };

  // Authentication UI components
  const AuthLoadingScreen = () => (
    <div className="flex flex-col items-center justify-center h-full w-full">
      <p className="mt-4 text-lg text-gray-600"></p>
    </div>
  );

  const AccessRestricted = () => {
    useEffect(() => {
      const interval = setInterval(() => {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage(
            {
              type: 'REQUEST_AUTH',
            },
            '*',
          );
        }
      }, 1000);

      return () => clearInterval(interval);
    }, []);

    return (
      <div className="flex flex-col items-center justify-center h-full w-full text-center px-4">
        <div className="bg-gradient-to-br from-cyan-700 to-sky-900 p-8 rounded-lg border border-cyan-500 max-w-md shadow-lg shadow-cyan-700/30">
          <h2 className="text-2xl font-bold text-cyan-200 mb-3">Authenticating...</h2>
          <p className="text-cyan-300 mb-4">Please wait while we verify your access.</p>
        </div>
      </div>
    );
  };

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

  // Check if access control is enabled
  const isAccessControlEnabled = import.meta.env.VITE_ACCESS_CONTROL_ENABLED === 'true';

  // If access control is enabled, check authentication first
  if (isAccessControlEnabled) {
    if (authLoading) {
      return (
        <div className="flex flex-col h-full w-full bg-bolt-elements-background-depth-1">
          <AuthLoadingScreen />
        </div>
      );
    }

    if (isActivated === false) {
      return (
        <div className="flex flex-col h-full w-full bg-bolt-elements-background-depth-1">
          <AccessRestricted />
        </div>
      );
    }

    if (!loadedContainer) {
      return (
        <div className="flex flex-col h-full w-full bg-bolt-elements-background-depth-1">
          <NotLoadedContainer />
        </div>
      );
    }
  }

  if (isLoading || isSpinning) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-bolt-elements-background-depth-1 p-8">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center">
          <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-bolt-elements-background-depth-2 flex items-center justify-center">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
              className="w-8 h-8 border-2 border-bolt-elements-button-primary-background border-t-transparent rounded-full"
            />
          </div>
          <h1 className="text-2xl font-bold text-bolt-elements-textPrimary mb-2">
            {isSpinning ? 'Creating a spin' : 'Loading Verse'}
          </h1>
          <p className="text-bolt-elements-textSecondary">
            {isSpinning ? `Creating your spin of "${verse?.title}"...` : 'Gathering verse details...'}
          </p>
        </motion.div>
      </div>
    );
  }

  if (error && !isSpinning) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-bolt-elements-background-depth-1 p-8">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center max-w-md">
          <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-red-500/20 flex items-center justify-center">
            <div className="i-ph:warning-circle-bold text-red-500 text-3xl" />
          </div>
          <h1 className="text-2xl font-bold text-bolt-elements-textPrimary mb-2">Cannot Spin</h1>
          <p className="text-bolt-elements-textSecondary mb-6">{error}</p>
          <div className="flex gap-3 justify-center">
            <Button onClick={handleCancel} variant="secondary">
              Go Back
            </Button>
            <Button
              onClick={handleRetry}
              variant="outline"
              className="bg-bolt-elements-button-primary-background text-bolt-elements-button-primary-text hover:bg-bolt-elements-button-primary-backgroundHover border-bolt-elements-button-primary-background"
            >
              <div className="i-ph:arrow-clockwise mr-2" />
              Try Again
            </Button>
          </div>
        </motion.div>
      </div>
    );
  }

  // This should not render if we reach here
  return null;
}
