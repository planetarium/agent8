import { useState, useEffect } from 'react';
import { useStore } from '@nanostores/react';
import { createPortal } from 'react-dom';
import { toast } from 'react-toastify';
import { classNames } from '~/utils/classNames';
import { repoStore } from '~/lib/stores/repo';
import * as Tooltip from '@radix-ui/react-tooltip';
import { CloseIcon } from '~/components/ui/Icons';
import { useMobileView } from '~/lib/hooks/useMobileView';
import {
  createDevToken,
  getDevTokenStatus,
  revokeAllDevTokens,
  revokeDevToken,
} from '~/lib/persistenceGitbase/api.client';

function CodeIcon({ width = 20, height = 20 }: { width?: number; height?: number }) {
  return (
    <svg width={width} height={height} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M8 17L3 12L8 7M16 7L21 12L16 17M14 3L10 21"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CopyIcon({ width = 16, height = 16 }: { width?: number; height?: number }) {
  return (
    <svg width={width} height={height} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M8 4V16C8 17.1046 8.89543 18 10 18H18C19.1046 18 20 17.1046 20 16V7.24264C20 6.71792 19.7893 6.21461 19.4142 5.83961L16.1604 2.58579C15.7854 2.21071 15.2821 2 14.7574 2H10C8.89543 2 8 2.89543 8 4Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M16 18V20C16 21.1046 15.1046 22 14 22H6C4.89543 22 4 21.1046 4 20V8C4 6.89543 4.89543 6 6 6H8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function HeaderGitCloneButton() {
  const repo = useStore(repoStore);
  const isMobileView = useMobileView();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [tokenData, setTokenData] = useState<{
    token?: string;
    cloneCommand?: string;
    expiresAt?: string;
    hasToken?: boolean;
    daysLeft?: number;
    tokens?: Array<{
      id: number;
      name: string;
      expires_at: string;
      daysLeft: number;
      created_at: string;
      revoked: boolean;
    }>;
  }>({});

  const [copiedStates, setCopiedStates] = useState({
    token: false,
    command: false,
    updateCommand: false,
  });

  useEffect(() => {
    if (isModalOpen && repo.path) {
      checkTokenStatus();
    }
  }, [isModalOpen, repo.path]);

  const handleError = (error: any, action: string) => {
    if (error.response?.status === 403) {
      const errorData = error.response.data;

      if (errorData?.error === 'PERMISSION_DENIED') {
        toast.error('Access Denied: You are not the owner of this project');
      } else {
        toast.error(`You do not have permission to ${action}`);
      }
    } else {
      const message = error.response?.data?.message || error.message || 'Unknown error';
      toast.error(`Failed to ${action}: ${message}`);
    }
  };

  const handleCopy = async (text: string, type: 'token' | 'command' | 'updateCommand', successMessage: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedStates((prev) => ({ ...prev, [type]: true }));
      setTimeout(() => setCopiedStates((prev) => ({ ...prev, [type]: false })), 2000);
      toast.success(successMessage);
    } catch (error) {
      console.error(error);
      toast.error(`Failed to copy ${type}`);
    }
  };

  const checkTokenStatus = async () => {
    if (!repo.path) {
      return;
    }

    setIsLoading(true);

    try {
      const response = await getDevTokenStatus(repo.path);

      if (response.success && response.data) {
        setTokenData({
          hasToken: response.data.hasToken,
          expiresAt: response.data.expiresAt,
          daysLeft: response.data.daysLeft,
          tokens: response.data.tokens || [],
        });
      }
    } catch (error) {
      handleError(error, 'check token status');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGenerateToken = async () => {
    if (!repo.path) {
      return;
    }

    setIsLoading(true);

    try {
      const response = await createDevToken(repo.path);

      if (response.success && response.data) {
        setTokenData({
          token: response.data.token,
          cloneCommand: response.data.cloneCommand,
          expiresAt: response.data.expiresAt,
          hasToken: true,
          daysLeft: response.data.expiresInDays,
        });
        toast.success('Git token generated successfully!');
      } else {
        if (response.error === 'PERMISSION_DENIED') {
          toast.error('Access Denied: You are not the owner of this project');
        } else if (response.error === 'TOKEN_LIMIT_EXCEEDED') {
          toast.error('Token limit reached: Maximum 3 active tokens allowed per project');
        } else {
          toast.error(`Failed to generate token: ${response.message || 'Unknown error'}`);
        }
      }
    } catch (error: any) {
      handleError(error, 'generate token');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRevokeAllTokens = async () => {
    if (!repo.path) {
      return;
    }

    setIsLoading(true);

    try {
      const response = await revokeAllDevTokens(repo.path);

      if (response.success) {
        await checkTokenStatus();
        toast.success('All active tokens revoked successfully!');
      } else {
        if (response.error === 'PERMISSION_DENIED') {
          toast.error('Access Denied: You are not the owner of this project');
        } else {
          toast.error(`Failed to revoke tokens: ${response.message}`);
        }
      }
    } catch (error: any) {
      handleError(error, 'revoke tokens');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRevokeToken = async (tokenId: number) => {
    if (!repo.path) {
      return;
    }

    setIsLoading(true);

    try {
      const response = await revokeDevToken(repo.path, tokenId);

      if (response.success) {
        await checkTokenStatus();
        toast.success('Token revoked successfully!');
      } else {
        if (response.error === 'PERMISSION_DENIED') {
          toast.error('Access Denied: You are not the owner of this project');
        } else {
          toast.error(`Failed to revoke token: ${response.message}`);
        }
      }
    } catch (error: any) {
      handleError(error, 'revoke token');
    } finally {
      setIsLoading(false);
    }
  };
  const getExpiryColor = (daysLeft: number) => {
    if (daysLeft < 3) {
      return 'text-red-500';
    }

    if (daysLeft < 7) {
      return 'text-yellow-500';
    }

    return 'text-white/60';
  };

  if (!repo.path) {
    return null;
  }

  return (
    <>
      <Tooltip.Root delayDuration={100}>
        <Tooltip.Trigger asChild>
          <button
            className="relative flex h-10 justify-center items-center gap-2 py-3 px-4 rounded-[4px] border border-white/12 bg-interactive-neutral hover:bg-interactive-neutral-hovered active:bg-interactive-neutral-pressed hover:border-interactive-neutral-hovered active:border-interactive-neutral-pressed focus:outline-none focus-visible:after:content-[''] focus-visible:after:absolute focus-visible:after:inset-[-3px] focus-visible:after:rounded-[4px] focus-visible:after:border focus-visible:after:border-[#1A92A4] focus-visible:after:pointer-events-none"
            onClick={() => setIsModalOpen(true)}
          >
            <div className="text-white/80 hover:text-white">
              <CodeIcon width={20} height={20} />
            </div>
            <span className="text-sm font-semibold leading-[142.9%] text-interactive-on-primary hover:text-[#FCFCFD] active:text-[#FFFFFF]">
              Git Access
            </span>
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            className="inline-flex items-start rounded-radius-8 bg-[var(--color-bg-inverse,#F3F5F8)] text-[var(--color-text-inverse,#111315)] p-[9.6px] shadow-md z-[9999] font-primary text-[12px] font-medium leading-[150%]"
            sideOffset={5}
            side="bottom"
            align="end"
            alignOffset={0}
          >
            Get git access to clone and develop this project locally
            <Tooltip.Arrow className="fill-[var(--color-bg-inverse,#F3F5F8)] translate-x-[-45px]" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>

      {isModalOpen &&
        createPortal(
          <div
            className={classNames(
              'fixed inset-0 bg-black bg-opacity-50 flex z-50',
              isMobileView ? 'items-end justify-center' : 'items-center justify-center',
            )}
            onClick={() => setIsModalOpen(false)}
          >
            <div
              className={classNames(
                'flex flex-col items-start gap-[16px] border border-[rgba(255,255,255,0.22)] bg-[#111315] shadow-[0_2px_8px_2px_rgba(26,220,217,0.12),0_12px_80px_16px_rgba(148,250,239,0.20)]',
                isMobileView
                  ? 'w-full pt-[28px] pb-[28px] px-[20px] rounded-t-[16px]'
                  : 'w-[600px] p-[32px] rounded-[16px]',
              )}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center gap-2 self-stretch">
                <div className="text-white/90">
                  <CodeIcon width={24} height={24} />
                </div>
                <span className="text-primary text-[20px] font-semibold leading-[140%] flex-[1_0_0]">Git Access</span>
                <button onClick={() => setIsModalOpen(false)} className="bg-transparent text-white/80 hover:text-white">
                  <CloseIcon width={20} height={20} />
                </button>
              </div>

              {/* Content */}
              <div className="flex flex-col items-start gap-4 self-stretch">
                {isLoading ? (
                  <div className="flex items-center justify-center py-8 self-stretch">
                    <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : (
                  <>
                    {/* Active Tokens List */}
                    {tokenData.tokens && tokenData.tokens.length > 0 && (
                      <div className="flex flex-col gap-3 p-3 self-stretch rounded-lg border border-white/22 bg-[#222428]/50">
                        <span className="text-sm font-medium text-bolt-elements-textPrimary">
                          Active Tokens ({tokenData.tokens.length})
                        </span>
                        <div className="flex flex-col gap-2">
                          {tokenData.tokens.map((token) => (
                            <div
                              key={token.id}
                              className="flex items-center justify-between py-2 px-3 rounded bg-black/20"
                            >
                              <div className="flex flex-col gap-1">
                                <span className="text-[12px] font-mono text-bolt-elements-textSecondary">
                                  {token.name}
                                </span>
                                <span className={classNames('text-[11px]', getExpiryColor(token.daysLeft))}>
                                  {token.daysLeft > 0 ? `${token.daysLeft} days left` : 'Expires today'}
                                </span>
                              </div>
                              <button
                                onClick={() => handleRevokeToken(token.id)}
                                disabled={isLoading}
                                className="px-3 py-1.5 rounded-md text-sm font-medium transition-colors bg-zinc-600 hover:bg-zinc-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                                title="Revoke token"
                              >
                                Revoke
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Token Display */}
                    {tokenData.token ? (
                      <>
                        <div className="flex flex-col gap-2 p-3 self-stretch rounded-lg border border-white/22 bg-[#222428]/50">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-bolt-elements-textPrimary">Access Token</span>
                            <button
                              onClick={() => handleCopy(tokenData.token!, 'token', 'Token copied to clipboard!')}
                              className="flex items-center gap-1 bg-transparent border-none text-gray-400 hover:text-gray-200 transition-colors cursor-pointer"
                              title="Copy token"
                            >
                              <CopyIcon width={14} height={14} />
                              <span className="text-[12px]">{copiedStates.token ? '✓ Copied' : 'Copy'}</span>
                            </button>
                          </div>
                          <code className="text-[12px] font-mono text-white/80 break-all bg-black/30 p-2 rounded">
                            {tokenData.token}
                          </code>
                          <span className="text-[11px] text-yellow-500/80">🔒 This token will only be shown once.</span>
                        </div>

                        <div className="flex flex-col gap-2 p-3 self-stretch rounded-lg border border-white/22 bg-[#222428]/50">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-bolt-elements-textPrimary">
                              Clone Git Repository Command
                            </span>
                            <button
                              onClick={() =>
                                handleCopy(`$ ${tokenData.cloneCommand!}`, 'command', 'Command copied to clipboard!')
                              }
                              className="flex items-center gap-1 bg-transparent border-none text-gray-400 hover:text-gray-200 transition-colors cursor-pointer"
                              title="Copy command"
                            >
                              <CopyIcon width={14} height={14} />
                              <span className="text-[12px]">{copiedStates.command ? '✓ Copied' : 'Copy'}</span>
                            </button>
                          </div>
                          <code className="text-[12px] font-mono text-white/80 break-all bg-black/30 p-2 rounded">
                            $ {tokenData.cloneCommand}
                          </code>
                          <span className="text-[11px] text-blue-400/80">
                            💡 Use this command to clone the repository with access token
                          </span>
                        </div>

                        <div className="flex flex-col gap-2 p-3 self-stretch rounded-lg border border-white/22 bg-[#222428]/50">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-bolt-elements-textPrimary">
                              Refresh AccessToken Command
                            </span>
                            <button
                              onClick={() =>
                                handleCopy(
                                  `$ git remote set-url origin https://oauth2:${tokenData.token}@${tokenData.cloneCommand?.split('@')[1]}`,
                                  'updateCommand',
                                  'Command copied to clipboard!',
                                )
                              }
                              className="flex items-center gap-1 bg-transparent border-none text-gray-400 hover:text-gray-200 transition-colors cursor-pointer"
                              title="Copy update command"
                            >
                              <CopyIcon width={14} height={14} />
                              <span className="text-[12px]">{copiedStates.updateCommand ? '✓ Copied' : 'Copy'}</span>
                            </button>
                          </div>
                          <code className="text-[12px] font-mono text-white/80 break-all bg-black/30 p-2 rounded">
                            $ git remote set-url origin https://oauth2:{tokenData.token}@
                            {tokenData.cloneCommand?.split('@')[1]}
                          </code>
                          <span className="text-[11px] text-blue-400/80">
                            💡 Use this command to update existing repositories with a new token
                          </span>
                        </div>

                        <div className="text-[12px] text-white/60">
                          <p>✨ Quick start guide:</p>
                          <ol className="list-decimal list-inside mt-1 space-y-1">
                            <li>
                              Navigate to project: <code>cd project-name</code>
                            </li>
                            <li>Make your changes and commit</li>
                            <li>
                              Push changes: <code>git push origin develop</code>
                            </li>
                          </ol>
                        </div>
                      </>
                    ) : (
                      <div className="flex flex-col gap-3 items-center justify-center py-6 self-stretch">
                        <span className="text-sm text-bolt-elements-textSecondary text-center">
                          {tokenData.tokens && tokenData.tokens.length > 0
                            ? 'Create a new token to get updated clone commands with fresh credentials.'
                            : 'Create an access token to start working with this project locally.'}
                        </span>
                        {tokenData.tokens && tokenData.tokens.length >= 3 && (
                          <span className="text-sm text-red-400 text-center">
                            ⚠️ Token limit reached: Maximum 3 active tokens allowed per project
                          </span>
                        )}
                      </div>
                    )}

                    {/* Actions */}
                    {!tokenData.token && (
                      <div className="flex gap-3 self-stretch">
                        <button
                          onClick={handleGenerateToken}
                          disabled={isLoading || (tokenData.tokens && tokenData.tokens.length >= 3)}
                          className="flex-1 px-4 py-2.5 rounded-md text-sm font-medium transition-colors bg-[#1A92A4] hover:bg-[#1A7583] active:bg-[#1B5862] text-white disabled:opacity-50 disabled:cursor-not-allowed"
                          title={
                            tokenData.tokens && tokenData.tokens.length >= 3
                              ? 'Maximum 3 tokens allowed per project'
                              : undefined
                          }
                        >
                          {isLoading ? 'Generating...' : 'Generate New Token'}
                        </button>

                        {tokenData.tokens && tokenData.tokens.length > 0 && (
                          <button
                            onClick={handleRevokeAllTokens}
                            disabled={isLoading}
                            className="flex-1 px-4 py-2.5 rounded-md text-sm font-medium transition-colors bg-zinc-600 hover:bg-zinc-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {isLoading ? 'Revoking...' : 'Revoke All Tokens'}
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
