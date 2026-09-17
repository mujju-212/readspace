import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useWorkspace } from '../stores/workspace';
import { useTabs } from '../stores/tabs';
import { rendererForExt } from '../services/fs/types';
import { FileIcon } from './Icons';

/**
 * Quick open (FR-51): fuzzy subsequence match over the workspace file list.
 */
export function QuickOpen({ onClose }: { onClose: () => void }) {
  const walkAll = useWorkspace((s) => s.walkAll);
  const openPath = useTabs((s) => s.openPath);
  const [query, setQuery] = useState('');
  const [files, setFiles] = useState<Array<{ path: string; ext?: string }> | null>(null);
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    void walkAll().then(setFiles);
  }, [walkAll]);

  const results = useMemo(() => {
    if (!files) return [];
    if (!query) return files.slice(0, 12);
    const q = query.toLowerCase();
    return files
      .map((f) => ({ f, score: fuzzyScore(f.path.toLowerCase(), q) }))
      .filter((r) => r.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map((r) => r.f);
  }, [files, query]);

  useEffect(() => setIndex(0), [query]);

  const choose = (path: string, ext?: string) => {
    openPath(path, { ext });
    onClose();
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="quickopen" role="dialog" aria-label="Quick open" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="qo-input"
          placeholder={files === null ? 'Scanning workspace…' : 'Go to file…'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            else if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(i + 1, results.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(i - 1, 0)); }
            else if (e.key === 'Enter' && results[index]) choose(results[index].path, results[index].ext);
          }}
          aria-label="File name"
        />
        <ul className="qo-list" role="listbox">
          {results.length === 0 && <li className="qo-empty muted">{files === null ? 'Loading…' : 'No matches'}</li>}
          {results.map((f, i) => (
            <li key={f.path}>
              <button
                type="button"
                role="option"
                aria-selected={i === index}
                className={`qo-item${i === index ? ' active' : ''}`}
                onMouseEnter={() => setIndex(i)}
                onClick={() => choose(f.path, f.ext)}
              >
                <FileIcon rendererId={rendererForExt(f.ext ?? '')} size={13} />
                <span className="qo-name">{f.path.split('/').pop()}</span>
                <span className="qo-dir muted">{f.path.split('/').slice(0, -1).join('/')}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="qo-foot muted">
          <span><kbd>↑↓</kbd> navigate</span>
          <span><kbd>Enter</kbd> open</span>
          <span><kbd>Esc</kbd> dismiss</span>
        </div>
      </div>
    </div>
  );
}

/** subsequence match with contiguity bonus; -1 = no match */
function fuzzyScore(s: string, q: string): number {
  let score = 0;
  let qi = 0;
  let lastHit = -2;
  for (let si = 0; si < s.length && qi < q.length; si++) {
    if (s[si] === q[qi]) {
      score += si === lastHit + 1 ? 3 : 1;
      if (si === 0 || s[si - 1] === '/') score += 2;
      lastHit = si;
      qi++;
    }
  }
  return qi === q.length ? score : -1;
}
