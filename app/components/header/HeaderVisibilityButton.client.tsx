import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '@nanostores/react';
import { toast } from 'react-toastify';
import axios from 'axios';
import * as Tooltip from '@radix-ui/react-tooltip';

import { classNames } from '~/utils/classNames';
import { repoStore } from '~/lib/stores/repo';
import useViewport from '~/lib/hooks';
import { MOBILE_BREAKPOINT } from '~/lib/constants/viewport';

import CustomButton from '~/components/ui/CustomButton';
import { Switch } from '~/components/ui/Switch';
import { ShareFillIcon, ShareLineIcon, CloseIcon, GlobalIcon, LinkIcon } from '~/components/ui/Icons';

type VisibilityType = 'public' | 'private';

interface HeaderVisibilityButtonProps {
  asMenuItem?: boolean;
  onClose?: () => void;
}

export function HeaderVisibilityButton({ asMenuItem = false, onClose }: HeaderVisibilityButtonProps) {
  const repo = useStore(repoStore);
  const isSmallViewport = useViewport(MOBILE_BREAKPOINT);

  const [visibility, setVisibility] = useState<VisibilityType>('private');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isInitialLoading, setIsInitialLoading] = useState<boolean>(true);
  const [currentUrl, setCurrentUrl] = useState('');

  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);

  const handleCloseModal = () => {
    setIsModalOpen(false);
    onClose?.();
  };

  // Load current visibility on mount and set current URL
  useEffect(() => {
    const loadVisibility = async () => {
      if (!repo.path) {
        return;
      }

      try {
        const response = await axios.get('/api/gitlab/visibility', {
          params: { projectPath: repo.path },
        });

        if (response.data.success) {
          setVisibility(response.data.data.visibility === 'public' ? 'public' : 'private');
        }
      } catch (error) {
        console.error('Failed to load visibility:', error);
      } finally {
        setIsInitialLoading(false);
      }
    };

    // Set share URL
    if (repo.path) {
      setCurrentUrl(`https://verse8.io/creator/editor?chat=${encodeURIComponent(repo.path)}`);
    }

    loadVisibility();
  }, [repo.path]);

  const handleVisibilityChange = async (newVisibility: VisibilityType) => {
    if (isLoading || !repo.path) {
      return;
    }

    setIsLoading(true);

    try {
      const response = await axios.patch('/api/gitlab/visibility', {
        projectPath: repo.path,
        visibility: newVisibility,
      });

      if (response.data.success) {
        setVisibility(newVisibility);
      } else {
        throw new Error(response.data.message || 'Failed to update visibility');
      }
    } catch (error) {
      console.error('Failed to change visibility:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(currentUrl);
      toast.success('Link copied to clipboard!');
    } catch (error) {
      console.error('Failed to copy link:', error);
      toast.error('Failed to copy link');
    }
  };

  const isCopyDisabled = visibility === 'private' || isLoading || isInitialLoading;

  return (
    <>
      {asMenuItem ? (
        <div
          className="flex items-center gap-4 w-full bg-transparent text-primary text-body-md-medium cursor-pointer"
          onClick={() => setIsModalOpen(true)}
        >
          <ShareLineIcon width={20} height={20} />
          <span>Share Code</span>
        </div>
      ) : (
        <Tooltip.Root delayDuration={100}>
          <Tooltip.Trigger asChild>
            <CustomButton
              variant="secondary-outlined"
              size="md"
              onClick={() => setIsModalOpen(true)}
              disabled={isLoading || isInitialLoading}
            >
              {isLoading || isInitialLoading ? (
                <>
                  <div className="w-2 h-2 border border-white border-t-transparent rounded-full animate-spin" />
                  Loading...
                </>
              ) : (
                <>
                  <ShareFillIcon width={20} height={20} />
                  Share
                </>
              )}
            </CustomButton>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content
              className="inline-flex items-start rounded-radius-8 bg-[var(--color-bg-inverse,#F3F5F8)] text-[var(--color-text-inverse,#111315)] p-[9.6px] shadow-md z-[9999] text-body-md-medium"
              sideOffset={5}
              side="bottom"
              align="end"
              alignOffset={0}
            >
              Set your code visibility and share the link
              <Tooltip.Arrow className="fill-[var(--color-bg-inverse,#F3F5F8)] translate-x-[-30px]" />
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      )}

      {isModalOpen &&
        createPortal(
          <div
            className={classNames(
              'fixed inset-0 bg-black bg-opacity-50 flex z-50',
              isSmallViewport ? 'items-end justify-center' : 'items-center justify-center',
            )}
            onClick={handleCloseModal}
          >
            <div
              className={classNames(
                'flex flex-col items-start gap-[12px] border border-[rgba(255,255,255,0.22)] bg-[#111315] shadow-[0_2px_8px_2px_rgba(26,220,217,0.12),0_12px_80px_16px_rgba(148,250,239,0.20)]',
                isSmallViewport
                  ? 'w-full pt-[28px] pb-[28px] px-[20px] rounded-t-[16px]'
                  : 'w-[500px] p-[32px] rounded-[16px]',
              )}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-2 self-stretch">
                <span className="text-primary text-[20px] font-semibold leading-[140%] flex-[1_0_0]">
                  Set the code visibility and share the link
                </span>
                <button onClick={handleCloseModal} className="bg-transparent">
                  <CloseIcon width={20} height={20} />
                </button>
              </div>

              <div className="flex flex-col items-start pt-[14px] gap-3 self-stretch">
                {/* Visibility Switch */}
                <div className="flex items-center gap-3 self-stretch">
                  <div className="flex flex-col items-start justify-center gap-2 flex-[1_0_0]">
                    <div className="flex items-center gap-2 self-stretch">
                      <GlobalIcon />
                      <span className="text-primary text-sm font-medium leading-[142.9%]">Make my code public</span>
                    </div>
                  </div>
                  <Switch
                    checked={visibility === 'public'}
                    onCheckedChange={(checked) => {
                      handleVisibilityChange(checked ? 'public' : 'private');
                    }}
                    disabled={isLoading || isInitialLoading}
                  />
                </div>
                <span className="text-[#F79009] text-[12px] font-normal leading-[133.4%]">
                  This setting only affects the visibility of your code. It does not affect who can play your game.
                </span>

                {/* Copy Link Section */}
                <div className="flex flex-col items-start gap-4 p-3 self-stretch rounded-lg border border-white/22">
                  <div className="flex flex-col items-start gap-3 self-stretch">
                    <span className="text-sm font-medium text-tertiary">Project Link</span>
                    <div className="flex gap-2 items-center justify-center py-2 px-4 gap-2 self-stretch rounded-lg bg-[#222428]">
                      <LinkIcon />
                      <input
                        type="text"
                        value={currentUrl}
                        readOnly
                        className="text-tertiary flex-1 text-sm font-medium leading-[142.9%] bg-transparent"
                      />
                      <button
                        onClick={handleCopyLink}
                        className={classNames(
                          'flex h-10 justify-center items-center gap-[6px] py-[10px] px-[14px] rounded-[4px] text-sm font-medium',
                          isCopyDisabled
                            ? 'border border-white/8 bg-white/5 text-white/40 cursor-not-allowed'
                            : 'bg-[#1A92A4] hover:bg-[#1A7583] active:bg-[#1B5862] text-white border border-[#1A92A4] hover:border-white/18 active:border-white/22',
                        )}
                        disabled={isCopyDisabled}
                      >
                        Copy Link
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
