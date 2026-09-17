import React, { useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { html } from '@codemirror/lang-html';
import { resolvedTheme, useSettings } from '../../stores/settings';

/** CodeMirror 6 editor used for Edit mode (FR-31) — lazy-loaded. */
export default function CodeEditor({
  value,
  onChange,
  lang,
}: {
  value: string;
  onChange: (v: string) => void;
  lang: string;
}) {
  const theme = useSettings((s) => s.theme);
  const extensions = useMemo(
    () => (lang === 'markdown' ? [markdown()] : lang === 'html' ? [html()] : []),
    [lang],
  );
  return (
    <div className="cm-wrap" style={{ height: '100%', width: '100%', minHeight: 0, flex: 1, display: 'flex', flexDirection: 'column' }}>
      <CodeMirror
        value={value}
        onChange={onChange}
        extensions={extensions}
        theme={resolvedTheme(theme) === 'dark' ? 'dark' : 'light'}
        height="100%"
        style={{ height: '100%', width: '100%', minHeight: 0, flex: 1, display: 'flex', flexDirection: 'column' }}
        basicSetup={{ foldGutter: false, highlightActiveLine: true, autocompletion: false }}
      />
    </div>
  );
}
