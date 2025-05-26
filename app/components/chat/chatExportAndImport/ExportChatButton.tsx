import WithTooltip from '~/components/ui/Tooltip';
import { IconButton } from '~/components/ui/IconButton';
import React from 'react';

export const ExportChatButton = ({ exportChat }: { exportChat?: () => void }) => {
  return (
    <WithTooltip tooltip="Export Chat">
      <IconButton title="Export Chat" onClick={() => exportChat?.()}>
        <div className="flex p-2 justify-center items-center gap-1.5">
          <img src="/icons/Export.svg" alt="Export" />
        </div>
      </IconButton>
    </WithTooltip>
  );
};
