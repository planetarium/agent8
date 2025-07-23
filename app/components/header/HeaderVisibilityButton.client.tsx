import { useState, useEffect } from 'react';
import { useStore } from '@nanostores/react';
import { Button } from '~/components/ui/Button';
import { Dropdown, DropdownSeparator } from '~/components/ui/Dropdown';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { classNames } from '~/utils/classNames';
import { repoStore } from '~/lib/stores/repo';
import axios from 'axios';

type VisibilityType = 'public' | 'private';

export function HeaderVisibilityButton() {
  const repo = useStore(repoStore);
  const [visibility, setVisibility] = useState<VisibilityType>('private');
  const [isLoading, setIsLoading] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [currentUrl, setCurrentUrl] = useState('');
  const [copyButtonText, setCopyButtonText] = useState('Copy');

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
      setCopyButtonText('Copied!');
      setTimeout(() => {
        setCopyButtonText('Copy');
      }, 2000);
    } catch (error) {
      console.error('Failed to copy link:', error);
      setCopyButtonText('Failed');
      setTimeout(() => {
        setCopyButtonText('Copy');
      }, 2000);
    }
  };

  const isCopyDisabled = visibility === 'private' || isLoading || isInitialLoading;

  return (
    <div className="flex border border-bolt-elements-borderColor rounded-md overflow-hidden mr-2 text-sm">
      <Dropdown
        trigger={
          <Button
            className="px-4 dark:bg-bolt-elements-background-depth-2 hover:bg-bolt-elements-item-backgroundActive flex items-center gap-2"
            disabled={isLoading || isInitialLoading}
          >
            {isLoading || isInitialLoading ? (
              <>
                <div className="w-2 h-2 border border-bolt-elements-textSecondary border-t-transparent rounded-full animate-spin" />
                <span>Loading...</span>
              </>
            ) : (
              <>
                <div
                  className={classNames(
                    'w-2 h-2 rounded-full',
                    visibility === 'public' ? 'bg-green-500' : 'bg-orange-500',
                  )}
                />
                <span
                  className={classNames(
                    visibility === 'private' ? 'text-bolt-elements-textSecondary' : 'text-bolt-elements-textPrimary',
                  )}
                >
                  Share this chat
                </span>
                <div className="i-ph:caret-down text-xs" />
              </>
            )}
          </Button>
        }
        align="end"
      >
        {/* Copy Link Section */}
        <div className="px-3 pt-2 pb-2 border-b border-bolt-elements-borderColor">
          <div className="text-sm font-medium mb-2 text-bolt-elements-textPrimary">Share Link</div>
          <div className="flex gap-2 items-center">
            <input
              type="text"
              value={currentUrl}
              readOnly
              className="flex-1 px-2 py-1 text-xs bg-bolt-elements-background-depth-3 border border-bolt-elements-borderColor rounded text-bolt-elements-textSecondary"
            />
            <Button
              onClick={handleCopyLink}
              className={classNames(
                'px-3 py-1 text-xs',
                visibility === 'public' && !isCopyDisabled && copyButtonText === 'Copy'
                  ? 'bg-cyan-500 hover:bg-cyan-600 text-white'
                  : '',
                copyButtonText === 'Copied!' ? 'bg-green-500 hover:bg-green-600 text-white' : '',
                copyButtonText === 'Failed' ? 'bg-red-500 hover:bg-red-600 text-white' : '',
              )}
              disabled={isCopyDisabled}
            >
              {copyButtonText}
            </Button>
          </div>
          {visibility === 'private' && (
            <div className="text-xs text-bolt-elements-textSecondary mt-1">Make chat public to enable sharing</div>
          )}
        </div>

        <DropdownMenu.Item
          onSelect={(e) => {
            e.preventDefault();
            handleVisibilityChange('public');
          }}
          disabled={isLoading || isInitialLoading}
          className={classNames(
            'relative flex flex-col items-start gap-1 text-left w-full px-3 py-2 rounded-lg text-sm',
            'text-bolt-elements-textPrimary',
            (!isLoading &&
              !isInitialLoading &&
              'hover:bg-bolt-elements-background-depth-3 hover:text-bolt-elements-textPrimary cursor-pointer') ||
              '',
            'transition-colors outline-none',
            visibility === 'public' ? 'bg-bolt-elements-background-depth-3' : '',
          )}
        >
          <div className="flex items-center gap-2 w-full">
            <div className="w-2 h-2 rounded-full bg-green-500" />
            <span className="font-medium">Public</span>
            {visibility === 'public' && <div className="i-ph:check text-accent ml-auto" />}
          </div>
          <div className="text-xs text-bolt-elements-textSecondary text-left w-full">
            Chat is publicly accessible and shareable
          </div>
        </DropdownMenu.Item>

        <DropdownSeparator />

        <DropdownMenu.Item
          onSelect={(e) => {
            e.preventDefault();
            handleVisibilityChange('private');
          }}
          disabled={isLoading || isInitialLoading}
          className={classNames(
            'relative flex flex-col items-start gap-1 text-left w-full px-3 py-2 rounded-lg text-sm',
            'text-bolt-elements-textPrimary',
            (!isLoading &&
              !isInitialLoading &&
              'hover:bg-bolt-elements-background-depth-3 hover:text-bolt-elements-textPrimary cursor-pointer') ||
              '',
            'transition-colors outline-none',
            visibility === 'private' ? 'bg-bolt-elements-background-depth-3' : '',
          )}
        >
          <div className="flex items-center gap-2 w-full">
            <div className="w-2 h-2 rounded-full bg-orange-500" />
            <span className="font-medium">Private</span>
            {visibility === 'private' && <div className="i-ph:check text-accent ml-auto" />}
          </div>
          <div className="text-xs text-bolt-elements-textSecondary text-left w-full">
            Chat is private and not shareable
          </div>
        </DropdownMenu.Item>
      </Dropdown>
    </div>
  );
}
