import { globSync } from 'fast-glob';
import fs from 'node:fs/promises';
import { basename } from 'node:path';
import { defineConfig, presetIcons, presetUno, transformerDirectives } from 'unocss';

const iconPaths = globSync('./icons/*.svg');

const collectionName = 'bolt';

const customIconCollection = iconPaths.reduce(
  (acc, iconPath) => {
    const [iconName] = basename(iconPath).split('.');

    acc[collectionName] ??= {};
    acc[collectionName][iconName] = async () => fs.readFile(iconPath, 'utf8');

    return acc;
  },
  {} as Record<string, Record<string, () => Promise<string>>>,
);

const BASE_COLORS = {
  white: '#FFFFFF',
  gray: {
    50: '#FAFAFA',
    100: '#F5F5F5',
    200: '#E5E5E5',
    300: '#D4D4D4',
    400: '#A3A3A3',
    500: '#737373',
    600: '#525252',
    700: '#404040',
    800: '#262626',
    900: '#171717',
    950: '#0A0A0A',
  },
  accent: {
    25: '#d5f7fb',
    50: '#BBF4FC',
    100: '#9EEEF9',
    200: '#72E7F8',
    300: '#47D5EB',
    400: '#11B9D2',
    500: '#1a92a4',
    600: '#1a7583',
    700: '#1b5862',
    800: '#11434a',
    900: '#163337',
    950: '#16292b',
  },
  green: {
    50: '#F0FDF4',
    100: '#DCFCE7',
    200: '#BBF7D0',
    300: '#86EFAC',
    400: '#4ADE80',
    500: '#22C55E',
    600: '#16A34A',
    700: '#15803D',
    800: '#166534',
    900: '#14532D',
    950: '#052E16',
  },
  orange: {
    50: '#FFFAEB',
    100: '#FEEFC7',
    200: '#FEDF89',
    300: '#FEC84B',
    400: '#FDB022',
    500: '#F79009',
    600: '#DC6803',
    700: '#B54708',
    800: '#93370D',
    900: '#792E0D',
  },
  red: {
    50: '#FEF2F2',
    100: '#FEE2E2',
    200: '#FECACA',
    300: '#FCA5A5',
    400: '#F87171',
    500: '#EF4444',
    600: '#DC2626',
    700: '#B91C1C',
    800: '#991B1B',
    900: '#7F1D1D',
    950: '#450A0A',
  },
};

const COLOR_PRIMITIVES = {
  ...BASE_COLORS,
  alpha: {
    white: generateAlphaPalette(BASE_COLORS.white),
    gray: generateAlphaPalette(BASE_COLORS.gray[900]),
    red: generateAlphaPalette(BASE_COLORS.red[500]),
    accent: generateAlphaPalette(BASE_COLORS.accent[500]),
  },
};

export default defineConfig({
  safelist: [
    ...Object.keys(customIconCollection[collectionName] || {}).map((x) => `i-bolt:${x}`),
    'font-feature-stylistic',
    'text-bolt-color-textTertiary',
    'text-bolt-color-textPrimary',
    'placeholder-bolt-color-textTertiary',

    // Typography Design System
    'text-heading-2xs',
    'text-heading-xs',
    'text-heading-sm',
    'text-heading-md',
    'text-heading-lg',
    'text-heading-xl',
    'text-heading-2xl',
    'text-heading-3xl',
    'text-heading-4xl',
    'text-heading-5xl',
    'text-heading-6xl',
    'text-body-sm',
    'text-body-md-regular',
    'text-body-md-medium',
    'text-body-lg-regular',
    'text-body-lg-medium',
    'text-subtle',
    'border-tertiary',
    'animate-shine',
    'bg-interactive-primary',
    'hover:bg-interactive-primary-hovered',
    'active:bg-interactive-primary-pressed',
    'text-elevation-shadow-3',
  ],
  shortcuts: {
    'bolt-ease-cubic-bezier': 'ease-[cubic-bezier(0.4,0,0.2,1)]',
    'transition-theme': 'transition-[background-color,border-color,color] duration-150 bolt-ease-cubic-bezier',
    kdb: 'bg-bolt-elements-code-background text-bolt-elements-code-text py-1 px-1.5 rounded-md',
    'max-w-chat': 'max-w-[var(--chat-max-width)]',
    'max-w-chat-before-start': 'max-w-[var(--chat-max-width-before-start)]',
    'bg-primary': 'bg-[var(--color-bg-primary,#111315)]',
    'text-primary': 'text-bolt-color-textPrimary',
    'text-secondary': 'text-bolt-color-textSecondary',
    'text-tertiary': 'text-bolt-color-textTertiary',
    'text-subtle': 'text-[var(--color-text-subtle)]',
    'text-disabled': 'text-[var(--color-text-disabled)]',

    // Typography Design System
    'text-heading-2xs': 'font-primary text-[12px] font-semibold leading-[133.4%] not-italic',
    'text-heading-xs': 'font-primary text-[14px] font-semibold leading-[142.9%] not-italic',
    'text-heading-sm': 'font-primary text-[16px] font-semibold leading-[150%] not-italic',
    'text-heading-md': 'font-primary text-[20px] font-semibold leading-[140%] not-italic',
    'text-heading-lg': 'font-primary text-[24px] font-semibold leading-[133.4%] not-italic',
    'text-heading-xl': 'font-primary text-[28px] font-semibold leading-[135.8%] not-italic',
    'text-heading-2xl': 'font-primary text-[36px] font-semibold leading-[133.4%] not-italic',
    'text-heading-3xl': 'font-primary text-[40px] font-semibold leading-[130%] not-italic',
    'text-heading-4xl': 'font-primary text-[48px] font-semibold leading-[129%] not-italic',
    'text-heading-5xl': 'font-primary text-[56px] font-semibold leading-[125%] not-italic',
    'text-heading-6xl': 'font-primary text-[64px] font-semibold leading-[125%] not-italic',

    // Body Typography
    'text-body-sm': 'font-primary text-[12px] font-normal leading-[133.4%] not-italic',
    'text-body-md-regular': 'font-primary text-[14px] font-normal leading-[142.9%] not-italic',
    'text-body-md-medium': 'font-primary text-[14px] font-medium leading-[142.9%] not-italic',
    'text-body-lg-regular': 'font-primary text-[16px] font-normal leading-[150%] not-italic',
    'text-body-lg-medium': 'font-primary text-[16px] font-medium leading-[150%] not-italic',

    'text-accent-primary': 'text-[var(--color-text-accent-primary)]',
    'text-interactive-neutral': 'text-[var(--color-text-interactive-neutral)]',
    'text-interactive-primary': 'text-[var(--color-text-interactive-primary)]',
    'text-interactive-on-primary': 'text-[var(--color-text-interactive-on-primary)]',
    'text-interactive-on-primary-hovered': 'text-[var(--color-text-interactive-on-primary-hovered)]',
    'text-interactive-on-primary-pressed': 'text-[var(--color-text-interactive-on-primary-pressed)]',
    'bg-interactive-neutral': 'bg-[var(--color-bg-interactive-neutral)]',
    'bg-interactive-neutral-hovered': 'bg-[var(--color-bg-interactive-neutral-hovered)]',
    'bg-interactive-neutral-pressed': 'bg-[var(--color-bg-interactive-neutral-pressed)]',
    'border-interactive-neutral': 'border-[var(--color-border-interactive-neutral)]',
    'hover:border-interactive-neutral-hovered': 'hover:border-[var(--color-border-interactive-neutral-hovered)]',
    'active:border-interactive-neutral-pressed': 'active:border-[var(--color-border-interactive-neutral-pressed)]',
    'border-disabled': 'disabled:border-[var(--color-border-disabled)]',
    'border-primary': 'border-[var(--color-border-primary)]',
    'border-secondary': 'border-[var(--color-border-secondary,rgba(255,255,255,0.22))]',
    'border-tertiary': 'border-[var(--color-border-tertiary)]',
    'bg-disabled': 'disabled:bg-[var(--color-bg-disabled)]',
    'bg-interactive-gradient':
      'bg-[linear-gradient(90deg,var(--color-bg-interactive-gradient-start)_0%,var(--color-bg-interactive-gradient-end)_100%)]',
    'hover:bg-interactive-gradient-hovered':
      'hover:bg-[linear-gradient(90deg,var(--color-bg-interactive-gradient-start)_0%,var(--color-bg-interactive-gradient-end-hovered)_100%)]',
    'active:bg-interactive-gradient-pressed':
      'active:bg-[linear-gradient(90deg,var(--color-bg-interactive-gradient-start)_0%,var(--color-bg-interactive-gradient-end-pressed)_100%)]',
    'bg-interactive-primary': 'bg-[var(--color-bg-interactive-primary,#1a92a4)]',
    'hover:bg-interactive-primary-hovered': 'hover:bg-[var(--color-bg-interactive-primary-hovered,#1a7583)]',
    'active:bg-interactive-primary-pressed': 'active:bg-[var(--color-bg-interactive-primary-pressed,#1b5862)]',
    'rounded-radius-4': 'rounded-[var(--border-radius-4)]',
    'rounded-radius-8': 'rounded-[var(--border-radius-8)]',
    'border-width-1': 'border-[var(--border-width-1)]',
    'spacing-6': 'gap-[var(--spacing-6)]',
    'spacing-10': 'p-[var(--spacing-10)]',
    'spacing-14': 'px-[var(--spacing-14)]',
    'py-spacing-20': 'py-[var(--spacing-20,20px)]',
    'px-spacing-8': 'px-[var(--spacing-8,8px)]',
    'gap-spacing-8': 'gap-[var(--spacing-8,8px)]',
    'elevation-light-3': 'shadow-[0_2px_8px_2px_rgba(26,220,217,0.12),0_12px_80px_16px_rgba(148,250,239,0.20)]',

    // Gradient text with shadow effect
    'text-elevation-shadow-3':
      '[text-shadow:0_8px_16px_rgba(0,0,0,0.32),0_0_8px_rgba(0,0,0,0.28)] bg-[linear-gradient(90deg,var(--color-text-primary,#FFF)_0%,#72E7F8_100%)] bg-clip-text [-webkit-background-clip:text] [-webkit-text-fill-color:transparent]',
  },
  rules: [
    /**
     * This shorthand doesn't exist in Tailwind and we overwrite it to avoid
     * any conflicts with minified CSS classes.
     */
    ['b', {}],
  ],
  theme: {
    animation: {
      shine: 'shine 5s linear infinite',
    },
    keyframes: {
      shine: {
        '0%': { 'background-position': '100%' },
        '100%': { 'background-position': '-100%' },
      },
    },
    colors: {
      ...COLOR_PRIMITIVES,
      bolt: {
        elements: {
          borderColor: 'var(--bolt-elements-borderColor)',
          borderColorActive: 'var(--bolt-elements-borderColorActive)',
          background: {
            depth: {
              1: 'var(--bolt-elements-bg-depth-1)',
              2: 'var(--bolt-elements-bg-depth-2)',
              3: 'var(--bolt-elements-bg-depth-3)',
              4: 'var(--bolt-elements-bg-depth-4)',
            },
          },
          textPrimary: 'var(--bolt-elements-textPrimary)',
          textSecondary: 'var(--bolt-elements-textSecondary)',
          textTertiary: 'var(--bolt-elements-textTertiary)',
          code: {
            background: 'var(--bolt-elements-code-background)',
            text: 'var(--bolt-elements-code-text)',
          },
          button: {
            primary: {
              background: 'var(--bolt-elements-button-primary-background)',
              backgroundHover: 'var(--bolt-elements-button-primary-backgroundHover)',
              text: 'var(--bolt-elements-button-primary-text)',
            },
            secondary: {
              background: 'var(--bolt-elements-button-secondary-background)',
              backgroundHover: 'var(--bolt-elements-button-secondary-backgroundHover)',
              text: 'var(--bolt-elements-button-secondary-text)',
            },
            danger: {
              background: 'var(--bolt-elements-button-danger-background)',
              backgroundHover: 'var(--bolt-elements-button-danger-backgroundHover)',
              text: 'var(--bolt-elements-button-danger-text)',
            },
          },
          item: {
            contentDefault: 'var(--bolt-elements-item-contentDefault)',
            contentActive: 'var(--bolt-elements-item-contentActive)',
            contentAccent: 'var(--bolt-elements-item-contentAccent)',
            contentDanger: 'var(--bolt-elements-item-contentDanger)',
            backgroundDefault: 'var(--bolt-elements-item-backgroundDefault)',
            backgroundActive: 'var(--bolt-elements-item-backgroundActive)',
            backgroundAccent: 'var(--bolt-elements-item-backgroundAccent)',
            backgroundDanger: 'var(--bolt-elements-item-backgroundDanger)',
          },
          actions: {
            background: 'var(--bolt-elements-actions-background)',
            code: {
              background: 'var(--bolt-elements-actions-code-background)',
            },
          },
          artifacts: {
            background: 'var(--bolt-elements-artifacts-background)',
            backgroundHover: 'var(--bolt-elements-artifacts-backgroundHover)',
            borderColor: 'var(--bolt-elements-artifacts-borderColor)',
            inlineCode: {
              background: 'var(--bolt-elements-artifacts-inlineCode-background)',
              text: 'var(--bolt-elements-artifacts-inlineCode-text)',
            },
          },
          messages: {
            background: 'var(--bolt-elements-messages-background)',
            linkColor: 'var(--bolt-elements-messages-linkColor)',
            code: {
              background: 'var(--bolt-elements-messages-code-background)',
            },
            inlineCode: {
              background: 'var(--bolt-elements-messages-inlineCode-background)',
              text: 'var(--bolt-elements-messages-inlineCode-text)',
            },
          },
          icon: {
            success: 'var(--bolt-elements-icon-success)',
            error: 'var(--bolt-elements-icon-error)',
            primary: 'var(--bolt-elements-icon-primary)',
            secondary: 'var(--bolt-elements-icon-secondary)',
            tertiary: 'var(--bolt-elements-icon-tertiary)',
          },
          preview: {
            addressBar: {
              background: 'var(--bolt-elements-preview-addressBar-background)',
              backgroundHover: 'var(--bolt-elements-preview-addressBar-backgroundHover)',
              backgroundActive: 'var(--bolt-elements-preview-addressBar-backgroundActive)',
              text: 'var(--bolt-elements-preview-addressBar-text)',
              textActive: 'var(--bolt-elements-preview-addressBar-textActive)',
            },
          },
          terminals: {
            background: 'var(--bolt-elements-terminals-background)',
            buttonBackground: 'var(--bolt-elements-terminals-buttonBackground)',
          },
          dividerColor: 'var(--bolt-elements-dividerColor)',
          loader: {
            background: 'var(--bolt-elements-loader-background)',
            progress: 'var(--bolt-elements-loader-progress)',
          },
          prompt: {
            background: 'var(--bolt-elements-prompt-background)',
          },
          sidebar: {
            dropdownShadow: 'var(--bolt-elements-sidebar-dropdownShadow)',
            buttonBackgroundDefault: 'var(--bolt-elements-sidebar-buttonBackgroundDefault)',
            buttonBackgroundHover: 'var(--bolt-elements-sidebar-buttonBackgroundHover)',
            buttonText: 'var(--bolt-elements-sidebar-buttonText)',
          },
          cta: {
            background: 'var(--bolt-elements-cta-background)',
            text: 'var(--bolt-elements-cta-text)',
          },
        },
        color: {
          textPrimary: 'var(--color-text-primary)',
          textTertiary: 'var(--color-text-tertiary)',
          textSecondary: 'var(--color-text-secondary)',
        },
      },
    },
    fontFamily: {
      primary: 'var(--font-primary)',
    },
    breakpoints: {
      mobile: '360px',
      tablet: '760px',
      'tablet-wide': '960px',
      laptop: '1024px',
      'laptop-narrow': '1176px',
      'laptop-wide': '1400px',
      'laptop-sidebar': '1484px',
      desktop: '1424px',
      sm: '640px',
      md: '768px',
      lg: '1024px',
      xl: '1280px',
      '2xl': '1536px',
    },
  },
  transformers: [transformerDirectives()],
  presets: [
    presetUno({
      dark: {
        light: '[data-theme="light"]',
        dark: '[data-theme="dark"]',
      },
    }),
    presetIcons({
      warn: true,
      collections: {
        ...customIconCollection,
      },
      unit: 'em',
    }),
  ],
});

/**
 * Generates an alpha palette for a given hex color.
 *
 * @param hex - The hex color code (without alpha) to generate the palette from.
 * @returns An object where keys are opacity percentages and values are hex colors with alpha.
 *
 * Example:
 *
 * ```
 * {
 *   '1': '#FFFFFF03',
 *   '2': '#FFFFFF05',
 *   '3': '#FFFFFF08',
 * }
 * ```
 */
function generateAlphaPalette(hex: string) {
  return [1, 2, 3, 4, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].reduce(
    (acc, opacity) => {
      const alpha = Math.round((opacity / 100) * 255)
        .toString(16)
        .padStart(2, '0');

      acc[opacity] = `${hex}${alpha}`;

      return acc;
    },
    {} as Record<number, string>,
  );
}
