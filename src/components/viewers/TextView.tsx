import React, { useMemo, useState } from 'react';
import hljs from 'highlight.js/lib/common';
import { Wrap } from '../Icons';

const EXT_TO_LANG: Record<string, { lang: string; label: string }> = {
  js: { lang: 'javascript', label: 'JavaScript' },
  mjs: { lang: 'javascript', label: 'JavaScript' },
  cjs: { lang: 'javascript', label: 'JavaScript' },
  jsx: { lang: 'javascript', label: 'JavaScript React' },
  ts: { lang: 'typescript', label: 'TypeScript' },
  mts: { lang: 'typescript', label: 'TypeScript' },
  cts: { lang: 'typescript', label: 'TypeScript' },
  tsx: { lang: 'typescript', label: 'TypeScript React' },
  py: { lang: 'python', label: 'Python' },
  pyw: { lang: 'python', label: 'Python' },
  r: { lang: 'r', label: 'R' },
  c: { lang: 'c', label: 'C' },
  h: { lang: 'c', label: 'C Header' },
  cpp: { lang: 'cpp', label: 'C++' },
  hpp: { lang: 'cpp', label: 'C++ Header' },
  cc: { lang: 'cpp', label: 'C++' },
  cxx: { lang: 'cpp', label: 'C++' },
  cs: { lang: 'csharp', label: 'C#' },
  java: { lang: 'java', label: 'Java' },
  go: { lang: 'go', label: 'Go' },
  rs: { lang: 'rust', label: 'Rust' },
  swift: { lang: 'swift', label: 'Swift' },
  kt: { lang: 'kotlin', label: 'Kotlin' },
  kts: { lang: 'kotlin', label: 'Kotlin Script' },
  dart: { lang: 'dart', label: 'Dart' },
  scala: { lang: 'scala', label: 'Scala' },
  php: { lang: 'php', label: 'PHP' },
  rb: { lang: 'ruby', label: 'Ruby' },
  lua: { lang: 'lua', label: 'Lua' },
  sh: { lang: 'bash', label: 'Shell' },
  bash: { lang: 'bash', label: 'Bash' },
  zsh: { lang: 'bash', label: 'Zsh' },
  fish: { lang: 'bash', label: 'Fish' },
  ps1: { lang: 'powershell', label: 'PowerShell' },
  psm1: { lang: 'powershell', label: 'PowerShell' },
  bat: { lang: 'cmd', label: 'Batch' },
  cmd: { lang: 'cmd', label: 'Command' },
  sql: { lang: 'sql', label: 'SQL' },
  json: { lang: 'json', label: 'JSON' },
  jsonc: { lang: 'json', label: 'JSON with Comments' },
  yml: { lang: 'yaml', label: 'YAML' },
  yaml: { lang: 'yaml', label: 'YAML' },
  toml: { lang: 'ini', label: 'TOML' },
  ini: { lang: 'ini', label: 'INI' },
  conf: { lang: 'ini', label: 'Config' },
  env: { lang: 'ini', label: 'Env' },
  properties: { lang: 'ini', label: 'Properties' },
  dockerfile: { lang: 'dockerfile', label: 'Dockerfile' },
  makefile: { lang: 'makefile', label: 'Makefile' },
  gitignore: { lang: 'ini', label: 'Git Ignore' },
  xml: { lang: 'xml', label: 'XML' },
  css: { lang: 'css', label: 'CSS' },
  scss: { lang: 'scss', label: 'SCSS' },
  sass: { lang: 'scss', label: 'Sass' },
  less: { lang: 'less', label: 'Less' },
  diff: { lang: 'diff', label: 'Diff' },
  patch: { lang: 'diff', label: 'Patch' },
};

/** Copy arbitrary text using the Clipboard API with a textarea fallback. */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  // 1. Modern asynchronous Clipboard API (secure contexts / localhost)
  if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // If permission denied or document not focused, fall through to fallback
    }
  }

  // 2. Legacy execCommand('copy') fallback for HTTP / non-secure contexts and older browsers
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.contain = 'strict';
    ta.style.position = 'absolute';
    ta.style.left = '-9999px';
    ta.style.top = '0';
    ta.style.width = '1px';
    ta.style.height = '1px';
    ta.style.padding = '0';
    ta.style.border = 'none';
    ta.style.outline = 'none';
    ta.style.fontSize = '12pt';
    document.body.appendChild(ta);

    const selection = document.getSelection();
    const originalRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

    ta.focus({ preventScroll: true });
    ta.select();
    ta.setSelectionRange(0, text.length);

    const ok = document.execCommand('copy');
    document.body.removeChild(ta);

    if (selection && originalRange) {
      selection.removeAllRanges();
      selection.addRange(originalRange);
    }
    return ok;
  } catch {
    return false;
  }
}

/** Text and code viewer with syntax highlighting (FR-27): wrap toggle + big-file guard. */
export default function TextView({ text, ext }: { text: string; ext?: string }) {
  const [wrap, setWrap] = useState(true);
  const [copied, setCopied] = useState(false);
  const big = text.length > 2_000_000;

  const info = ext ? EXT_TO_LANG[ext.toLowerCase()] : undefined;
  const isCode = Boolean(info);
  const langLabel = info?.label ?? (ext ? ext.toUpperCase() : 'Plain Text');

  const highlightedHtml = useMemo(() => {
    if (big || text.length > 500_000) return null;
    try {
      if (info?.lang && hljs.getLanguage(info.lang)) {
        return hljs.highlight(text, { language: info.lang, ignoreIllegals: true }).value;
      }
      if (isCode) {
        return hljs.highlightAuto(text).value;
      }
    } catch {
      // fallback to plain text rendering
    }
    return null;
  }, [text, info?.lang, isCode, big]);

  return (
    <div className="text-view">
      <div className="text-toolbar">
        <span className="muted">
          {text.split('\n').length.toLocaleString()} lines · {big ? 'large file' : `${(new Blob([text]).size / 1024).toFixed(1)} KB`} · {langLabel}
        </span>
        <button
          type="button"
          className={`btn btn-ghost${wrap ? ' on' : ''}`}
          onClick={() => setWrap((w) => !w)}
          title="Toggle word wrap"
        >
          <Wrap size={13} /> Wrap
        </button>
        {!big && (
          <button
            type="button"
            className="btn btn-ghost"
            title="Copy full text"
            onClick={async () => {
              const ok = await copyTextToClipboard(text);
              setCopied(ok);
              if (ok) setTimeout(() => setCopied(false), 1600);
            }}
          >
            {copied ? 'Copied!' : 'Copy text'}
          </button>
        )}
      </div>
      <div className="reader text-body">
        {highlightedHtml ? (
          <pre
            className="hljs"
            style={{ whiteSpace: wrap ? 'pre-wrap' : 'pre', overflowWrap: wrap ? 'anywhere' : 'normal' }}
            dangerouslySetInnerHTML={{ __html: highlightedHtml }}
          />
        ) : (
          <pre style={{ whiteSpace: wrap ? 'pre-wrap' : 'pre', overflowWrap: wrap ? 'anywhere' : 'normal' }}>
            {text}
          </pre>
        )}
      </div>
    </div>
  );
}
