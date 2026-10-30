import { useMemo, useRef } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { keymap } from '@codemirror/view';
import { Prec, type Extension } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { vscodeDark } from '@uiw/codemirror-theme-vscode';

interface Props {
  path: string;
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
}

function languageFor(path: string): Extension[] {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'ts':
      return [javascript({ typescript: true })];
    case 'tsx':
      return [javascript({ typescript: true, jsx: true })];
    case 'js':
    case 'mjs':
    case 'cjs':
      return [javascript()];
    case 'jsx':
      return [javascript({ jsx: true })];
    case 'html':
    case 'htm':
      return [html()];
    case 'css':
    case 'scss':
      return [css()];
    case 'json':
      return [json()];
    case 'md':
    case 'markdown':
      return [markdown()];
    case 'py':
      return [python()];
    default:
      return [];
  }
}

export default function CodeEditor({ path, value, onChange, onSave }: Props) {
  const saveRef = useRef(onSave);
  saveRef.current = onSave;

  const extensions = useMemo(
    () => [
      ...languageFor(path),
      Prec.highest(
        keymap.of([
          {
            key: 'Mod-s',
            preventDefault: true,
            run: () => {
              saveRef.current();
              return true;
            },
          },
        ])
      ),
    ],
    [path]
  );

  return (
    <CodeMirror
      key={path}
      value={value}
      height="100%"
      theme={vscodeDark}
      extensions={extensions}
      onChange={onChange}
      basicSetup={{ foldGutter: true, highlightActiveLine: true, autocompletion: true, tabSize: 2 }}
      className="h-full text-[13px]"
    />
  );
}
