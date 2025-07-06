import { motion, type Variants } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Dialog, DialogButton, DialogDescription, DialogRoot, DialogTitle } from '~/components/ui/Dialog';
import { ThemeSwitch } from '~/components/ui/ThemeSwitch';
import { cubicEasingFn } from '~/utils/easings';
import { HistoryItem } from './HistoryItem';
import { binDates } from './date-binning';
import { useSearchFilter } from '~/lib/hooks/useSearchFilter';
import { classNames } from '~/utils/classNames';
import { useStore } from '@nanostores/react';
import { v8UserStore } from '~/lib/stores/v8User';
import { deleteProject, getProjects } from '~/lib/persistenceGitbase/api.client';
import type { RepositoryItem } from '~/lib/persistenceGitbase/types';
import { chatStore } from '~/lib/stores/chat';
import { menuStore, closeMenu } from '~/lib/stores/menu';
import { useSearchParams } from '@remix-run/react';
import { IconButton } from '~/components/ui/IconButton';
import { IframeLink } from '~/components/ui/IframeLink';

const menuVariants = {
  closed: {
    opacity: 0,
    visibility: 'hidden',
    left: '-340px',
    transition: {
      duration: 0.2,
      ease: cubicEasingFn,
    },
  },
  open: {
    opacity: 1,
    visibility: 'initial',
    left: 0,
    transition: {
      duration: 0.2,
      ease: cubicEasingFn,
    },
  },
} satisfies Variants;

type DialogContent = { type: 'delete'; item: RepositoryItem } | null;

function CurrentDateTime() {
  const [dateTime, setDateTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setDateTime(new Date());
    }, 60000);

    return () => clearInterval(timer);
  }, []);

  return (
    <div className="flex items-center gap-2 px-4 py-2 text-sm text-gray-600 dark:text-gray-400 border-b border-gray-100 dark:border-gray-800/50">
      <div className="h-4 w-4 i-lucide:clock opacity-80" />
      <div className="flex gap-2">
        <span>{dateTime.toLocaleDateString()}</span>
        <span>{dateTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
    </div>
  );
}

export const Menu = () => {
  const isSideMenuDisabled = import.meta.env.VITE_DISABLE_SIDEMENU === 'true';

  if (isSideMenuDisabled) {
    return null;
  }

  const menuRef = useRef<HTMLDivElement>(null);
  const [list, setList] = useState<RepositoryItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [dialogContent, setDialogContent] = useState<DialogContent | null>(null);

  const open = useStore(menuStore);

  const v8Auth = useStore(v8UserStore);
  const chat = useStore(chatStore);
  const [searchParams] = useSearchParams();
  const isEmbedMode = searchParams.get('mode') === 'embed';

  const { filteredItems: filteredList, handleSearchChange } = useSearchFilter({
    items: list,
    searchFields: ['description'],
  });

  const loadEntries = useCallback(() => {
    setLoading(true);

    getProjects().then((res: any) => {
      if (res.success) {
        setList(
          res.data.projects.map((project: any) => ({
            projectId: project.id,
            urlId: project.path_with_namespace,
            id: project.name,
            description: (project.description || project.name).split('\n')[0],
            timestamp: project.updated_at,
          })),
        );
      } else {
        console.error(res.error);
      }

      setLoading(false);
    });
  }, []);

  const deleteItem = useCallback((event: React.UIEvent, item: RepositoryItem) => {
    event.preventDefault();

    deleteProject(item.projectId).then((res: any) => {
      if (res.success) {
        loadEntries();
      } else {
        console.error(res.error);
      }
    });
  }, []);

  const closeDialog = () => {
    setDialogContent(null);
  };

  useEffect(() => {
    if (open) {
      loadEntries();
    }
  }, [open]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!open) {
        return;
      }

      const menuToggleButton = document.querySelector('.i-ph\\:sidebar-simple-duotone');

      if (
        menuRef.current &&
        !menuRef.current.contains(event.target as Node) &&
        menuToggleButton !== event.target &&
        !menuToggleButton?.contains(event.target as Node)
      ) {
        closeMenu();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [open]);

  const handleDeleteClick = (event: React.UIEvent, item: RepositoryItem) => {
    event.preventDefault();
    setDialogContent({ type: 'delete', item });
  };

  return (
    <>
      <motion.div
        ref={menuRef}
        initial="closed"
        animate={open ? 'open' : 'closed'}
        variants={menuVariants}
        style={{ width: '340px' }}
        className={classNames(
          'flex selection-accent flex-col side-menu fixed top-0',
          'bg-white dark:bg-gray-950 border-r border-gray-100 dark:border-gray-800/50',
          'shadow-sm text-sm ',
          'z-sidebar',
          isEmbedMode ? (!chat.started ? 'mt-[56px] h-[calc(100%-56px)]' : 'mt-2 h-full') : 'h-full',
        )}
      >
        <div className="h-13.5 flex items-center justify-between px-4 border-b border-gray-100 dark:border-gray-800/50 bg-gray-50/50 dark:bg-gray-900/50">
          <div className="text-gray-900 dark:text-white font-medium"></div>
          <div className="flex flex-col items-end">
            <span className="font-medium text-sm text-gray-900 dark:text-white truncate">
              {v8Auth.loading ? 'Loading...' : v8Auth.user?.name || 'Guest User'}
            </span>
            {v8Auth.user?.email && (
              <span className="text-xs text-gray-500 dark:text-gray-400 truncate">{v8Auth.user.email}</span>
            )}
          </div>
        </div>
        <CurrentDateTime />
        <div className="flex-1 flex flex-col h-full w-full overflow-hidden">
          <div className="p-4 space-y-3">
            <IframeLink
              to="/"
              className="flex gap-2 items-center bg-cyan-50 dark:bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 hover:bg-cyan-100 dark:hover:bg-cyan-500/20 rounded-lg px-4 py-2 transition-colors"
            >
              <span className="inline-block i-lucide:message-square h-4 w-4" />
              <span className="text-sm font-medium">Start new chat</span>
            </IframeLink>
            <div className="relative w-full">
              <div className="absolute left-3 top-1/2 -translate-y-1/2">
                <span className="i-lucide:search h-4 w-4 text-gray-400 dark:text-gray-500" />
              </div>
              <input
                className="w-full bg-gray-50 dark:bg-gray-900 relative pl-9 pr-3 py-2 rounded-lg focus:outline-none focus:ring-1 focus:ring-cyan-500/50 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-500 border border-gray-200 dark:border-gray-800"
                type="search"
                placeholder="Search chats..."
                onChange={handleSearchChange}
                aria-label="Search chats"
              />
            </div>
          </div>
          <div className="text-gray-600 dark:text-gray-400 text-sm font-medium px-4 py-2">Your Chats</div>
          <div className="flex-1 overflow-auto px-3 pb-3">
            {loading ? (
              <div className="px-4 text-gray-500 dark:text-gray-400 text-sm">Loading...</div>
            ) : (
              filteredList.length === 0 && (
                <div className="px-4 text-gray-500 dark:text-gray-400 text-sm">
                  {list.length === 0 ? 'No previous conversations' : 'No matches found'}
                </div>
              )
            )}
            <DialogRoot open={dialogContent !== null}>
              {binDates(filteredList).map(({ category, items }) => (
                <div key={category} className="mt-2 first:mt-0 space-y-1">
                  <div className="text-xs font-medium text-gray-500 dark:text-gray-400 sticky top-0 z-1 bg-white dark:bg-gray-950 px-4 py-1">
                    {category}
                  </div>
                  <div className="space-y-0.5 pr-1">
                    {items.map((item) => (
                      <HistoryItem key={item.id} item={item} onDelete={(event) => handleDeleteClick(event, item)} />
                    ))}
                  </div>
                </div>
              ))}
              <Dialog onBackdrop={closeDialog} onClose={closeDialog}>
                {dialogContent?.type === 'delete' && (
                  <>
                    <div className="p-6 bg-white dark:bg-gray-950">
                      <DialogTitle className="text-gray-900 dark:text-white">Delete Chat?</DialogTitle>
                      <DialogDescription className="mt-2 text-gray-600 dark:text-gray-400">
                        <p>
                          You are about to delete{' '}
                          <span className="font-medium text-gray-900 dark:text-white">
                            {dialogContent.item.description}
                          </span>
                        </p>
                        <p className="mt-2">Are you sure you want to delete this chat?</p>
                      </DialogDescription>
                    </div>
                    <div className="flex justify-end gap-3 px-6 py-4 bg-gray-50 dark:bg-gray-900 border-t border-gray-100 dark:border-gray-800">
                      <DialogButton type="secondary" onClick={closeDialog}>
                        Cancel
                      </DialogButton>
                      <DialogButton
                        type="danger"
                        onClick={(event) => {
                          deleteItem(event, dialogContent.item);
                          closeDialog();
                        }}
                      >
                        Delete
                      </DialogButton>
                    </div>
                  </>
                )}
              </Dialog>
            </DialogRoot>
          </div>
          <div
            className={classNames(
              'flex items-center justify-between border-t border-gray-200 dark:border-gray-800 px-4 py-3',
              isEmbedMode && chat.started ? 'mb-2' : '',
            )}
          >
            <ThemeSwitch />
            <IconButton
              onClick={() => menuStore.set(false)}
              icon="i-ph:x-circle"
              size="xl"
              title="Close"
              className="ml-auto text-[#666] dark:text-gray-400 hover:text-bolt-elements-textPrimary dark:hover:text-white hover:bg-gray-100/50 dark:hover:bg-gray-800/30 transition-colors"
            />
          </div>
        </div>
      </motion.div>
    </>
  );
};
