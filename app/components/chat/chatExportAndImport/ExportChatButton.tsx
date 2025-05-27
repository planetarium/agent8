import { IconButton } from '~/components/ui/IconButton';

export const ExportChatButton = ({ exportChat }: { exportChat?: () => void }) => {
  return (
    <IconButton onClick={() => exportChat?.()}>
      <div className="flex p-1 justify-center items-center gap-1.5">
        <img src="/icons/Export.svg" alt="Export" />
      </div>
    </IconButton>
  );
};
