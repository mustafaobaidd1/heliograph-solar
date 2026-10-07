/**
 * Renders TeX with KaTeX. KaTeX is loaded on demand by <KatexProvider> when the explanatory
 * section approaches the viewport; until then the TeX source is shown, so nothing is missing.
 */
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

type KatexModule = typeof import('katex');

const KatexContext = createContext<KatexModule | null>(null);

let katexPromise: Promise<KatexModule> | null = null;

function loadKatex(): Promise<KatexModule> {
  if (!katexPromise) {
    katexPromise = Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(
      ([m]) => (m as unknown as { default?: KatexModule }).default ?? m,
    );
  }
  return katexPromise;
}

export function KatexProvider({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [katex, setKatex] = useState<KatexModule | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let alive = true;
    const start = () => {
      loadKatex()
        .then((k) => alive && setKatex(k))
        .catch(() => {
          /* the TeX source stays visible */
        });
    };
    if (!('IntersectionObserver' in window)) {
      start();
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          start();
        }
      },
      { rootMargin: '800px 0px' },
    );
    io.observe(el);
    return () => {
      alive = false;
      io.disconnect();
    };
  }, []);

  return (
    <KatexContext.Provider value={katex}>
      <div ref={ref}>{children}</div>
    </KatexContext.Provider>
  );
}

export function Tex({ children, block = false }: { children: string; block?: boolean }) {
  const katex = useContext(KatexContext);
  if (!katex) {
    return block ? (
      <pre className="tex tex--source">{children}</pre>
    ) : (
      <code className="tex tex--source">{children}</code>
    );
  }
  const html = katex.renderToString(children, {
    displayMode: block,
    throwOnError: false,
    output: 'htmlAndMathml',
    strict: 'ignore',
  });
  const Tag = block ? 'div' : 'span';
  return (
    <Tag className={block ? 'tex tex--block' : 'tex'} dangerouslySetInnerHTML={{ __html: html }} />
  );
}
