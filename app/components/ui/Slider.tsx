import { memo } from 'react';
import { classNames } from '~/utils/classNames';
import { genericMemo } from '~/utils/react';

export type SliderOption<T> = {
  value: T;
  text: string;
  dataTrack?: string;
};

export type SliderOptions<T> = SliderOption<T>[];

export type LegacySliderOptions<T> = {
  left: { value: T; text: string };
  middle?: { value: T; text: string };
  right: { value: T; text: string };
};

interface SliderButtonProps {
  selected: boolean;
  children: string | JSX.Element | Array<JSX.Element | string>;
  setSelected: () => void;
  dataTrack?: string;
}

interface SliderProps<T> {
  selected: T;
  options: SliderOptions<T> | LegacySliderOptions<T>;
  setSelected?: (selected: T) => void;
}

const SliderButton = memo(({ selected, children, setSelected, dataTrack }: SliderButtonProps) => {
  return (
    <button
      onClick={setSelected}
      data-track={dataTrack}
      className={classNames(
        'flex h-10 px-5 justify-center items-center gap-2 bg-transparent text-heading-xs relative mb-[-2px] border-b-2',
        selected
          ? 'text-interactive-selected border-interactive-primary'
          : 'text-interactive-neutral hover:text-interactive-neutral-hovered border-transparent',
      )}
    >
      {children}
    </button>
  );
});

export const Slider = genericMemo(<T,>({ selected, options, setSelected }: SliderProps<T>) => {
  const normalizedOptions: SliderOptions<T> = Array.isArray(options)
    ? options
    : [options.left, ...(options.middle ? [options.middle] : []), options.right];

  return (
    <div className="flex items-center flex-wrap shrink-0 border-b border-secondary w-full">
      {normalizedOptions.map((option, index) => (
        <SliderButton
          key={index}
          selected={selected === option.value}
          setSelected={() => setSelected?.(option.value)}
          dataTrack={option.dataTrack}
        >
          {option.text}
        </SliderButton>
      ))}
    </div>
  );
});
