import { useLocation } from '@remix-run/react';
import { classNames } from '~/utils/classNames';
import * as Dialog from '@radix-ui/react-dialog';
import { type RepositoryItem } from '~/lib/persistenceGitbase/types';
import WithTooltip from '~/components/ui/Tooltip';
import { forwardRef, type ForwardedRef } from 'react';
import { useStore } from '@nanostores/react';
import { chatStore } from '~/lib/stores/chat';
import { repoStore } from '~/lib/stores/repo';
import { IframeLink } from '~/components/ui/IframeLink';

interface HistoryItemProps {
  item: RepositoryItem;
  onDelete?: (event: React.UIEvent) => void;
}

export function HistoryItem({ item, onDelete }: HistoryItemProps) {
  const location = useLocation();
  const currentPath = location.pathname;

  const [user, repo] = item.urlId.split('/');
  const issueProjectPath = `/issue/${user}/${repo}`;

  const chat = useStore(chatStore);
  const currentRepo = useStore(repoStore);

  const isPathMatch = currentPath === issueProjectPath;
  const isRepoMatch = currentRepo.path === item.urlId && chat.started;
  const isActiveProject = isPathMatch || isRepoMatch;

  return (
    <div
      className={classNames(
        'group rounded-lg text-sm text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-50/80 dark:hover:bg-gray-800/30 overflow-hidden flex justify-between items-center px-3 py-2 transition-colors',
        { 'text-gray-900 dark:text-white bg-gray-50 dark:bg-gray-700/50': isActiveProject },
      )}
    >
      <IframeLink to={issueProjectPath} className="flex-1 truncate block pr-12">
        <span className="truncate">{item.description}</span>
      </IframeLink>
      <div className="flex items-center gap-2.5 text-gray-400 dark:text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity">
        <Dialog.Trigger asChild>
          <ChatActionButton
            toolTipContent="Delete"
            icon="i-ph:trash h-4 w-4"
            className="hover:text-red-500"
            onClick={(event) => {
              event.preventDefault();
              onDelete?.(event);
            }}
          />
        </Dialog.Trigger>
      </div>
    </div>
  );
}

const ChatActionButton = forwardRef(
  (
    {
      toolTipContent,
      icon,
      className,
      onClick,
    }: {
      toolTipContent: string;
      icon: string;
      className?: string;
      onClick: (event: React.MouseEvent<HTMLButtonElement, MouseEvent>) => void;
      btnTitle?: string;
    },
    ref: ForwardedRef<HTMLButtonElement>,
  ) => {
    return (
      <WithTooltip tooltip={toolTipContent} position="bottom" sideOffset={4}>
        <button
          ref={ref}
          type="button"
          className={`text-gray-400 dark:text-gray-500 hover:text-purple-500 dark:hover:text-purple-400 transition-colors ${icon} ${className ? className : ''}`}
          onClick={onClick}
        />
      </WithTooltip>
    );
  },
);
