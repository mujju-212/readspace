import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';
import { marked } from 'marked';
import type { FileSystemProvider } from './fs/types';
import { basename, dirname, extOf } from './fs/types';

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

/** MIME for a referenced asset, robust to query strings / fragments
 * (`diagram.svg?raw=true` used to resolve to octet-stream, which browsers
 * refuse to render as SVG inside <img>). Falls back to sniffing the bytes. */
export function mimeForRef(ref: string, buf?: ArrayBuffer): string {
  const clean = ref.split(/[?#]/)[0];
  const mime = mimeForExt(extOf(clean));
  if (mime !== 'application/octet-stream' || !buf) return mime;
  const head = new TextDecoder().decode(new Uint8Array(buf).slice(0, 512)).trimStart().toLowerCase();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'image/svg+xml';
  return mime;
}

export { countWords, downloadText } from './textUtils';

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').slice(0, 64) || 'section';
}

/* ---------- markdown pipeline (TRD §4.1) ---------- */

marked.use({ gfm: true, breaks: false });

export interface RenderedMarkdown { html: string; blobUrls: string[] }

/**
 * Sanitizer config that keeps inline SVG actually renderable — draw.io /
 * Excalidraw diagrams (<foreignObject> with HTML labels), sprite <use>
 * references — while scripts, event handlers and javascript: URLs are still
 * stripped (verified: onclick/onload/onerror, <script>, <iframe> inside
 * foreignObject and javascript: hrefs are all removed).
 */
const MD_SANITIZE: Parameters<typeof DOMPurify.sanitize>[1] = {
  ADD_TAGS: ['use', 'foreignObject'],
  ADD_ATTR: ['target', 'id', 'xlink:href'],
  // let sanitized HTML live inside SVG <foreignObject>/<desc>/<title>
  // (DOMPurify 3.x no longer treats foreignObject as an integration point
  // unless it is listed here — keys must be lowercase)
  HTML_INTEGRATION_POINTS: { 'annotation-xml': true, foreignobject: true, desc: true, title: true },
};

export async function renderMarkdown(
  text: string,
  path: string,
  provider: FileSystemProvider,
): Promise<RenderedMarkdown> {
  const raw = await marked.parse(text);

  // <embed>/<object> are always stripped by the sanitizer — rewrite SVG ones
  // to <img> first so they go through the normal workspace-asset resolution
  let dirty = raw;
  const pre = new DOMParser().parseFromString(raw, 'text/html');
  const embeds = Array.from(pre.querySelectorAll('embed[src], object[data]'));
  if (embeds.length) {
    for (const el of embeds) {
      const src = el.getAttribute('src') ?? el.getAttribute('data') ?? '';
      const type = (el.getAttribute('type') ?? '').toLowerCase();
      const looksSvg = type.includes('svg') || (!type && /\.svg($|[?#])/i.test(src));
      if (!src || !looksSvg) continue;
      const img = pre.createElement('img');
      img.setAttribute('src', src);
      img.setAttribute('alt', el.getAttribute('aria-label') ?? el.getAttribute('title') ?? 'svg diagram');
      el.replaceWith(img);
    }
    dirty = pre.body.innerHTML;
  }

  const clean = DOMPurify.sanitize(dirty, MD_SANITIZE);

  const doc = new DOMParser().parseFromString(clean, 'text/html');
  const blobUrls: string[] = [];

  // resolve relative assets (md <img>, raw <img>, and <image> inside inline
  // SVG) through the workspace provider into blob: URLs
  const resolveAsset = async (el: Element, attr: string, onMissing: (() => void) | null) => {
    const src = el.getAttribute(attr) ?? '';
    if (!src || src.startsWith('#') || /^(https?:|data:|blob:)/i.test(src)) return;
    try {
      const p = resolveRel(path, decodeURI(src));
      const buf = await provider.readFile(p);
      const url = URL.createObjectURL(new Blob([buf], { type: mimeForRef(src, buf) }));
      blobUrls.push(url);
      el.setAttribute(attr, url);
    } catch {
      if (onMissing) onMissing();
    }
  };

  const jobs: Promise<void>[] = [];
  doc.querySelectorAll('img').forEach((img) => {
    jobs.push(resolveAsset(img, 'src', () => {
      const fig = doc.createElement('span');
      fig.className = 'md-img-missing';
      fig.textContent = `⚠ image not found: ${img.getAttribute('src') ?? ''}`;
      img.replaceWith(fig);
    }));
  });
  // <image href="..."> / <image xlink:href="..."> inside inline SVG
  doc.querySelectorAll('svg image').forEach((im) => {
    const attr = im.getAttribute('href') ? 'href' : im.getAttribute('xlink:href') ? 'xlink:href' : null;
    if (attr) jobs.push(resolveAsset(im, attr, null));
  });
  await Promise.all(jobs);

  // <use> may only reference in-document fragments — drop anything that
  // would make the browser fetch an external resource
  doc.querySelectorAll('use').forEach((u) => {
    for (const attr of ['href', 'xlink:href']) {
      const v = u.getAttribute(attr);
      if (v && !v.startsWith('#')) u.removeAttribute(attr);
    }
  });

  // inline SVG without explicit dimensions but with a viewBox: scale to the
  // reading column instead of the 300×150 default (icons keep their size —
  // they carry explicit width/height)
  doc.querySelectorAll('svg').forEach((s) => {
    if (!s.getAttribute('width') && !s.getAttribute('height') && s.getAttribute('viewBox')) {
      s.setAttribute('width', '100%');
    }
  });

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
      el.setAttribute(attr, toDataUrl(buf, mimeForRef(val, buf)));
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



export { basename };
