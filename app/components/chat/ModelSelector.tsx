import type { ProviderInfo } from '~/types/model';
import { useEffect, useState, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import type { ModelInfo } from '~/lib/modules/llm/types';
import { classNames } from '~/utils/classNames';
import { MODEL_WHITELIST } from '~/lib/modules/llm/whitelist';
import type { WhitelistItem } from '~/lib/modules/llm/whitelist';

interface ModelSelectorProps {
  model?: string;
  setModel?: (model: string) => void;
  provider?: ProviderInfo;
  setProvider?: (provider: ProviderInfo) => void;
  modelList: ModelInfo[];
  providerList: ProviderInfo[];
  modelLoading?: string;
}

// Special model name for Auto mode
const AUTO_MODEL_NAME = 'auto';

export const ModelSelector = ({
  model,
  setModel,
  provider,
  setProvider,
  modelList,
  providerList,
  modelLoading,
}: ModelSelectorProps) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const optionsRef = useRef<(HTMLDivElement | null)[]>([]);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
        setSearchQuery('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);

    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 사용 가능한 화이트리스트 항목 만들기
  const whitelistOptions = MODEL_WHITELIST.filter((item) => {
    // 해당 프로바이더가 활성화되어 있는지 확인
    const providerEnabled = providerList.some((p) => p.name === item.providerName);

    // 해당 모델이 모델 목록에 있는지 확인
    const modelExists = modelList.some((m) => m.provider === item.providerName && m.name === item.modelName);

    return providerEnabled && modelExists;
  });

  // Auto 옵션 생성 - OpenRouter의 Claude 모델을 기본값으로 사용
  const autoOption: WhitelistItem = {
    label: 'Agent8 Auto',
    providerName: 'OpenRouter',
    modelName: AUTO_MODEL_NAME, // Using special name for Auto
  };

  // 현재 선택된 화이트리스트 항목 찾기
  const selectedOption =
    model === AUTO_MODEL_NAME
      ? autoOption // Special handling for Auto model
      : model && provider
        ? MODEL_WHITELIST.find((item) => item.providerName === provider.name && item.modelName === model)
        : undefined;

  // Set default model if none is selected
  useEffect(() => {
    if (!model || !provider) {
      // Default to Auto mode
      if (setModel) {
        setModel(AUTO_MODEL_NAME);
      }

      if (setProvider) {
        const openRouterProvider = providerList.find((p) => p.name === 'OpenRouter');

        if (openRouterProvider) {
          setProvider(openRouterProvider);
        }
      }
    }
  }, [model, provider, setModel, setProvider, providerList]);

  // 검색어로 화이트리스트 항목 필터링
  const filteredOptions = whitelistOptions.filter((item) =>
    item.label.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  // Auto 옵션 추가 (검색어가 비어있거나 "auto"를 포함하는 경우만)
  const displayOptions =
    searchQuery === '' || 'auto'.includes(searchQuery.toLowerCase())
      ? [autoOption, ...filteredOptions]
      : filteredOptions;

  // Reset focused index when search query changes or dropdown opens/closes
  useEffect(() => {
    setFocusedIndex(-1);
  }, [searchQuery, isDropdownOpen]);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isDropdownOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isDropdownOpen]);

  // Handle keyboard navigation
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!isDropdownOpen) {
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setFocusedIndex((prev) => {
          const next = prev + 1;

          if (next >= displayOptions.length) {
            return 0;
          }

          return next;
        });
        break;

      case 'ArrowUp':
        e.preventDefault();
        setFocusedIndex((prev) => {
          const next = prev - 1;

          if (next < 0) {
            return displayOptions.length - 1;
          }

          return next;
        });
        break;

      case 'Enter':
        e.preventDefault();

        if (focusedIndex >= 0 && focusedIndex < displayOptions.length) {
          const selectedItem = displayOptions[focusedIndex];
          selectWhitelistItem(selectedItem);
        }

        break;

      case 'Escape':
        e.preventDefault();
        setIsDropdownOpen(false);
        setSearchQuery('');
        break;

      case 'Tab':
        if (!e.shiftKey && focusedIndex === displayOptions.length - 1) {
          setIsDropdownOpen(false);
        }

        break;
    }
  };

  // 선택한 화이트리스트 항목 적용
  const selectWhitelistItem = (item: WhitelistItem) => {
    // 해당 프로바이더 찾기
    const newProvider = providerList.find((p) => p.name === item.providerName);

    if (newProvider && setProvider) {
      setProvider(newProvider);
    }

    // 모델 설정
    if (setModel) {
      setModel(item.modelName);
    }

    setIsDropdownOpen(false);
    setSearchQuery('');
  };

  // Focus the selected option
  useEffect(() => {
    if (focusedIndex >= 0 && optionsRef.current[focusedIndex]) {
      optionsRef.current[focusedIndex]?.scrollIntoView({ block: 'nearest' });
    }
  }, [focusedIndex]);

  if (providerList.length === 0) {
    return <div className="text-bolt-elements-textSecondary text-xs">No providers enabled</div>;
  }

  if (whitelistOptions.length === 0) {
    return <div className="text-bolt-elements-textSecondary text-xs">No models available</div>;
  }

  return (
    <div className="flex items-center">
      <div className="relative" onKeyDown={handleKeyDown} ref={dropdownRef}>
        <div
          className={classNames(
            'flex items-center text-bolt-elements-textSecondary text-xs cursor-pointer hover:text-bolt-elements-textPrimary transition-colors',
            isDropdownOpen ? 'text-bolt-elements-textPrimary' : '',
          )}
          onClick={() => setIsDropdownOpen(!isDropdownOpen)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setIsDropdownOpen(!isDropdownOpen);
            }
          }}
          role="combobox"
          aria-expanded={isDropdownOpen}
          aria-controls="model-listbox"
          aria-haspopup="listbox"
          tabIndex={0}
        >
          <div className="flex p-2 justify-center items-center gap-1.5">
            <img src="/icons/Model.svg" alt="Model" />
          </div>
        </div>

        {isDropdownOpen && (
          <div
            className="absolute z-10 bottom-full mb-1 py-1 min-w-[300px] rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 shadow-lg"
            role="listbox"
            id="model-listbox"
          >
            <div className="px-2 pb-2">
              <div className="relative">
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search models..."
                  className={classNames(
                    'w-full pl-8 pr-3 py-1.5 rounded-md text-sm',
                    'bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor',
                    'text-bolt-elements-textPrimary placeholder:text-bolt-elements-textTertiary',
                    'focus:outline-none focus:ring-2 focus:ring-bolt-elements-focus',
                    'transition-all',
                  )}
                  onClick={(e) => e.stopPropagation()}
                  role="searchbox"
                  aria-label="Search models"
                />
                <div className="absolute left-2.5 top-1/2 -translate-y-1/2">
                  <span className="i-ph:magnifying-glass text-bolt-elements-textTertiary" />
                </div>
              </div>
            </div>

            <div
              className={classNames(
                'max-h-60 overflow-y-auto',
                'sm:scrollbar-none',
                '[&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar]:h-2',
                '[&::-webkit-scrollbar-thumb]:bg-bolt-elements-borderColor',
                '[&::-webkit-scrollbar-thumb]:hover:bg-bolt-elements-borderColorHover',
                '[&::-webkit-scrollbar-thumb]:rounded-full',
                '[&::-webkit-scrollbar-track]:bg-bolt-elements-background-depth-2',
                '[&::-webkit-scrollbar-track]:rounded-full',
                'sm:[&::-webkit-scrollbar]:w-1.5 sm:[&::-webkit-scrollbar]:h-1.5',
                'sm:hover:[&::-webkit-scrollbar-thumb]:bg-bolt-elements-borderColor/50',
                'sm:hover:[&::-webkit-scrollbar-thumb:hover]:bg-bolt-elements-borderColor',
                'sm:[&::-webkit-scrollbar-track]:bg-transparent',
              )}
            >
              {modelLoading === 'all' ? (
                <div className="px-3 py-2 text-sm text-bolt-elements-textTertiary">Loading...</div>
              ) : displayOptions.length === 0 ? (
                <div className="px-3 py-2 text-sm text-bolt-elements-textTertiary">No models found</div>
              ) : (
                displayOptions.map((option, index) => (
                  <div
                    ref={(el) => (optionsRef.current[index] = el)}
                    key={index}
                    role="option"
                    aria-selected={
                      (model === AUTO_MODEL_NAME && option.modelName === AUTO_MODEL_NAME) ||
                      selectedOption?.label === option.label
                    }
                    className={classNames(
                      'px-3 py-2 text-sm cursor-pointer',
                      'hover:bg-bolt-elements-background-depth-3',
                      'text-bolt-elements-textPrimary opacity-90',
                      'outline-none',
                      (model === AUTO_MODEL_NAME && option.modelName === AUTO_MODEL_NAME) ||
                        selectedOption?.label === option.label ||
                        focusedIndex === index
                        ? 'bg-[var(--color-bg-interactive-selected,rgba(17,185,210,0.20))]'
                        : undefined,
                      focusedIndex === index ? 'ring-1 ring-inset ring-bolt-elements-focus' : undefined,
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      selectWhitelistItem(option);
                    }}
                    tabIndex={focusedIndex === index ? 0 : -1}
                  >
                    {option.label}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
