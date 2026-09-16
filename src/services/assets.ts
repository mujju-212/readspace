import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';
import { marked } from 'marked';
import type { FileSystemProvider } from './fs/types';
import { basename, dirname } from './fs/types';

/* ---------- generic helpers ---------- */

export function resolveRel(basePath: string, rel: string): string {
  // strip query/hash and leading ./ or /
  let r = rel.split('#')[0].split('?')[0];
  r = r.replace(/^\.\//, '');
  const segments = (r.startsWith('/') ? r.slice(1) : `${dirname(basePath)}/${r}`).split('/');
  const out: string[] = [];
  for (const seg of segments) {
    if (!seg || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return out.join('/');
}

export function toDataUrl(buf: ArrayBuffer, mime: string): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon',
  css: 'text/css',
};
export function mimeForExt(ext: string): string {
  return MIME[ext.toLowerCase()] ?? 'application/octet-stream';
}

export function downloadText(name: string, text: string): void {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').slice(0, 64) || 'section';
}

/* ---------- markdown pipeline (TRD §4.1) ---------- */

marked.use({ gfm: true, breaks: false });

export interface RenderedMarkdown { html: string; blobUrls: string[] }

export async function renderMarkdown(
  text: string,
  path: string,
  provider: FileSystemProvider,
): Promise<RenderedMarkdown> {
  const raw = await marked.parse(text);
  const clean = DOMPurify.sanitize(raw, { ADD_ATTR: ['target', 'id'] });

  const doc = new DOMParser().parseFromString(clean, 'text/html');
  const blobUrls: string[] = [];

  // resolve relative images through the workspace provider
  const imgs = Array.from(doc.querySelectorAll('img'));
  await Promise.all(
    imgs.map(async (img) => {
      const src = img.getAttribute('src') ?? '';
      if (!src || /^(https?:|data:|blob:)/i.test(src)) return;
      try {
        const p = resolveRel(path, decodeURI(src));
        const buf = await provider.readFile(p);
        const url = URL.createObjectURL(new Blob([buf], { type: mimeForExt(src.split('.').pop() ?? '') }));
        blobUrls.push(url);
        img.setAttribute('src', url);
      } catch {
        const fig = doc.createElement('span');
        fig.className = 'md-img-missing';
        fig.textContent = `⚠ image not found: ${src}`;
        img.replaceWith(fig);
      }
    }),
  );

  // safe links open in a new tab; internal anchors stay
  doc.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href') ?? '';
    if (/^https?:/i.test(href)) {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    }
  });

  // heading ids (for a future outline panel)
  const seen = new Map<string, number>();
  doc.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((h) => {
    let id = slugify(h.textContent ?? '');
    const n = seen.get(id) ?? 0;
    seen.set(id, n + 1);
    if (n > 0) id = `${id}-${n}`;
    h.setAttribute('id', id);
  });

  // syntax highlight fenced code blocks (works on detached DOM)
  doc.querySelectorAll('pre code').forEach((el) => {
    try { hljs.highlightElement(el as HTMLElement); } catch { /* non-highlightable */ }
  });

  return { html: doc.body.innerHTML, blobUrls };
}

/* ---------- sandboxed HTML viewer pipeline ---------- */

export interface RenderedHtml { html: string }

export async function buildSandboxedHtml(
  text: string,
  path: string,
  provider: FileSystemProvider,
  allowScripts = false,
): Promise<RenderedHtml> {
  const doc = new DOMParser().parseFromString(text, 'text/html');

  // defense in depth: the iframe is fully sandboxed either way. When scripts
  // are not explicitly allowed, strip active content as well.
  if (!allowScripts) {
    doc.querySelectorAll('script').forEach((s) => s.remove());
    doc.querySelectorAll('[onclick], [onload], [onerror]').forEach((el) => {
      for (const attr of Array.from(el.attributes)) {
        if (attr.name.toLowerCase().startsWith('on')) el.removeAttribute(attr.name);
      }
    });
  }

  // rewrite relative assets to data: URLs (blob: URLs cannot be fetched from a
  // sandboxed opaque-origin iframe, data: URLs can)
  const rewrite = async (el: Element, attr: string) => {
    const val = el.getAttribute(attr);
    if (!val || /^(https?:|data:|#)/i.test(val)) return;
    try {
      const p = resolveRel(path, decodeURI(val));
      const buf = await provider.readFile(p);
      el.setAttribute(attr, toDataUrl(buf, mimeForExt(val.split('.').pop() ?? '')));
    } catch { /* leave broken ref */ }
  };

  const jobs: Promise<void>[] = [];
  doc.querySelectorAll('img[src]').forEach((el) => jobs.push(rewrite(el, 'src')));
  doc.querySelectorAll('link[rel="stylesheet"][href], link[rel="icon"][href]').forEach((el) => jobs.push(rewrite(el, 'href')));
  doc.querySelectorAll('source[src]').forEach((el) => jobs.push(rewrite(el, 'src')));
  await Promise.all(jobs);

  // give the document a plain base so it renders standalone
  if (!doc.querySelector('meta[charset]')) {
    const meta = doc.createElement('meta');
    meta.setAttribute('charset', 'utf-8');
    doc.head.prepend(meta);
  }
  return { html: '<!doctype html>' + doc.documentElement.outerHTML };
}

export function countWords(text: string): number {
  const m = text.trim().match(/\S+/g);
  return m ? m.length : 0;
}

export { basename };
