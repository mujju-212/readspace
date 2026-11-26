/**
 * Height-Aware DOM + Text-Node Paginator for 3D Book Mode (Google Play Books style).
 * Walks the DOM tree down to text nodes and uses exact DOM layout measurement +
 * binary search to split paragraphs, lists, code blocks, blockquotes, and tables
 * at clean visual line boundaries without stripping inline HTML or cutting off text.
 */

export interface PaginatorOptions {
  contentWidth?: number;
  maxContentHeight?: number;
  safetyBuffer?: number;
  fontSize?: string;
  lineHeight?: string;
  fontFamily?: string;
  articleClassName?: string;
}

const VOID_OR_MEDIA_TAGS = new Set([
  'IMG',
  'SVG',
  'HR',
  'BR',
  'VIDEO',
  'AUDIO',
  'CANVAS',
  'IFRAME',
  'INPUT',
  'MATH',
  'OBJECT',
  'EMBED',
]);

const HEADING_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);

function hasMeaningfulContent(root: Node): boolean {
  if (root.nodeType === Node.TEXT_NODE) {
    return /\S/.test(root.textContent || '');
  }
  if (root.nodeType !== Node.ELEMENT_NODE) return false;
  const el = root as HTMLElement;
  const tag = el.tagName.toUpperCase();
  if (tag === 'IMG' || tag === 'SVG' || tag === 'HR' || tag === 'VIDEO' || tag === 'CANVAS' || tag === 'IFRAME' || tag === 'INPUT' || tag === 'MATH') {
    return true;
  }
  for (const child of Array.from(el.childNodes)) {
    if (hasMeaningfulContent(child)) return true;
  }
  return false;
}

function snapSplitIndex(text: string, maxLen: number, inPre: boolean, allowMidWord: boolean): number {
  if (maxLen <= 0) return 0;
  if (maxLen >= text.length) return text.length;

  let idx = maxLen;
  // Avoid splitting UTF-16 surrogate pairs
  if (idx > 0 && idx < text.length) {
    const code = text.charCodeAt(idx - 1);
    if (code >= 0xd800 && code <= 0xdbff) idx--;
  }

  if (inPre) {
    const nl = text.lastIndexOf('\n', idx - 1);
    if (nl >= 0) return nl + 1;
  }

  // Snap back to whitespace boundary if we landed inside a word
  if (idx > 0 && idx < text.length && !/\s/.test(text[idx]) && !/\s/.test(text[idx - 1])) {
    const prefix = text.slice(0, idx);
    const match = prefix.match(/\s(?=[^\s]*$)/);
    if (match && match.index !== undefined && match.index > 0) {
      return match.index + 1;
    }
    // Single unbroken token longer than available space
    if (!allowMidWord) return 0;
  }

  return idx;
}

function splitContainerIntoLines(container: HTMLElement): Node[][] {
  const lines: Node[][] = [[]];

  const appendToCurrentLine = (node: Node, wrapperStack: HTMLElement[]) => {
    const curLine = lines[lines.length - 1];
    if (wrapperStack.length === 0) {
      curLine.push(node);
      return;
    }
    // Reuse existing trailing wrapper chain if it matches the same source elements
    let targetArr: Node[] = curLine;
    let parentEl: HTMLElement | null = null;
    for (let i = 0; i < wrapperStack.length; i++) {
      const srcWrap = wrapperStack[i];
      const last = targetArr[targetArr.length - 1] as HTMLElement | undefined;
      if (last && last.nodeType === Node.ELEMENT_NODE && (last as any).__rsSrc === srcWrap) {
        parentEl = last;
        targetArr = Array.from(last.childNodes);
      } else {
        const clone = srcWrap.cloneNode(false) as HTMLElement;
        (clone as any).__rsSrc = srcWrap;
        if (parentEl) {
          parentEl.appendChild(clone);
        } else {
          curLine.push(clone);
        }
        parentEl = clone;
        targetArr = [];
      }
    }
    if (parentEl) {
      parentEl.appendChild(node);
    } else {
      curLine.push(node);
    }
  };

  const walk = (node: Node, wrapperStack: HTMLElement[]) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || '';
      const parts = text.split('\n');
      for (let i = 0; i < parts.length; i++) {
        if (parts[i].length > 0) {
          appendToCurrentLine(document.createTextNode(parts[i]), wrapperStack);
        }
        if (i < parts.length - 1) {
          lines.push([]);
        }
      }
      return;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      if (el.tagName.toUpperCase() === 'BR') {
        lines.push([]);
        return;
      }
      if (el.childNodes.length === 0) {
        appendToCurrentLine(el.cloneNode(true), wrapperStack);
        return;
      }
      const nextStack = [...wrapperStack, el];
      for (const child of Array.from(el.childNodes)) {
        walk(child, nextStack);
      }
    }
  };

  for (const child of Array.from(container.childNodes)) {
    walk(child, []);
  }
  return lines;
}

function computeOlItemNumbers(ol: HTMLElement): WeakMap<HTMLElement, number> {
  const map = new WeakMap<HTMLElement, number>();
  const startAttr = ol.getAttribute('start');
  let cur = startAttr !== null && !Number.isNaN(Number(startAttr)) ? Number(startAttr) : 1;
  for (const child of Array.from(ol.children)) {
    const li = child as HTMLElement;
    if (li.tagName.toUpperCase() !== 'LI') continue;
    const valAttr = li.getAttribute('value');
    if (valAttr !== null && !Number.isNaN(Number(valAttr))) {
      cur = Number(valAttr);
    }
    map.set(li, cur);
    cur++;
  }
  return map;
}

/**
 * Paginates an HTML string into an array of page HTML strings.
 * Guarantees every page fits within `maxContentHeight - safetyBuffer`
 * while preserving inline formatting, list numbering, table headers, and code highlighting.
 */
export function paginateHtml(
  rawHtml: string,
  options: PaginatorOptions = {},
): string[] {
  if (!rawHtml || typeof rawHtml !== 'string') return [''];

  if (typeof document === 'undefined') {
    const chunks = rawHtml.split(/<\/p>/i).filter((c) => c.trim().length > 0);
    return chunks.length > 0 ? chunks.map((c) => `${c}</p>`) : [rawHtml];
  }

  const parser = new DOMParser();
  const parsedDoc = parser.parseFromString(`<body>${rawHtml}</body>`, 'text/html');
  const topNodes = Array.from(parsedDoc.body.childNodes);
  if (topNodes.length === 0) return [rawHtml];

  const contentWidth = Math.max(200, options.contentWidth ?? 460);
  const maxContentHeight = Math.max(180, options.maxContentHeight ?? 520);
  const safetyBuffer = options.safetyBuffer ?? 12;
  const effectiveMaxHeight = Math.max(120, maxContentHeight - safetyBuffer);

  // Off-screen measurement container matching live .rs-html-page-article BFC & typography
  const measureEl = document.createElement('div');
  measureEl.className =
    options.articleClassName || 'reader md-body rs-html-page-article rs-measure-container';
  measureEl.style.position = 'fixed';
  measureEl.style.left = '-99999px';
  measureEl.style.top = '0';
  measureEl.style.width = `${contentWidth}px`;
  measureEl.style.maxWidth = `${contentWidth}px`;
  measureEl.style.height = 'auto';
  measureEl.style.maxHeight = 'none';
  measureEl.style.overflow = 'visible';
  measureEl.style.display = 'flow-root';
  measureEl.style.visibility = 'hidden';
  measureEl.style.pointerEvents = 'none';
  measureEl.style.boxSizing = 'border-box';
  measureEl.style.padding = '0';
  measureEl.style.margin = '0';

  if (options.fontSize) measureEl.style.fontSize = options.fontSize;
  if (options.lineHeight) measureEl.style.lineHeight = options.lineHeight;
  if (options.fontFamily) measureEl.style.fontFamily = options.fontFamily;

  document.body.appendChild(measureEl);

  const pages: string[] = [];
  const liNumberMap = new WeakMap<HTMLElement, number>();

  const currentHeight = (): number => {
    const rectH = Math.ceil(measureEl.getBoundingClientRect().height);
    return Math.max(rectH, measureEl.scrollHeight);
  };

  const fits = (): boolean => currentHeight() <= effectiveMaxHeight;

  const commitPage = () => {
    if (!hasMeaningfulContent(measureEl)) {
      measureEl.replaceChildren();
      return;
    }
    const html = measureEl.innerHTML.trim();
    if (html.length > 0) {
      pages.push(html);
    }
    measureEl.replaceChildren();
  };

  /**
   * Commits the current page and reopens the ancestor chain on a fresh page.
   * Empty trailing wrappers on the current page are pruned so they start fresh
   * (not marked as reopened) on the next page.
   */
  const startNewPageWithReopenedAncestors = (targetContainer: HTMLElement): HTMLElement => {
    const chain: HTMLElement[] = [];
    let cur: HTMLElement | null = targetContainer;
    while (cur && cur !== measureEl) {
      chain.unshift(cur);
      cur = cur.parentElement;
    }

    const specs = chain.map((anc) => {
      const hadContent = hasMeaningfulContent(anc);
      const tag = anc.tagName.toUpperCase();
      let olNextStart: number | undefined;
      let liValue: number | undefined;

      if (tag === 'OL') {
        const lis = Array.from(anc.children).filter(
          (c) => c.tagName.toUpperCase() === 'LI',
        ) as HTMLElement[];
        const startAttr = anc.getAttribute('start');
        let nextNum = startAttr !== null && !Number.isNaN(Number(startAttr)) ? Number(startAttr) : 1;
        for (const li of lis) {
          const v = li.getAttribute('value');
          if (v !== null && !Number.isNaN(Number(v))) {
            nextNum = Number(v);
          }
          if (hasMeaningfulContent(li)) {
            nextNum++;
          }
        }
        olNextStart = nextNum;
      } else if (tag === 'LI') {
        const v = anc.getAttribute('value');
        if (v !== null && !Number.isNaN(Number(v))) {
          liValue = Number(v);
        }
      }

      return { anc, hadContent, olNextStart, liValue };
    });

    // Mark sliced ancestors or prune empty trailing wrappers on the current page
    for (let i = specs.length - 1; i >= 0; i--) {
      const { anc, hadContent } = specs[i];
      if (!hadContent) {
        anc.parentNode?.removeChild(anc);
      } else {
        anc.setAttribute('data-rs-sliced', 'true');
      }
    }

    commitPage();

    // Rebuild ancestor chain on the fresh page
    let parent: HTMLElement = measureEl;
    for (const spec of specs) {
      const clone = spec.anc.cloneNode(false) as HTMLElement;
      clone.removeAttribute('data-rs-sliced');
      if (spec.hadContent) {
        clone.removeAttribute('id');
        clone.setAttribute('data-rs-reopened', 'true');
      } else {
        clone.removeAttribute('data-rs-reopened');
      }
      if (clone.tagName.toUpperCase() === 'OL' && spec.olNextStart !== undefined) {
        clone.setAttribute('start', String(spec.olNextStart));
      }
      if (clone.tagName.toUpperCase() === 'LI' && !spec.hadContent && spec.liValue !== undefined) {
        clone.setAttribute('value', String(spec.liValue));
      }
      parent.appendChild(clone);
      parent = clone;
    }

    return parent;
  };

  const appendTextNode = (textNode: Text, initialTarget: HTMLElement): HTMLElement => {
    let target = initialTarget;
    let remaining = textNode.textContent || '';
    if (!remaining) return target;

    // Skip pure whitespace between top-level blocks
    if (target === measureEl && !/\S/.test(remaining)) {
      return target;
    }

    const inPre = target.closest('pre') !== null;

    while (remaining.length > 0) {
      // Skip leading whitespace on a brand-new page outside <pre>
      if (!hasMeaningfulContent(measureEl) && !inPre) {
        remaining = remaining.replace(/^\s+/, '');
        if (!remaining) break;
      }

      const fullNode = document.createTextNode(remaining);
      target.appendChild(fullNode);
      if (fits()) {
        break;
      }
      target.removeChild(fullNode);

      const pageHasContent = hasMeaningfulContent(measureEl);
      const probe = document.createTextNode('');
      target.appendChild(probe);

      let lo = 0;
      let hi = remaining.length;
      let best = 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        probe.textContent = remaining.slice(0, mid);
        if (fits()) {
          best = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      target.removeChild(probe);

      let splitAt = snapSplitIndex(remaining, best, inPre, !pageHasContent);

      if (splitAt <= 0) {
        if (pageHasContent) {
          target = startNewPageWithReopenedAncestors(target);
          continue;
        }
        // Blank page and even 1 word/char overflows: force at least 1 token/line so we never loop
        const firstBreak = inPre
          ? remaining.indexOf('\n')
          : remaining.search(/\s/);
        splitAt = firstBreak > 0 ? firstBreak + 1 : Math.min(remaining.length, Math.max(1, best || 1));
      }

      const headRaw = remaining.slice(0, splitAt);
      const head = inPre && headRaw.endsWith('\n') && remaining.length > splitAt
        ? headRaw.slice(0, -1)
        : headRaw;
      if (head.length > 0) {
        target.appendChild(document.createTextNode(head));
      }
      remaining = remaining.slice(splitAt);
      if (!inPre) {
        remaining = remaining.replace(/^\s+/, '');
      }

      if (remaining.length > 0) {
        target = startNewPageWithReopenedAncestors(target);
      }
    }

    return target;
  };

  const appendTable = (tableEl: HTMLElement, initialTarget: HTMLElement): HTMLElement => {
    let target = initialTarget;
    const thead = tableEl.querySelector(':scope > thead') as HTMLElement | null;
    const allTrs = Array.from(tableEl.querySelectorAll(':scope > tbody > tr, :scope > tr')) as HTMLElement[];

    let headerTr: HTMLElement | null = null;
    let dataTrs = allTrs;
    if (!thead && allTrs.length > 1) {
      const first = allTrs[0];
      if (first.querySelector('th') && !first.querySelector('td')) {
        headerTr = first;
        dataTrs = allTrs.slice(1);
      }
    }

    const makeTableShell = (reopened: boolean): { table: HTMLTableElement; tbody: HTMLTableSectionElement } => {
      const t = tableEl.cloneNode(false) as HTMLTableElement;
      if (reopened) {
        t.removeAttribute('id');
        t.setAttribute('data-rs-reopened', 'true');
      }
      if (thead) {
        const thClone = thead.cloneNode(true) as HTMLElement;
        if (reopened) thClone.setAttribute('data-rs-repeated-header', 'true');
        t.appendChild(thClone);
      }
      const tb = document.createElement('tbody');
      if (headerTr) {
        const hrClone = headerTr.cloneNode(true) as HTMLElement;
        if (reopened) hrClone.setAttribute('data-rs-repeated-header', 'true');
        tb.appendChild(hrClone);
      }
      t.appendChild(tb);
      return { table: t, tbody: tb };
    };

    let { table: curTable, tbody: curTbody } = makeTableShell(false);
    target.appendChild(curTable);

    // Ensure header + first data row fit together before committing to current page
    if (dataTrs.length > 0) {
      const firstRowClone = dataTrs[0].cloneNode(true);
      curTbody.appendChild(firstRowClone);
      if (!fits() && hasMeaningfulContent(measureEl)) {
        curTbody.removeChild(firstRowClone);
        target.removeChild(curTable);
        if (hasMeaningfulContent(measureEl)) {
          target = startNewPageWithReopenedAncestors(target);
          const fresh = makeTableShell(false);
          curTable = fresh.table;
          curTbody = fresh.tbody;
          target.appendChild(curTable);
        } else {
          target.appendChild(curTable);
        }
      } else {
        curTbody.removeChild(firstRowClone);
      }
    }

    let dataRowsInCurrentTable = 0;
    for (const tr of dataTrs) {
      const trClone = tr.cloneNode(true);
      curTbody.appendChild(trClone);
      if (fits()) {
        dataRowsInCurrentTable++;
        continue;
      }

      curTbody.removeChild(trClone);
      if (dataRowsInCurrentTable > 0 || hasMeaningfulContent(measureEl)) {
        if (dataRowsInCurrentTable === 0) {
          target.removeChild(curTable);
        } else {
          curTable.setAttribute('data-rs-sliced', 'true');
        }
        target = startNewPageWithReopenedAncestors(target);
        const fresh = makeTableShell(dataRowsInCurrentTable > 0);
        curTable = fresh.table;
        curTbody = fresh.tbody;
        target.appendChild(curTable);
        curTbody.appendChild(trClone);
        dataRowsInCurrentTable = 1;
      } else {
        // Single row taller than an entire blank page: keep it on this page
        curTbody.appendChild(trClone);
        dataRowsInCurrentTable++;
      }
    }

    return target;
  };

  const appendElement = (
    el: HTMLElement,
    initialTarget: HTMLElement,
    nextSibling: Node | null,
  ): HTMLElement => {
    let target = initialTarget;
    const tag = el.tagName.toUpperCase();

    // Skip leading <br> at the very top of a page or reopened block
    if (tag === 'BR' && !hasMeaningfulContent(target)) {
      return target;
    }

    // <hr>: render inline if it fits; if it overflows at bottom, break page without dangling <hr> at top
    if (tag === 'HR') {
      const hrClone = el.cloneNode(true);
      target.appendChild(hrClone);
      if (!fits()) {
        target.removeChild(hrClone);
        if (hasMeaningfulContent(measureEl)) {
          target = startNewPageWithReopenedAncestors(target);
        }
      }
      return target;
    }

    // Precompute <ol> item numbers so split lists preserve numbering
    if (tag === 'OL') {
      const nums = computeOlItemNumbers(el);
      for (const child of Array.from(el.children)) {
        const li = child as HTMLElement;
        const n = nums.get(li);
        if (n !== undefined) liNumberMap.set(li, n);
      }
    }

    // Fast path: try appending the whole element
    const deepClone = el.cloneNode(true) as HTMLElement;
    if (tag === 'LI') {
      const n = liNumberMap.get(el);
      if (n !== undefined && !deepClone.hasAttribute('value')) {
        deepClone.setAttribute('value', String(n));
      }
    }
    target.appendChild(deepClone);

    if (fits()) {
      // Orphan heading protection: don't strand a heading at the very bottom of a page
      if (target === measureEl && HEADING_TAGS.has(tag) && nextSibling) {
        const remainingH = effectiveMaxHeight - currentHeight();
        // Check if there were elements before this heading on the page
        const hadPriorContent = Array.from(measureEl.childNodes).some(
          (n) => n !== deepClone && hasMeaningfulContent(n),
        );
        if (hadPriorContent && remainingH < 44) {
          measureEl.removeChild(deepClone);
          commitPage();
          measureEl.appendChild(deepClone);
        }
      }
      return target;
    }

    // Did not fit! Remove deep clone and handle splitting or moving
    target.removeChild(deepClone);

    // Atomic / media elements (IMG, SVG, VIDEO, CANVAS, etc.)
    if (VOID_OR_MEDIA_TAGS.has(tag) || el.childNodes.length === 0) {
      if (hasMeaningfulContent(measureEl)) {
        target = startNewPageWithReopenedAncestors(target);
      }
      const mediaClone = el.cloneNode(true) as HTMLElement;
      target.appendChild(mediaClone);
      if (!fits() && (tag === 'IMG' || tag === 'SVG' || tag === 'VIDEO' || tag === 'CANVAS')) {
        mediaClone.style.maxHeight = `${Math.max(100, effectiveMaxHeight - 8)}px`;
        mediaClone.style.maxWidth = '100%';
        mediaClone.style.width = 'auto';
        mediaClone.style.height = 'auto';
        mediaClone.style.objectFit = 'contain';
      }
      return target;
    }

    // Headings: move whole heading to next page if current page has content
    if (HEADING_TAGS.has(tag) && hasMeaningfulContent(measureEl)) {
      target = startNewPageWithReopenedAncestors(target);
      target.appendChild(deepClone);
      if (fits()) return target;
      target.removeChild(deepClone);
    }

    // Tables: row-aware splitting with repeated headers
    if (tag === 'TABLE') {
      return appendTable(el, target);
    }

    // <pre> blocks: split cleanly at logical newline boundaries while preserving hljs spans
    if (tag === 'PRE') {
      if (hasMeaningfulContent(measureEl) && currentHeight() > effectiveMaxHeight * 0.75) {
        const nextTarget = startNewPageWithReopenedAncestors(target);
        nextTarget.appendChild(deepClone);
        if (fits()) return nextTarget;
        nextTarget.removeChild(deepClone);
        target = nextTarget;
      }

      const codeChild =
        el.children.length === 1 && el.children[0].tagName.toUpperCase() === 'CODE'
          ? (el.children[0] as HTMLElement)
          : null;
      const lineSource = codeChild || el;
      const lines = splitContainerIntoLines(lineSource);

      if (lines.length > 1) {
        const makePreShell = (reopened: boolean): { pre: HTMLElement; host: HTMLElement } => {
          const p = el.cloneNode(false) as HTMLElement;
          if (reopened) {
            p.removeAttribute('id');
            p.setAttribute('data-rs-reopened', 'true');
          }
          if (codeChild) {
            const c = codeChild.cloneNode(false) as HTMLElement;
            if (reopened) c.removeAttribute('id');
            p.appendChild(c);
            return { pre: p, host: c };
          }
          return { pre: p, host: p };
        };

        const appendLineNodes = (host: HTMLElement, lineNodes: Node[], addNewline: boolean) => {
          for (const n of lineNodes) {
            host.appendChild(n.cloneNode(true));
          }
          if (addNewline) {
            host.appendChild(document.createTextNode('\n'));
          }
        };

        let { pre: curPre, host: curHost } = makePreShell(false);
        target.appendChild(curPre);
        let linesInCurPre = 0;

        for (let li = 0; li < lines.length; li++) {
          const lineNodes = lines[li];
          const beforeCount = curHost.childNodes.length;
          appendLineNodes(curHost, lineNodes, li < lines.length - 1);

          if (fits()) {
            linesInCurPre++;
            continue;
          }

          // Remove the overflowing line
          while (curHost.childNodes.length > beforeCount) {
            curHost.removeChild(curHost.lastChild!);
          }

          if (linesInCurPre > 0 || hasMeaningfulContent(measureEl)) {
            if (linesInCurPre === 0) {
              target.removeChild(curPre);
            } else {
              // Strip trailing newline at page split boundary
              if (curHost.lastChild?.nodeType === Node.TEXT_NODE && curHost.lastChild.textContent === '\n') {
                curHost.removeChild(curHost.lastChild);
              }
              curPre.setAttribute('data-rs-sliced', 'true');
            }
            target = startNewPageWithReopenedAncestors(target);
            const fresh = makePreShell(linesInCurPre > 0);
            curPre = fresh.pre;
            curHost = fresh.host;
            target.appendChild(curPre);
            linesInCurPre = 0;

            const retryBefore = curHost.childNodes.length;
            appendLineNodes(curHost, lineNodes, li < lines.length - 1);
            if (fits()) {
              linesInCurPre++;
              continue;
            }
            // Single wrapped line taller than an entire blank page: split its nodes via recursive splitter
            while (curHost.childNodes.length > retryBefore) {
              curHost.removeChild(curHost.lastChild!);
            }
            for (const n of lineNodes) {
              if (n.nodeType === Node.TEXT_NODE) {
                curHost = appendTextNode(n as Text, curHost);
              } else if (n.nodeType === Node.ELEMENT_NODE) {
                curHost = appendElement(n as HTMLElement, curHost, null);
              }
            }
            if (li < lines.length - 1) {
              curHost.appendChild(document.createTextNode('\n'));
            }
            curPre = curHost.closest('pre') || curPre;
            linesInCurPre = 1;
          } else {
            // Blank page and single line overflows: split its nodes
            for (const n of lineNodes) {
              if (n.nodeType === Node.TEXT_NODE) {
                curHost = appendTextNode(n as Text, curHost);
              } else if (n.nodeType === Node.ELEMENT_NODE) {
                curHost = appendElement(n as HTMLElement, curHost, null);
              }
            }
            if (li < lines.length - 1) {
              curHost.appendChild(document.createTextNode('\n'));
            }
            curPre = curHost.closest('pre') || curPre;
            linesInCurPre = 1;
          }
        }

        return target;
      }
    }

    // Recursive container splitting (P, DIV, BLOCKQUOTE, UL, OL, LI, PRE, CODE, SPAN, etc.)
    const shallow = el.cloneNode(false) as HTMLElement;
    if (tag === 'LI') {
      const n = liNumberMap.get(el);
      if (n !== undefined && !shallow.hasAttribute('value')) {
        shallow.setAttribute('value', String(n));
      }
    }
    target.appendChild(shallow);

    let curTarget: HTMLElement = shallow;
    const children = Array.from(el.childNodes);
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const childNext = i + 1 < children.length ? children[i + 1] : null;
      if (child.nodeType === Node.COMMENT_NODE) continue;
      if (child.nodeType === Node.TEXT_NODE) {
        curTarget = appendTextNode(child as Text, curTarget);
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        curTarget = appendElement(child as HTMLElement, curTarget, childNext);
      }
    }

    // Walk back up to the parent level corresponding to `target`
    // (curTarget may now be on a later page inside a reopened clone of `shallow`)
    if (!hasMeaningfulContent(curTarget) && curTarget.parentElement) {
      const p = curTarget.parentElement;
      p.removeChild(curTarget);
      return p;
    }
    return curTarget.parentElement || measureEl;
  };

  try {
    let curTarget: HTMLElement = measureEl;
    for (let i = 0; i < topNodes.length; i++) {
      const node = topNodes[i];
      const next = i + 1 < topNodes.length ? topNodes[i + 1] : null;
      if (node.nodeType === Node.COMMENT_NODE) continue;
      if (node.nodeType === Node.TEXT_NODE) {
        curTarget = appendTextNode(node as Text, curTarget);
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        curTarget = appendElement(node as HTMLElement, curTarget, next);
      }
    }
    commitPage();
  } finally {
    if (measureEl.parentNode) {
      measureEl.parentNode.removeChild(measureEl);
    }
  }

  return pages.length > 0 ? pages : [rawHtml];
}

/**
 * Paginates plain text or code into an array of page strings with line-aware chunking.
 */
export function paginatePlainText(
  text: string,
  options: { maxLinesPerPage?: number } = {},
): string[] {
  if (!text) return [''];
  const maxLines = options.maxLinesPerPage ?? 32;
  const lines = text.split('\n');
  if (lines.length <= maxLines) return [text];

  const pages: string[] = [];
  let currentLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    currentLines.push(lines[i]);
    if (currentLines.length >= maxLines) {
      pages.push(currentLines.join('\n'));
      currentLines = [];
    }
  }

  if (currentLines.length > 0) {
    pages.push(currentLines.join('\n'));
  }

  return pages;
}
