import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { yaml } from '@codemirror/lang-yaml';
import { bracketMatching, defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import {
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder as cmPlaceholder,
} from '@codemirror/view';
import { useEffect, useRef } from 'react';
import { cn } from '../../lib/cn';

type CodeMirrorEditorProps = {
  value: string;
  onChange?: (nextValue: string) => void;
  readOnly?: boolean;
  language?: 'yaml' | 'text';
  placeholder?: string;
  minHeight?: string;
  maxHeight?: string;
  className?: string;
  testId?: string;
  ariaLabel?: string;
};

const mikuEditorTheme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--bg)',
    color: 'var(--text)',
    fontSize: '12px',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--border)',
    overflow: 'hidden',
  },
  '&.cm-focused': {
    outline: '2px solid var(--primary)',
    outlineOffset: '-1px',
  },
  '.cm-scroller': {
    overflow: 'auto',
    lineHeight: '1.55',
  },
  '.cm-content': {
    padding: '10px 0',
    caretColor: 'var(--primary)',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--surface)',
    color: 'var(--text-muted)',
    borderRight: '1px solid var(--border)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'var(--surface-muted)',
    color: 'var(--text)',
  },
  '.cm-activeLine': {
    backgroundColor: 'color-mix(in srgb, var(--primary) 8%, transparent)',
  },
  '.cm-selectionBackground, ::selection': {
    backgroundColor: 'color-mix(in srgb, var(--primary) 26%, transparent) !important',
  },
  '.cm-cursor': {
    borderLeftColor: 'var(--primary)',
  },
  '.cm-placeholder': {
    color: 'var(--text-muted)',
  },
});

export function CodeMirrorEditor({
  value,
  onChange,
  readOnly = false,
  language = 'yaml',
  placeholder,
  minHeight = '220px',
  maxHeight = '480px',
  className,
  testId,
  ariaLabel,
}: CodeMirrorEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const readOnlyCompartment = useRef(new Compartment());
  const languageCompartment = useRef(new Compartment());

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const extensions: Extension[] = [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      bracketMatching(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      mikuEditorTheme,
      EditorView.theme({
        '.cm-scroller': {
          minHeight,
          maxHeight,
        },
      }),
      EditorView.contentAttributes.of(ariaLabel ? { 'aria-label': ariaLabel } : {}),
      readOnlyCompartment.current.of([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
      languageCompartment.current.of(language === 'yaml' ? yaml() : []),
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && onChangeRef.current) {
          onChangeRef.current(update.state.doc.toString());
        }
      }),
    ];

    if (placeholder) {
      extensions.push(cmPlaceholder(placeholder));
    }

    const state = EditorState.create({
      doc: value,
      extensions,
    });
    const view = new EditorView({ state, parent: container });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Mount once per editor instance; dynamic props sync via compartments below.
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: readOnlyCompartment.current.reconfigure([
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
      ]),
    });
  }, [readOnly]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: languageCompartment.current.reconfigure(language === 'yaml' ? yaml() : []),
    });
  }, [language]);

  return <div ref={containerRef} data-testid={testId} className={cn('w-full min-w-0', className)} />;
}
