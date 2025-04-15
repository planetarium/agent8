import { useParams } from '@remix-run/react';
import { classNames } from '~/utils/classNames';
import * as Dialog from '@radix-ui/react-dialog';
import { type RepositoryItem } from '~/lib/persistenceGitbase/types';
import WithTooltip from '~/components/ui/Tooltip';
import { forwardRef, type ForwardedRef } from 'react';

interface HistoryItemProps {
  item: RepositoryItem;
  onDelete?: (event: React.UIEvent) => void;
}

export function HistoryItem({ item, onDelete }: HistoryItemProps) {
  const { id: urlId } = useParams();
  const isActiveChat = urlId === item.urlId;

  return (
    <div
      className={classNames(
        'group rounded-lg text-sm text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-50/80 dark:hover:bg-gray-800/30 overflow-hidden flex justify-between items-center px-3 py-2 transition-colors',
        { 'text-gray-900 dark:text-white bg-gray-50/80 dark:bg-gray-800/30': isActiveChat },
      )}
    >
      <a href={`/chat/${item.urlId}`} className="flex w-full relative truncate block">
        <span className="truncate pr-24">{item.description}</span>
        <div
          className={classNames(
            'absolute right-0 top-0 bottom-0 flex items-center bg-white dark:bg-gray-950 group-hover:bg-gray-50/80 dark:group-hover:bg-gray-800/30 px-2',
            { 'bg-gray-50/80 dark:bg-gray-800/30': isActiveChat },
          )}
        >
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
      </a>
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
