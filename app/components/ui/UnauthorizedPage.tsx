import { useEffect, useState } from 'react';
import Cookies from 'js-cookie';
import { verifyV8AccessToken, V8_ACCESS_TOKEN_KEY } from '~/lib/verse8/userAuth';
import { createScopedLogger } from '~/utils/logger';
import { VERSE8_BASE_URL } from '~/utils/constants';

const logger = createScopedLogger('UnauthorizedPage');
interface UnauthorizedPageProps {
  title?: string;
  description?: string;
  showBackButton?: boolean;
}

export function UnauthorizedPage({
  title = 'Session Expired',
  description = 'Your authentication session has expired. Please return to the home page to sign in again.',
  showBackButton = false,
}: UnauthorizedPageProps) {
  const [hasEmail, setHasEmail] = useState<boolean | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    const checkUserEmail = async () => {
      try {
        const accessToken = localStorage.getItem(V8_ACCESS_TOKEN_KEY) || Cookies.get(V8_ACCESS_TOKEN_KEY);

        if (!accessToken) {
          setHasEmail(null);
        } else {
          const v8AuthApiEndpoint = import.meta.env.VITE_V8_AUTH_API_ENDPOINT;
          const userInfo = await verifyV8AccessToken(v8AuthApiEndpoint, accessToken);
          setHasEmail(!!userInfo.email);
        }
      } catch (error) {
        logger.warn('Failed to verify access token', error);
        setHasEmail(null);
      } finally {
        setIsInitialized(true);
      }
    };

    checkUserEmail();
  }, []);

  useEffect(() => {
    if (window.parent && window.parent !== window) {
      const allowedOriginsEnv = import.meta.env.VITE_ALLOWED_PARENT_ORIGINS;
      const allowedOrigins = allowedOriginsEnv
        ? allowedOriginsEnv.split(',').map((origin: string) => origin.trim())
        : [VERSE8_BASE_URL]; // fallback
      const parentOrigin = document.referrer ? new URL(document.referrer).origin : null;
      const targetOrigin = parentOrigin && allowedOrigins.includes(parentOrigin) ? parentOrigin : allowedOrigins[0];

      window.parent.postMessage(
        {
          type: 'REQUEST_AUTH',
        },
        targetOrigin,
      );
    }
  }, []);

  // Loading screen UI
  const loadingContent = (
    <div className="flex items-center justify-center min-h-screen bg-bolt-elements-background-depth-1">
      <div className="relative">
        {/* Background decoration */}
        <div className="absolute inset-0 -z-10">
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-gradient-to-br from-blue-500/20 to-purple-500/20 rounded-full blur-3xl" />
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-gradient-to-tl from-gray-400/10 to-transparent rounded-full blur-2xl" />
        </div>

        {/* Circular progress bar */}
        <div className="w-16 h-16 rounded-full bg-bolt-elements-background-depth-2 flex items-center justify-center shadow-lg opacity-60">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin opacity-80" />
        </div>
      </div>
    </div>
  );

  // Email missing case UI
  const emailMissingContent = (
    <div className="flex items-center justify-center min-h-screen bg-bolt-elements-background-depth-1">
      <div className="relative">
        {/* Background decoration */}
        <div className="absolute inset-0 -z-10">
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-gradient-to-br from-blue-500/20 to-purple-500/20 rounded-full blur-3xl" />
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-gradient-to-tl from-gray-400/10 to-transparent rounded-full blur-2xl" />
        </div>

        <div className="text-center p-12 max-w-md mx-auto">
          {/* Icon */}
          <div className="relative mb-8 flex justify-center">
            <div className="w-24 h-24 rounded-full bg-blue-500/20 flex items-center justify-center">
              <div className="i-ph:envelope text-5xl text-blue-400" />
            </div>
          </div>

          {/* Title */}
          <h1 className="text-3xl font-bold text-white mb-4">Email Required</h1>

          {/* Description */}
          <p className="text-gray-400 mb-8 leading-relaxed">
            Your account needs an email address to use this feature. Please add an email to your account and try again.
          </p>

          {/* Action buttons */}
          <div className="space-y-3">
            <button
              onClick={() => (window.location.href = '/')}
              className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg 
                          transition-all duration-200 shadow-lg hover:shadow-blue-500/25 transform hover:-translate-y-0.5"
            >
              <div className="flex items-center justify-center gap-2">
                <div className="i-ph:house text-lg" />
                Go Home
              </div>
            </button>

            {showBackButton && (
              <button
                onClick={() => window.history.back()}
                className="w-full px-6 py-3 bg-gray-700 hover:bg-gray-600 text-gray-200 
                            border border-gray-600 rounded-lg hover:border-gray-500
                            transition-all duration-200"
              >
                <div className="flex items-center justify-center gap-2">
                  <div className="i-ph:arrow-left text-lg" />
                  Go Back
                </div>
              </button>
            )}
          </div>

          {/* Additional info */}
          <div className="mt-8 p-4 bg-gray-800/50 border border-gray-700 rounded-lg backdrop-blur-sm">
            <div className="flex items-center justify-center gap-2 text-gray-400 text-sm">
              <div className="i-ph:info text-lg" />
              <span>If you continue to see this message after signing in, please contact support</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  // Token issue case UI
  const tokenIssueContent = (
    <div className="flex items-center justify-center min-h-screen bg-bolt-elements-background-depth-1">
      <div className="relative">
        {/* Background decoration */}
        <div className="absolute inset-0 -z-10">
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-gradient-to-br from-blue-500/20 to-purple-500/20 rounded-full blur-3xl" />
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-gradient-to-tl from-gray-400/10 to-transparent rounded-full blur-2xl" />
        </div>

        <div className="text-center p-12 max-w-md mx-auto">
          {/* 401 Number */}
          <div className="relative mb-8">
            <div className="text-8xl font-bold text-gray-200 mb-2 drop-shadow-lg">401</div>
            <div className="absolute inset-0 text-8xl font-bold text-blue-400/30 blur-sm">401</div>
          </div>

          {/* Title */}
          <h1 className="text-3xl font-bold text-white mb-4">{title}</h1>

          {/* Description */}
          <p className="text-gray-400 mb-8 leading-relaxed">{description}</p>

          {/* Action buttons */}
          <div className="space-y-3">
            <button
              onClick={() => (window.location.href = '/')}
              className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg 
                          transition-all duration-200 shadow-lg hover:shadow-blue-500/25 transform hover:-translate-y-0.5"
            >
              <div className="flex items-center justify-center gap-2">
                <div className="i-ph:house text-lg" />
                Go Home
              </div>
            </button>

            {showBackButton && (
              <button
                onClick={() => window.history.back()}
                className="w-full px-6 py-3 bg-gray-700 hover:bg-gray-600 text-gray-200 
                            border border-gray-600 rounded-lg hover:border-gray-500
                            transition-all duration-200"
              >
                <div className="flex items-center justify-center gap-2">
                  <div className="i-ph:arrow-left text-lg" />
                  Go Back
                </div>
              </button>
            )}
          </div>

          {/* Additional info */}
          <div className="mt-8 p-4 bg-gray-800/50 border border-gray-700 rounded-lg backdrop-blur-sm">
            <div className="flex items-center justify-center gap-2 text-gray-400 text-sm">
              <div className="i-ph:info text-lg" />
              <span>If you continue to see this message after signing in, please contact support</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  if (!isInitialized) {
    return loadingContent;
  }

  return hasEmail === false ? emailMissingContent : tokenIssueContent;
}
