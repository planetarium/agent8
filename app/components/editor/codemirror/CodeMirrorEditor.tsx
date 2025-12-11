import { acceptCompletion, autocompletion, closeBrackets } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { bracketMatching, foldGutter, indentOnInput, indentUnit } from '@codemirror/language';
import { searchKeymap } from '@codemirror/search';
import {
  Compartment,
  EditorSelection,
  EditorState,
  StateEffect,
  StateField,
  Transaction,
  type TransactionSpec,
} from '@codemirror/state';
import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  showTooltip,
  tooltips,
  type Tooltip,
} from '@codemirror/view';
import { memo, useEffect, useRef, useState, type RefObject } from 'react';
import type { Theme } from '~/types/theme';
import { classNames } from '~/utils/classNames';
import { debounce } from '~/utils/debounce';
import { createScopedLogger, renderLogger } from '~/utils/logger';
import { BinaryContent } from './BinaryContent';
import { getTheme, reconfigureTheme } from './cm-theme';
import { indentKeyBinding } from './indent';
import { getLanguage } from './languages';

const logger = createScopedLogger('CodeMirrorEditor');

// Editor default values to eliminate magic numbers
const EDITOR_DEFAULTS = {
  DEBOUNCE_SCROLL: 100,
  DEBOUNCE_CHANGE: 150,
  DEFAULT_TAB_SIZE: 2,
  TOOLTIP_OFFSET_TOP: 50,
  TOOLTIP_OFFSET_RIGHT: 10,
} as const;

// Editor message constants
const EDITOR_MESSAGES = {
  READONLY_TOOLTIP: 'Cannot edit file while AI response is being generated',
  EMPTY_FILE_PATH: 'File path should not be empty',
  VIEW_NOT_AVAILABLE: 'View not available for operation, recreating view',
  RECREATION_SKIPPED: 'Skipping recreation: already in progress or view not available',
  VIEW_UNAVAILABLE_LAYOUT: 'View not available for layout operation, recreating view',
  RECREATION_SUCCESS: 'EditorView successfully recreated',
  RECREATION_FAILED: 'Failed to recreate EditorView',
  LANGUAGE_LOAD_ERROR: 'Error loading language support',
  FOCUS_FAILED: 'Failed to set focus',
  SCROLL_FAILED: 'Failed to set scroll position',
  AI_COMPLETION_SYNC: 'Final state synchronization',
  AI_COMPLETION_FAILED: 'Final state synchronization failed',
} as const;

export interface EditorDocument {
  value: string;
  isBinary: boolean;
  filePath: string;
  scroll?: ScrollPosition;
}

export interface EditorSettings {
  fontSize?: string;
  gutterFontSize?: string;
  tabSize?: number;
}

export interface ScrollPosition {
  top: number;
  left: number;
}

export interface EditorUpdate {
  selection: EditorSelection;
  content: string;
  filePath: string;
}

export type OnChangeCallback = (update: EditorUpdate) => void;
export type OnScrollCallback = (position: ScrollPosition) => void;
export type OnSaveCallback = () => void;

interface CodeMirrorEditorProps {
  theme: Theme;
  doc?: EditorDocument;
  editable?: boolean;
  debounceChange?: number;
  debounceScroll?: number;
  autoFocusOnDocumentChange?: boolean;
  onChange?: OnChangeCallback;
  onScroll?: OnScrollCallback;
  onSave?: OnSaveCallback;
  className?: string;
  settings?: EditorSettings;
}

type TextEditorDocument = EditorDocument & { value: string };
type EditorStates = Map<string, EditorState>;

const readOnlyTooltipStateEffect = StateEffect.define<boolean>();
const editableStateEffect = StateEffect.define<boolean>();

// State field managing tooltips for read-only editor
const editableTooltipField = StateField.define<readonly Tooltip[]>({
  create: () => [],

  update(_tooltips, transaction) {
    // Hide tooltips when editor is editable
    if (!transaction.state.readOnly) {
      return [];
    }

    // Check for read-only tooltip trigger effect
    for (const effect of transaction.effects) {
      if (effect.is(readOnlyTooltipStateEffect) && effect.value) {
        return getReadOnlyTooltip(transaction.state);
      }
    }

    return [];
  },

  // Provide tooltips to the editor view
  provide: (field) => {
    return showTooltip.computeN([field], (state) => state.field(field));
  },
});

// State field managing editor editable state
const editableStateField = StateField.define<boolean>({
  create() {
    return true; // Default to editable
  },

  update(value, transaction) {
    // Check for editable state change effects
    for (const effect of transaction.effects) {
      if (effect.is(editableStateEffect)) {
        return effect.value;
      }
    }

    return value; // No change
  },
});

// Creates read-only tooltip configuration
function getReadOnlyTooltip(state: EditorState): Tooltip[] {
  if (!state.readOnly) {
    return [];
  }

  return state.selection.ranges
    .filter((range) => range.empty) // Only show for cursor positions, not selections
    .map((range) => ({
      pos: range.head,
      above: true,
      strictSide: true,
      arrow: true,
      create: () => {
        const divElement = document.createElement('div');
        divElement.className = 'cm-readonly-tooltip';
        divElement.textContent = EDITOR_MESSAGES.READONLY_TOOLTIP;

        return { dom: divElement };
      },
    }));
}

// Check if editor view is available
function isViewAvailable(view: EditorView): boolean {
  return !!(view && view.dom && view.dom.isConnected);
}

// Dispatch transaction to view (throws on failure)
function dispatchToView(view: EditorView, transaction: TransactionSpec): void {
  if (!isViewAvailable(view)) {
    throw new Error(EDITOR_MESSAGES.VIEW_NOT_AVAILABLE);
  }

  view.dispatch(transaction);
}

// Set editor document (returns false if view recreation is needed)
function setEditorDocument(
  editorViewRef: RefObject<EditorView | undefined>,
  theme: Theme,
  editable: boolean,
  languageCompartment: Compartment,
  autoFocus: boolean,
  doc: TextEditorDocument,
): boolean {
  const editorView = editorViewRef.current;

  if (!editorView) {
    return false;
  }

  const needsContentUpdate = doc.value !== editorView.state.doc.toString();
  const newEditableState = editable && !doc.isBinary;
  let transaction;

  if (needsContentUpdate) {
    transaction = {
      selection: { anchor: 0 },
      changes: { from: 0, to: editorView.state.doc.length, insert: doc.value },
      effects: [editableStateEffect.of(newEditableState)],
    };

    try {
      dispatchToView(editorView, transaction);
    } catch (error) {
      logger.warn('setEditorDocument: document and state update failed', error);
      return false;
    }
  } else {
    transaction = { effects: [editableStateEffect.of(newEditableState)] };

    try {
      dispatchToView(editorView, transaction);
    } catch (error) {
      logger.warn('setEditorDocument: editable state update failed', error);
      return false;
    }
  }

  getLanguage(doc.filePath)
    .then((languageSupport) => {
      const editorView = editorViewRef.current;

      if (!editorView) {
        return;
      }

      if (!languageSupport) {
        scheduleScrollAndFocus(editorView, autoFocus, editable, doc);
        return;
      }

      try {
        dispatchToView(editorView, {
          effects: [languageCompartment.reconfigure([languageSupport]), reconfigureTheme(theme)],
        });
      } catch (error) {
        logger.warn('setEditorDocument: language configuration failed', error);
        return;
      }

      scheduleScrollAndFocus(editorView, autoFocus, editable, doc);
    })
    .catch((error) => {
      logger.warn(EDITOR_MESSAGES.LANGUAGE_LOAD_ERROR, error);

      const editorView = editorViewRef.current;

      if (!editorView) {
        return false;
      }

      scheduleScrollAndFocus(editorView, autoFocus, editable, doc);

      return true;
    });

  return true;
}

// Schedule scroll and focus after layout
function scheduleScrollAndFocus(view: EditorView, autoFocus: boolean, editable: boolean, doc: TextEditorDocument) {
  if (!isViewAvailable(view)) {
    logger.warn(EDITOR_MESSAGES.VIEW_UNAVAILABLE_LAYOUT);

    return;
  }

  // requestAnimationFrame to ensure the scroll and focus are performed after the layout is completed
  requestAnimationFrame(() => handleScrollAndFocus(view, autoFocus, editable, doc));
}

function handleScrollAndFocus(view: EditorView, autoFocus: boolean, editable: boolean, doc: TextEditorDocument) {
  const currentLeft = view.scrollDOM.scrollLeft;
  const currentTop = view.scrollDOM.scrollTop;
  const newLeft = doc.scroll?.left ?? 0;
  const newTop = doc.scroll?.top ?? 0;
  const needsScrolling = currentLeft !== newLeft || currentTop !== newTop;

  // Handle focus management for editable editors
  if (autoFocus && editable) {
    try {
      if (needsScrolling) {
        // Focus after scroll completes to prevent scroll interruption
        view.scrollDOM.addEventListener(
          'scroll',
          () => {
            if (isViewAvailable(view)) {
              view.focus();
            }
          },
          { once: true },
        );
      } else {
        // Focus immediately if no scrolling needed
        view.focus();
      }
    } catch (error) {
      logger.warn(EDITOR_MESSAGES.FOCUS_FAILED, error);
    }
  }

  // Restore scroll position for editable editors
  if (needsScrolling && editable) {
    try {
      view.scrollDOM.scrollTo(newLeft, newTop);
    } catch (error) {
      logger.warn(EDITOR_MESSAGES.SCROLL_FAILED, error);
    }
  }
}

export const CodeMirrorEditor = memo(
  ({
    doc,
    debounceScroll = EDITOR_DEFAULTS.DEBOUNCE_SCROLL,
    debounceChange = EDITOR_DEFAULTS.DEBOUNCE_CHANGE,
    autoFocusOnDocumentChange = false,
    editable = true,
    onScroll,
    onChange,
    onSave,
    theme,
    settings,
    className = '',
  }: CodeMirrorEditorProps) => {
    renderLogger.trace('CodeMirrorEditor');

    // State and references
    const [languageCompartment] = useState(new Compartment());
    const containerRef = useRef<HTMLDivElement | null>(null);
    const editorViewRef = useRef<EditorView>();
    const editorStatesRef = useRef<EditorStates>(new Map());
    const docValueRef = useRef<string | undefined>();
    const docFilePathRef = useRef<string | undefined>();

    // Track previous editable state for AI completion detection
    const prevEditableRef = useRef<boolean>(editable);

    // Create editor state with language compartment
    const createEditorState = (content: string = '', filePath: string = '') => {
      // Create debounced onChange handler
      const debouncedOnChange = debounce(
        (update: { content: string; selection: EditorSelection; filePath: string }) => {
          onChange?.({
            content: update.content,
            selection: update.selection,
            filePath: update.filePath,
          });
        },
        debounceChange,
      );

      return EditorState.create({
        doc: content,
        extensions: [
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !update.state.readOnly) {
              debouncedOnChange?.({
                content: update.state.doc.toString(),
                selection: update.state.selection,
                filePath,
              });

              // Save the current state for this file path
              if (editorStatesRef?.current && filePath) {
                editorStatesRef.current.set(filePath, update.state);
              }
            }
          }),
          EditorView.domEventHandlers({
            scroll: debounce((event, view) => {
              if (event.target !== view.scrollDOM) {
                return;
              }

              onScroll?.({ left: view.scrollDOM.scrollLeft, top: view.scrollDOM.scrollTop });
            }, debounceScroll),
            keydown: (event, view) => {
              if (view.state.readOnly) {
                view.dispatch({
                  effects: [readOnlyTooltipStateEffect.of(event.key !== 'Escape')],
                });

                return true;
              }

              return false;
            },
          }),
          getTheme(theme, settings),
          history(),
          keymap.of([
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
            { key: 'Tab', run: acceptCompletion },
            {
              key: 'Mod-s',
              preventDefault: true,
              run: () => {
                onSave?.();
                return true;
              },
            },
            indentKeyBinding,
          ]),
          indentUnit.of('\t'),
          autocompletion({
            closeOnBlur: false,
          }),
          tooltips({
            position: 'absolute',
            parent: document.body,
            tooltipSpace: (view) => {
              const rect = view.dom.getBoundingClientRect();

              return {
                top: rect.top - EDITOR_DEFAULTS.TOOLTIP_OFFSET_TOP,
                left: rect.left,
                bottom: rect.bottom,
                right: rect.right + EDITOR_DEFAULTS.TOOLTIP_OFFSET_RIGHT,
              };
            },
          }),
          closeBrackets(),
          lineNumbers(),
          dropCursor(),
          drawSelection(),
          bracketMatching(),
          EditorState.tabSize.of(settings?.tabSize ?? EDITOR_DEFAULTS.DEFAULT_TAB_SIZE),
          indentOnInput(),
          editableTooltipField,
          editableStateField,
          EditorState.readOnly.from(editableStateField, (editable) => !editable),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          foldGutter({
            markerDOM: (open) => {
              const icon = document.createElement('div');

              icon.className = `fold-icon ${open ? 'i-ph-caret-down-bold' : 'i-ph-caret-right-bold'}`;

              return icon;
            },
          }),
          languageCompartment.of([]),
        ],
      });
    };

    // Track previous file path to detect file changes
    const prevFilePathRef = useRef<string | undefined>();

    // EditorView recreation function
    const recreateEditorView = () => {
      if (!editorViewRef.current || !containerRef.current) {
        logger.warn(EDITOR_MESSAGES.RECREATION_SKIPPED);
        return;
      }

      logger.info('Starting EditorView recreation');

      try {
        // Backup current state
        const currentDoc = editorViewRef.current.state.doc.toString();
        const scrollPos = {
          left: editorViewRef.current.scrollDOM?.scrollLeft || 0,
          top: editorViewRef.current.scrollDOM?.scrollTop || 0,
        };
        const selection = editorViewRef.current.state.selection;

        // Clean up existing view
        editorViewRef.current.destroy();

        const newView = new EditorView({
          parent: containerRef.current,
        });

        // Restore state
        if (currentDoc) {
          const state = createEditorState(currentDoc, doc?.filePath);
          newView.setState(state);

          if (selection) {
            newView.dispatch({ selection });
          }
        }

        // Restore scroll position
        requestAnimationFrame(() => {
          if (newView.scrollDOM) {
            newView.scrollDOM.scrollTo(scrollPos.left, scrollPos.top);
          }
        });

        editorViewRef.current = newView;
        logger.info(EDITOR_MESSAGES.RECREATION_SUCCESS);
      } catch (error) {
        logger.error(EDITOR_MESSAGES.RECREATION_FAILED, error);

        // Fallback: create minimal working view
        if (containerRef.current) {
          const state = createEditorState(undefined, doc?.filePath);
          const fallbackView = new EditorView({
            parent: containerRef.current,
            state,
          });
          editorViewRef.current = fallbackView;
        }
      }
    };

    // Initialize CodeMirror editor view (mount only)
    useEffect(() => {
      const view = new EditorView({
        parent: containerRef.current!,
      });

      editorViewRef.current = view;
      docValueRef.current = undefined;
      docFilePathRef.current = undefined;

      // Cleanup on unmount
      return () => {
        editorViewRef.current?.destroy();
        editorViewRef.current = undefined;
      };
    }, []);

    // AI completion detection and final state synchronization
    useEffect(() => {
      // Detect AI streaming completion (editable: false → true)
      if (!prevEditableRef.current && editable && doc?.value && editorViewRef.current) {
        const transaction: TransactionSpec = {
          changes: {
            from: 0,
            to: editorViewRef.current.state.doc.length,
            insert: doc.value,
          },
          selection: { anchor: doc.value.length }, // Move cursor to end of file
          annotations: [Transaction.addToHistory.of(false)], // Don't add to undo history.
          effects: [editableStateEffect.of(true)], // Make editor editable.
        };

        try {
          dispatchToView(editorViewRef.current, transaction);
          logger.info(EDITOR_MESSAGES.AI_COMPLETION_SYNC);
        } catch (error) {
          logger.warn(EDITOR_MESSAGES.AI_COMPLETION_FAILED, error);
          recreateEditorView();

          return;
        }
      }

      // Update previous editable state
      prevEditableRef.current = editable;
    }, [editable]);

    // Handle theme changes
    useEffect(() => {
      if (!editorViewRef.current) {
        return;
      }

      try {
        dispatchToView(editorViewRef.current, { effects: [reconfigureTheme(theme)] });
      } catch (error) {
        logger.warn('theme change failed', error);
        recreateEditorView();
      }
    }, [theme]);

    // Handle document changes and loading
    useEffect(() => {
      const editorStates = editorStatesRef.current;
      const editorView = editorViewRef.current;

      if (!editorView || !editorStates) {
        return;
      }

      // Skip during IME composition (CJK languages)
      if (editorView.composing) {
        return;
      }

      // Handle no document case
      if (!doc) {
        const state = createEditorState();
        editorView.setState(state);

        // Clear document and reset scroll
        try {
          dispatchToView(editorView, {
            selection: { anchor: 0 },
            changes: { from: 0, to: editorView.state.doc.length, insert: '' },
          });
          editorView.scrollDOM.scrollTo(0, 0);
        } catch (error) {
          logger.warn('Clear document and scroll reset failed', error);
          recreateEditorView();
        }

        prevFilePathRef.current = undefined;

        return;
      }

      // Skip binary files
      if (doc.isBinary) {
        return;
      }

      if (docValueRef.current === doc.value && docFilePathRef.current === doc.filePath) {
        return;
      }

      docValueRef.current = doc.value;
      docFilePathRef.current = doc.filePath;

      // Warn about empty file paths (affects language detection)
      if (doc.filePath === '') {
        logger.warn(EDITOR_MESSAGES.EMPTY_FILE_PATH);
      }

      prevFilePathRef.current = doc.filePath;

      // Get or create editor state for this file
      let state = editorStates.get(doc.filePath);

      if (!state) {
        state = createEditorState(doc.value, doc.filePath);
        editorStates.set(doc.filePath, state);
      }

      // Apply state and load document
      editorView.setState(state);

      const success = setEditorDocument(
        editorViewRef,
        theme,
        editable,
        languageCompartment,
        autoFocusOnDocumentChange,
        doc as TextEditorDocument,
      );

      if (!success) {
        recreateEditorView();
      }
    }, [doc, autoFocusOnDocumentChange]);

    // Render
    return (
      <div className={classNames('relative h-full', className)}>
        {doc?.isBinary && <BinaryContent />}
        <div className="h-full overflow-hidden" ref={containerRef} />
      </div>
    );
  },
);

export default CodeMirrorEditor;
