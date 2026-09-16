import type { FileSystemProvider, FsEntry, FileStat } from './types';
import { dirname, extOf, sortEntries } from './types';

/** Files bundled with the app under /sample-workspace */
export const SAMPLE_FILES = [
  'README.md',
  'notes/python-basics.md',
  'notes/web-dev.md',
  'notes/reading-list.txt',
  'docs/lecture-notes.txt',
  'docs/grades.csv',
  'docs/project-report.html',
  'papers/readspace-demo.pdf',
  'papers/sample-report.docx',
  'images/architecture.svg',
  'media/lecture-audio.wav',
  'media/intro-clip.webm',
  'media/ai-overview.pptx',
];

/**
 * The built-in demo workspace. Files are fetched from /sample-workspace at
 * runtime; edits are kept in memory so the whole app is try-able without
 * granting any folder permissions.
 */
export class SampleProvider implements FileSystemProvider {
  readonly kind = 'sample' as const;
  readonly canWrite = true; // session-only, in memory
  readonly id = 'sample';
  readonly label = 'Sample workspace';

  private overrides = new Map<string, string>();

  listDir(path: string): Promise<FsEntry[]> {
    const all = [...SAMPLE_FILES, ...this.overrides.keys()];
    const prefix = path ? `${path}/` : '';
    const seen = new Set<string>();
    const out: FsEntry[] = [];
    for (const p of all) {
      if (!p.startsWith(prefix)) continue;
      const rest = p.slice(prefix.length);
      const seg = rest.split('/')[0];
      if (!seg) continue;
      const isNew = !seen.has(seg);
      seen.add(seg);
      if (!isNew) continue;
      if (rest.includes('/')) {
        out.push({ name: seg, path: prefix + seg, kind: 'directory' });
      } else {
        out.push({ name: seg, path: p, kind: 'file', ext: extOf(seg) });
      }
    }
    return Promise.resolve(sortEntries(out));
  }

  async stat(path: string): Promise<FileStat> {
    const ov = this.overrides.get(path);
    if (ov !== undefined) return { size: new TextEncoder().encode(ov).byteLength };
    const buf = await this.readFile(path);
    return { size: buf.byteLength };
  }

  async readFile(path: string): Promise<ArrayBuffer> {
    const ov = this.overrides.get(path);
    if (ov !== undefined) return new TextEncoder().encode(ov).buffer as ArrayBuffer;
    const res = await fetch(`${import.meta.env.BASE_URL}sample-workspace/${path}`);
    if (!res.ok) throw new Error(`Not found: ${path}`);
    return res.arrayBuffer();
  }

  async readText(path: string): Promise<string> {
    const buf = await this.readFile(path);
    return new TextDecoder().decode(buf);
  }

  async writeFile(path: string, data: string): Promise<void> {
    this.overrides.set(path, data);
  }
}


