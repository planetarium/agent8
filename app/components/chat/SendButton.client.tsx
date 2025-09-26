import * as Tooltip from '@radix-ui/react-tooltip';
import { ArrowTopLineIcon } from '~/components/ui/Icons/';

interface SendButtonProps {
  show: boolean;
  isStreaming?: boolean;
  disabled?: boolean;
  isAuthenticated?: boolean;
  onClick?: (event: React.MouseEvent<HTMLButtonElement, MouseEvent>) => void;
  onImagesSelected?: (images: File[]) => void;
}

export const SendButton = ({ show, isStreaming, disabled, isAuthenticated = true, onClick }: SendButtonProps) => {
  return show ? (
    <Tooltip.Root open={!isAuthenticated}>
      <Tooltip.Trigger asChild>
        <button
          className="inline-flex justify-center items-center p-2 gap-1.2 rounded-radius-4 border-width-1 border-solid border-interactive-neutral hover:border-interactive-neutral-hovered active:border-interactive-neutral-pressed disabled:border-disabled bg-interactive-primary hover:bg-[#1a7583] active:bg-[#1b5862] disabled:bg-disabled transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ backgroundSize: '104% 104%', backgroundPosition: 'center' }}
          {...(!disabled && { 'data-track': isStreaming ? 'editor-prompt-stop' : 'editor-prompt-create' })}
          disabled={disabled}
          onClick={(event) => {
            event.preventDefault();

            if (!disabled) {
              onClick?.(event);
            }
          }}
        >
          <div className="text-[0.9rem]">
            {!isStreaming ? (
              <ArrowTopLineIcon aria-label="Send" />
            ) : (
              <div className="i-ph:stop-circle-bold w-5 h-5 text-white" />
            )}
          </div>
          {isStreaming && (
            <span className="text-interactive-on-primary font-feature-stylistic font-primary text-[14px] font-semibold leading-[142.9%]">
              Stop
            </span>
          )}
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          className="inline-flex items-center rounded-radius-8 bg-[var(--color-bg-inverse,#F3F5F8)] text-[var(--color-text-inverse,#111315)] p-[9.6px] shadow-md z-[9999] font-primary text-[12px] font-medium leading-[150%]"
          sideOffset={5}
          side="bottom"
        >
          <span>Enjoy free credits!</span>
          <Tooltip.Arrow className="fill-[var(--color-bg-inverse,#F3F5F8)]" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  ) : null;
};
