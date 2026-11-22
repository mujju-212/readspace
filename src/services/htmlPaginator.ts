/**
 * Height-Aware DOM Paginator for 3D Book Mode (Google Play Books style).
 * Measures actual rendered element heights in the DOM to guarantee that
 * content NEVER overflows the page, eliminating text cutoffs and awkward scrollbars.
 */

export interface PaginatorOptions {
  contentWidth?: number;
  maxContentHeight?: number;
  safetyBuffer?: number;
  fontSize?: string;
  lineHeight?: string;
  fontFamily?: string;
}

/**
 * Paginates an HTML string into an array of page HTML strings.
 * Uses exact DOM height measurement with a generous safety margin
 * to ensure every page fits its book frame cleanly without cutoffs.
 */
export function paginateHtml(
  rawHtml: string,
  options: PaginatorOptions = {},
): string[] {
  if (!rawHtml || typeof rawHtml !== 'string') return [''];

  if (typeof document === 'undefined') {
    // SSR fallback: chunk by paragraph tags
    const chunks = rawHtml.split(/<\/p>/i).filter((c) => c.trim().length > 0);
    return chunks.map((c) => `${c}</p>`);
  }

  const parser = new DOMParser();
  const parsedDoc = parser.parseFromString(`<body>${rawHtml}</body>`, 'text/html');
  const childNodes = Array.from(parsedDoc.body.childNodes);
  if (childNodes.length === 0) return [rawHtml];

  const contentWidth = Math.max(240, options.contentWidth ?? 460);
  const maxContentHeight = Math.max(260, options.maxContentHeight ?? 520);
  const safetyBuffer = options.safetyBuffer ?? 32;
  const effectiveMaxHeight = Math.max(180, maxContentHeight - safetyBuffer);

  // Create an off-screen measure container matching live reader typography
  const measureEl = document.createElement('div');
  measureEl.className = 'reader md-body rs-html-page-article rs-measure-container';
  measureEl.style.position = 'fixed';
  measureEl.style.left = '-9999px';
  measureEl.style.top = '0';
  measureEl.style.width = `${contentWidth}px`;
  measureEl.style.maxHeight = 'none';
  measureEl.style.overflow = 'visible';
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
  let currentPageNodes: Node[] = [];

  const pushCurrentPage = () => {
    if (currentPageNodes.length === 0) return;
    const temp = document.createElement('div');
    for (const n of currentPageNodes) {
      temp.appendChild(n.cloneNode(true));
    }
    const html = temp.innerHTML.trim();
    if (html.length > 0) {
      pages.push(html);
    }
    currentPageNodes = [];
    measureEl.replaceChildren();
  };

  try {
    for (const node of childNodes) {
      if (node.nodeType === Node.COMMENT_NODE) continue;

      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent?.trim() || '';
        if (!text) continue;
        const p = document.createElement('p');
        p.textContent = text;
        measureEl.appendChild(p);

        if (measureEl.scrollHeight > effectiveMaxHeight && currentPageNodes.length > 0) {
          measureEl.removeChild(p);
          pushCurrentPage();
          measureEl.appendChild(p);
        }
        currentPageNodes.push(p.cloneNode(true));
        continue;
      }

      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement;
        const tagName = el.tagName.toUpperCase();

        // Horizontal rule <hr> is an explicit user section break
        if (tagName === 'HR') {
          if (currentPageNodes.length > 0) {
            pushCurrentPage();
          }
          continue;
        }

        // Major section header: H1 or H2 when page already has significant content
        const isMajorHeader =
          (tagName === 'H1' || tagName === 'H2') &&
          measureEl.scrollHeight > effectiveMaxHeight * 0.4;
        if (isMajorHeader && currentPageNodes.length > 0) {
          pushCurrentPage();
        }

        // Try adding the element to measure container
        const clone = el.cloneNode(true) as HTMLElement;
        measureEl.appendChild(clone);

        if (measureEl.scrollHeight <= effectiveMaxHeight) {
          // Fits cleanly on current page within safe height
          currentPageNodes.push(clone);
          continue;
        }

        // Exceeds effectiveMaxHeight!
        measureEl.removeChild(clone);

        // If page already has content, push current page and place on fresh page
        if (currentPageNodes.length > 0) {
          pushCurrentPage();
          measureEl.appendChild(clone);

          if (measureEl.scrollHeight <= effectiveMaxHeight) {
            currentPageNodes.push(clone);
            continue;
          }

          // Single element alone exceeds effectiveMaxHeight on a blank page!
          measureEl.removeChild(clone);
        }

        // Element is taller than an entire page: split its child contents across pages
        if (tagName === 'UL' || tagName === 'OL') {
          const listItems = Array.from(el.children);
          let currentList = document.createElement(tagName.toLowerCase()) as
            | HTMLUListElement
            | HTMLOListElement;
          measureEl.appendChild(currentList);

          for (const li of listItems) {
            const liClone = li.cloneNode(true);
            currentList.appendChild(liClone);

            if (measureEl.scrollHeight > effectiveMaxHeight && currentList.children.length > 1) {
              currentList.removeChild(liClone);
              currentPageNodes.push(currentList.cloneNode(true));
              pushCurrentPage();

              currentList = document.createElement(tagName.toLowerCase()) as
                | HTMLUListElement
                | HTMLOListElement;
              currentList.appendChild(liClone);
              measureEl.appendChild(currentList);
            }
          }

          if (currentList.children.length > 0) {
            currentPageNodes.push(currentList.cloneNode(true));
          }
        } else if (tagName === 'TABLE') {
          // Split large table rows across pages, preserving table headers (Play Books style)
          const thead = el.querySelector('thead');
          const headerRows = thead
            ? Array.from(thead.querySelectorAll('tr'))
            : Array.from(el.querySelectorAll('tr')).slice(0, 1);
          const allRows = Array.from(el.querySelectorAll('tbody tr')).length > 0
            ? Array.from(el.querySelectorAll('tbody tr'))
            : Array.from(el.querySelectorAll('tr')).slice(headerRows.length);

          let currentTable = document.createElement('table');
          currentTable.className = el.className;
          const currentTbody = document.createElement('tbody');
          if (thead) {
            currentTable.appendChild(thead.cloneNode(true));
          } else if (headerRows.length > 0) {
            currentTbody.appendChild(headerRows[0].cloneNode(true));
          }
          currentTable.appendChild(currentTbody);
          measureEl.appendChild(currentTable);

          for (const tr of allRows) {
            const trClone = tr.cloneNode(true);
            currentTbody.appendChild(trClone);

            if (measureEl.scrollHeight > effectiveMaxHeight && currentTbody.children.length > 1) {
              currentTbody.removeChild(trClone);
              currentPageNodes.push(currentTable.cloneNode(true));
              pushCurrentPage();

              currentTable = document.createElement('table');
              currentTable.className = el.className;
              const newTbody = document.createElement('tbody');
              if (thead) {
                currentTable.appendChild(thead.cloneNode(true));
              } else if (headerRows.length > 0) {
                newTbody.appendChild(headerRows[0].cloneNode(true));
              }
              newTbody.appendChild(trClone);
              currentTable.appendChild(newTbody);
              measureEl.appendChild(currentTable);
            }
          }

          if (currentTbody.children.length > 0) {
            currentPageNodes.push(currentTable.cloneNode(true));
          }
        } else if (tagName === 'PRE') {
          // Split code block lines across pages
          const codeEl = el.querySelector('code') || el;
          const lines = (codeEl.innerHTML || el.innerHTML).split('\n');
          const linesPerPage = Math.max(12, Math.floor(effectiveMaxHeight / 24));

          for (let i = 0; i < lines.length; i += linesPerPage) {
            const chunk = lines.slice(i, i + linesPerPage).join('\n');
            const subPre = document.createElement('pre');
            subPre.className = el.className;
            const subCode = document.createElement('code');
            subCode.innerHTML = chunk;
            subPre.appendChild(subCode);

            if (currentPageNodes.length > 0) {
              pushCurrentPage();
            }
            currentPageNodes.push(subPre);
          }
        } else if (tagName === 'P' || tagName === 'DIV' || tagName === 'BLOCKQUOTE') {
          // Split extra-long paragraphs by sentences
          const fullText = el.innerText || el.textContent || '';
          const sentences = fullText.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);

          if (sentences.length > 1) {
            let currentP = document.createElement('p');
            measureEl.appendChild(currentP);

            for (const s of sentences) {
              const prev = currentP.textContent;
              currentP.textContent = prev ? `${prev} ${s}` : s;

              if (measureEl.scrollHeight > effectiveMaxHeight && prev) {
                currentP.textContent = prev;
                currentPageNodes.push(currentP.cloneNode(true));
                pushCurrentPage();

                currentP = document.createElement('p');
                currentP.textContent = s;
                measureEl.appendChild(currentP);
              }
            }

            if (currentP.textContent?.trim()) {
              currentPageNodes.push(currentP.cloneNode(true));
            }
          } else {
            // Cannot split further: place on dedicated page
            currentPageNodes.push(clone);
            pushCurrentPage();
          }
        } else {
          // Large standalone element (e.g. image, SVG): place on dedicated page
          currentPageNodes.push(clone);
          pushCurrentPage();
        }
      }
    }

    pushCurrentPage();
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
