/*
 * ============================================================================
 * 1. IMPORTS & EXTERNAL DEPENDENCIES
 * ============================================================================
 */

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
  type Extension,
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
import { memo, useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { Theme } from '~/types/theme';
import { classNames } from '~/utils/classNames';
import { debounce } from '~/utils/debounce';
import { createScopedLogger, renderLogger } from '~/utils/logger';
import { BinaryContent } from './BinaryContent';
import { getTheme, reconfigureTheme } from './cm-theme';
import { indentKeyBinding } from './indent';
import { getLanguage } from './languages';

/*
 * ============================================================================
 * 2. CONSTANTS & CONFIGURATION
 * ============================================================================
 */

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
  VIEW_UNAVAILABLE_DURING_LAYOUT: 'View became unavailable during layout operation',
  RECREATION_SUCCESS: 'EditorView successfully recreated',
  RECREATION_FAILED: 'Failed to recreate EditorView',
  LANGUAGE_LOAD_ERROR: 'Error loading language support',
  VIEW_UNAVAILABLE_AFTER_LANGUAGE: 'View no longer available after language loading',
  SCROLL_FOCUS_UNAVAILABLE: 'View not available for scroll/focus operations',
  FOCUS_FAILED: 'Failed to set focus',
  SCROLL_FAILED: 'Failed to set scroll position',
  SCROLL_RESET_FAILED: 'Failed to reset scroll position',
  AI_COMPLETION_SYNC: 'Final state synchronization',
  AI_COMPLETION_FAILED: 'Final state synchronization failed',
} as const;

/*
 * ============================================================================
 * 3. TYPE DEFINITIONS
 * ============================================================================
 */

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
  id?: unknown;
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

/*
 * ============================================================================
 * 4. CODEMIRROR STATE & EFFECTS
 * ============================================================================
 */

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

/*
 * ============================================================================
 * 5. UTILITY FUNCTIONS
 * ============================================================================
 */

// Check if editor view is available
function isViewAvailable(view: EditorView): boolean {
  return !!(view && view.dom && view.dom.isConnected);
}

// Safe dispatch execution
function safeDispatch(view: EditorView, spec: any, operation: string, recreateViewFn?: () => void): boolean {
  if (!isViewAvailable(view)) {
    logger.warn(`${EDITOR_MESSAGES.VIEW_NOT_AVAILABLE}: ${operation}`);
    recreateViewFn?.();

    return false;
  }

  try {
    view.dispatch(spec);
    return true;
  } catch (error) {
    logger.error(`Error in ${operation}, recreating view:`, error);
    recreateViewFn?.();

    return false;
  }
}

// Create common dispatchTransactions logic
function createDispatchTransactions(
  onUpdate: (update: EditorUpdate) => void,
  editorStatesRef: MutableRefObject<EditorStates | undefined>,
  docRef: MutableRefObject<EditorDocument | undefined>,
  isRecreating = false,
) {
  return function dispatchTransactions(this: EditorView, transactions: readonly Transaction[]) {
    const view = this;
    const previousSelection = view.state.selection;

    // Apply all transactions to the view
    view.update(transactions);

    const newSelection = view.state.selection;

    // Check if selection actually changed (handles edge cases with undefined selections)
    const selectionChanged =
      newSelection !== previousSelection &&
      (newSelection === undefined || previousSelection === undefined || !newSelection.eq(previousSelection));

    // Only notify of changes if we have a document and something actually changed
    if (docRef.current && (transactions.some((transaction) => transaction.docChanged) || selectionChanged)) {
      const documentChanged = transactions.some((transaction) => transaction.docChanged);
      const shouldNotify = documentChanged || !isRecreating;

      if (shouldNotify) {
        onUpdate({
          selection: view.state.selection,
          content: view.state.doc.toString(),
          filePath: docRef.current.filePath,
        });
      }

      // Save the current state for this file path
      if (editorStatesRef.current && docRef.current.filePath) {
        editorStatesRef.current.set(docRef.current.filePath, view.state);
      }
    }

    return undefined;
  };
}

// Set empty document
function setNoDocument(view: EditorView, recreateViewFn?: () => void) {
  // Clear all content and reset cursor to start
  safeDispatch(
    view,
    {
      selection: { anchor: 0 },
      changes: {
        from: 0,
        to: view.state.doc.length,
        insert: '',
      },
    },
    'clear document',
    recreateViewFn,
  );

  // Reset scroll position to top-left
  try {
    view.scrollDOM.scrollTo(0, 0);
  } catch (error) {
    logger.warn(EDITOR_MESSAGES.SCROLL_RESET_FAILED, error);
  }
}

// Set editor document
function setEditorDocument(
  view: EditorView,
  theme: Theme,
  editable: boolean,
  languageCompartment: Compartment,
  autoFocus: boolean,
  doc: TextEditorDocument,
  recreateViewFn?: () => void,
) {
  const needsContentUpdate = doc.value !== view.state.doc.toString();
  const newEditableState = editable && !doc.isBinary;

  if (needsContentUpdate) {
    safeDispatch(
      view,
      {
        selection: { anchor: 0 },
        changes: { from: 0, to: view.state.doc.length, insert: doc.value },
        effects: [editableStateEffect.of(newEditableState)],
      },
      'document and state update',
      recreateViewFn,
    );
  } else {
    safeDispatch(
      view,
      { effects: [editableStateEffect.of(newEditableState)] },
      'editable state update',
      recreateViewFn,
    );
  }

  const scheduleScrollAndFocus = () => {
    if (!isViewAvailable(view)) {
      logger.warn(EDITOR_MESSAGES.VIEW_UNAVAILABLE_LAYOUT);
      recreateViewFn?.();

      return;
    }

    // requestAnimationFrame to ensure the scroll and focus are performed after the layout is completed
    requestAnimationFrame(() => handleScrollAndFocus(view, autoFocus, editable, doc));
  };

  getLanguage(doc.filePath)
    .then((languageSupport) => {
      if (!languageSupport) {
        scheduleScrollAndFocus();
        return;
      }

      const success = safeDispatch(
        view,
        {
          effects: [languageCompartment.reconfigure([languageSupport]), reconfigureTheme(theme)],
        },
        'language configuration',
        recreateViewFn,
      );

      if (!success) {
        logger.warn('Language configuration failed');
      }

      scheduleScrollAndFocus();
    })
    .catch((error) => {
      logger.error(EDITOR_MESSAGES.LANGUAGE_LOAD_ERROR, error);
      scheduleScrollAndFocus();
    });
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

/*
 * ============================================================================
 * 6. EDITOR STATE CREATION
 * ============================================================================
 */

// Create new editor state with extensions
function newEditorState(
  content: string,
  theme: Theme,
  settings: EditorSettings | undefined,
  onScrollRef: MutableRefObject<OnScrollCallback | undefined>,
  debounceScroll: number,
  onFileSaveRef: MutableRefObject<OnSaveCallback | undefined>,
  extensions: Extension[],
) {
  return EditorState.create({
    doc: content,
    extensions: [
      EditorView.domEventHandlers({
        scroll: debounce((event, view) => {
          if (event.target !== view.scrollDOM) {
            return;
          }

          onScrollRef.current?.({ left: view.scrollDOM.scrollLeft, top: view.scrollDOM.scrollTop });
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
            onFileSaveRef.current?.();
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
      ...extensions,
    ],
  });
}

/*
 * ============================================================================
 * 7. MAIN COMPONENT
 * ============================================================================
 */

export const CodeMirrorEditor = memo(
  ({
    id,
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
    const viewRef = useRef<EditorView>();
    const docRef = useRef<EditorDocument>();
    const editorStatesRef = useRef<EditorStates>();
    const onScrollRef = useRef(onScroll);
    const onChangeRef = useRef(onChange);
    const onSaveRef = useRef(onSave);

    // Track previous editable state for AI completion detection
    const prevEditableRef = useRef<boolean>(editable);

    // Track previous file path to detect file changes
    const prevFilePathRef = useRef<string | undefined>();

    // EditorView recreation function (infinite recursion prevention)
    const recreateEditorView = (() => {
      let isRecreating = false;

      return () => {
        if (isRecreating || !viewRef.current || !containerRef.current) {
          logger.warn(EDITOR_MESSAGES.RECREATION_SKIPPED);
          return;
        }

        isRecreating = true;
        logger.info('Starting EditorView recreation');

        try {
          // Backup current state
          const currentDoc = viewRef.current.state.doc.toString();
          const scrollPos = {
            left: viewRef.current.scrollDOM?.scrollLeft || 0,
            top: viewRef.current.scrollDOM?.scrollTop || 0,
          };
          const selection = viewRef.current.state.selection;

          // Clean up existing view
          viewRef.current.destroy();

          // Create new view
          const onUpdate = debounce((update: EditorUpdate) => {
            onChangeRef.current?.(update);
          }, debounceChange);

          const newView = new EditorView({
            parent: containerRef.current,
            dispatchTransactions: createDispatchTransactions(onUpdate, editorStatesRef, docRef, true),
          });

          // Restore state
          if (currentDoc) {
            const state = newEditorState(currentDoc, theme, settings, onScrollRef, debounceScroll, onSaveRef, [
              languageCompartment.of([]),
            ]);
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

          viewRef.current = newView;
          logger.info(EDITOR_MESSAGES.RECREATION_SUCCESS);
        } catch (error) {
          logger.error(EDITOR_MESSAGES.RECREATION_FAILED, error);

          // Fallback: create minimal working view
          if (containerRef.current) {
            const state = newEditorState('', theme, settings, onScrollRef, debounceScroll, onSaveRef, [
              languageCompartment.of([]),
            ]);
            const fallbackView = new EditorView({
              parent: containerRef.current,
              state,
              dispatchTransactions: createDispatchTransactions(() => undefined, editorStatesRef, docRef, true),
            });
            viewRef.current = fallbackView;
          }
        } finally {
          isRecreating = false;
        }
      };
    })();

    // Update callback references on every render
    useEffect(() => {
      onScrollRef.current = onScroll;
      onChangeRef.current = onChange;
      onSaveRef.current = onSave;
      docRef.current = doc;
    });

    // AI completion detection and final state synchronization
    useEffect(() => {
      // Detect AI streaming completion (editable: false → true)
      if (!prevEditableRef.current && editable && doc?.value && viewRef.current) {
        // Use existing safeDispatch for safety and consistency
        const success = safeDispatch(
          viewRef.current,
          {
            changes: {
              from: 0,
              to: viewRef.current.state.doc.length,
              insert: doc.value,
            },
            selection: { anchor: doc.value.length }, // Move cursor to end of file
            annotations: [Transaction.addToHistory.of(false)], // Don't add to undo history
          },
          EDITOR_MESSAGES.AI_COMPLETION_SYNC,
          recreateEditorView,
        );

        if (success) {
          logger.info(EDITOR_MESSAGES.AI_COMPLETION_SYNC);
        } else {
          logger.warn(EDITOR_MESSAGES.AI_COMPLETION_FAILED);
        }
      }

      // Update previous editable state
      prevEditableRef.current = editable;
    }, [editable]);

    // Initialize CodeMirror editor view (mount only)
    useEffect(() => {
      const onUpdate = debounce((update: EditorUpdate) => {
        onChangeRef.current?.(update);
      }, debounceChange);

      const view = new EditorView({
        parent: containerRef.current!,
        dispatchTransactions: createDispatchTransactions(onUpdate, editorStatesRef, docRef, false),
      });

      viewRef.current = view;

      // Cleanup on unmount
      return () => {
        viewRef.current?.destroy();
        viewRef.current = undefined;
      };
    }, []);

    // Handle theme changes
    useEffect(() => {
      if (!viewRef.current) {
        return;
      }

      safeDispatch(
        viewRef.current,
        {
          effects: [reconfigureTheme(theme)],
        },
        'theme reconfiguration',
        recreateEditorView,
      );
    }, [theme]);

    // Reset editor states on ID change
    useEffect(() => {
      editorStatesRef.current = new Map<string, EditorState>();
    }, [id]);

    // Handle document changes and loading
    useEffect(() => {
      const editorStates = editorStatesRef.current;
      const view = viewRef.current;

      if (!view || !editorStates) {
        return;
      }

      // Skip during IME composition (CJK languages)
      if (view.composing) {
        return;
      }

      // Handle no document case
      if (!doc) {
        const state = newEditorState('', theme, settings, onScrollRef, debounceScroll, onSaveRef, [
          languageCompartment.of([]),
        ]);
        view.setState(state);
        setNoDocument(view, recreateEditorView);
        prevFilePathRef.current = undefined;

        return;
      }

      // Skip binary files
      if (doc.isBinary) {
        return;
      }

      // Warn about empty file paths (affects language detection)
      if (doc.filePath === '') {
        logger.warn(EDITOR_MESSAGES.EMPTY_FILE_PATH);
      }

      // Detect file change
      const isFileChanged = prevFilePathRef.current !== doc.filePath;

      // Get or create editor state for this file
      let state = editorStates.get(doc.filePath);

      if (!state) {
        state = newEditorState(doc.value, theme, settings, onScrollRef, debounceScroll, onSaveRef, [
          languageCompartment.of([]),
        ]);
        editorStates.set(doc.filePath, state);
      }

      if (isFileChanged) {
        view.setState(state);
      }

      prevFilePathRef.current = doc.filePath;

      setEditorDocument(
        view,
        theme,
        editable,
        languageCompartment,
        autoFocusOnDocumentChange,
        doc as TextEditorDocument,
        recreateEditorView,
      );
    }, [doc?.value, doc?.filePath, editable]);

    // Render

    return (
      <div className={classNames('relative h-full', className)}>
        {doc?.isBinary && <BinaryContent />}
        <div className="h-full overflow-hidden" ref={containerRef} />
      </div>
    );
  },
);

/*
 * ============================================================================
 * 8. COMPONENT EXPORT & DISPLAY NAME
 * ============================================================================
 */

export default CodeMirrorEditor;

CodeMirrorEditor.displayName = 'CodeMirrorEditor';
