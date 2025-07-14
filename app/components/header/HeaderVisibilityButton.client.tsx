import { useState, useEffect } from 'react';
import { useStore } from '@nanostores/react';
import { Button } from '~/components/ui/Button';
import { Dropdown, DropdownItem, DropdownSeparator } from '~/components/ui/Dropdown';
import { classNames } from '~/utils/classNames';
import { repoStore } from '~/lib/stores/repo';
import axios from 'axios';

type VisibilityType = 'public' | 'private';

export function HeaderVisibilityButton() {
  const repo = useStore(repoStore);
  const [visibility, setVisibility] = useState<VisibilityType>('private');
  const [isLoading, setIsLoading] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(true);

  // Load current visibility on mount
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
                {visibility === 'public' ? 'Public' : 'Private'}
                <div className="i-ph:caret-down text-xs" />
              </>
            )}
          </Button>
        }
        align="end"
      >
        <DropdownItem
          onSelect={() => handleVisibilityChange('public')}
          disabled={isLoading || isInitialLoading}
          className={classNames(
            'flex flex-col items-start gap-1 text-left w-full',
            visibility === 'public' ? 'bg-bolt-elements-background-depth-3' : '',
          )}
        >
          <div className="flex items-center gap-2 w-full">
            <div className="w-2 h-2 rounded-full bg-green-500" />
            <span className="font-medium">Public</span>
            {visibility === 'public' && <div className="i-ph:check text-accent ml-auto" />}
          </div>
          <div className="text-xs text-bolt-elements-textSecondary text-left w-full">
            Code is publicly accessible, history is viewable, spin is enabled
          </div>
        </DropdownItem>

        <DropdownSeparator />

        <DropdownItem
          onSelect={() => handleVisibilityChange('private')}
          disabled={isLoading || isInitialLoading}
          className={classNames(
            'flex flex-col items-start gap-1 text-left w-full',
            visibility === 'private' ? 'bg-bolt-elements-background-depth-3' : '',
          )}
        >
          <div className="flex items-center gap-2 w-full">
            <div className="w-2 h-2 rounded-full bg-orange-500" />
            <span className="font-medium">Private</span>
            {visibility === 'private' && <div className="i-ph:check text-accent ml-auto" />}
          </div>
          <div className="text-xs text-bolt-elements-textSecondary text-left w-full">
            Code is private, history is hidden, remix is disabled
          </div>
        </DropdownItem>
      </Dropdown>
    </div>
  );
}
