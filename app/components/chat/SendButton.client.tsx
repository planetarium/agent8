interface SendButtonProps {
  show: boolean;
  isStreaming?: boolean;
  disabled?: boolean;
  onClick?: (event: React.MouseEvent<HTMLButtonElement, MouseEvent>) => void;
  onImagesSelected?: (images: File[]) => void;
}

export const SendButton = ({ show, isStreaming, disabled, onClick }: SendButtonProps) => {
  return show ? (
    <button
      className="inline-flex justify-center items-center py-2.5 px-3.5 gap-1.5 rounded-[4px] border border-solid border-[rgba(255,255,255,0.18)] hover:border-[rgba(255,255,255,0.22)] active:border-[rgba(255,255,255,0.35)] disabled:border-[rgba(255,255,255,0.08)] bg-interactive-gradient hover:bg-interactive-gradient-hovered active:bg-interactive-gradient-pressed disabled:bg-[var(--color-bg-disabled)] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
      style={{ backgroundSize: '102% 102%', backgroundPosition: 'center' }}
      disabled={disabled}
      onClick={(event) => {
        event.preventDefault();

        if (!disabled) {
          onClick?.(event);
        }
      }}
    >
      <div className="text-lg">{!isStreaming && <img src="/icons/Sparkle.svg" alt="Send" />}</div>
      <span className="text-interactive-on-primary font-feature-stylistic font-primary text-sm font-semibold leading-[142.9%]">
        {!isStreaming ? 'Create' : 'Stop'}
      </span>
    </button>
  ) : null;
};
