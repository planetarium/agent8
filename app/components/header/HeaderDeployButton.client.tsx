import { workbenchStore } from '~/lib/stores/workbench';
import { chatId as chatIdStore, description as descriptionStore } from '~/lib/persistence';
import { Button } from '~/components/ui/Button';

export function HeaderDeployButton() {
  const handleDeploy = async () => {
    const chatId = chatIdStore.get();
    const title = descriptionStore.get() || 'Game Project';

    if (chatId) {
      await workbenchStore.publish(chatId, title);
    }
  };

  return (
    <div className="flex border border-bolt-elements-borderColor rounded-md overflow-hidden mr-2 text-sm">
      <Button
        onClick={handleDeploy}
        className="px-4 dark:bg-bolt-elements-background-depth-2 hover:bg-bolt-elements-item-backgroundActive flex items-center gap-2"
      >
        Deploy
      </Button>
    </div>
  );
}
