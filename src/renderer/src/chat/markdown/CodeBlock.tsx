import { CodeBlock as CodeBlockFrame } from '@donel-dev/design-system';
import { Fragment, memo, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { resolveLanguage } from './languages';
import { highlightCode, type HighlightedLine } from './shiki';
import { useCopyFeedback } from './useCopyFeedback';

export interface ChatCodeBlockProps {
  /** Source of the block, without the fence's final newline. */
  code: string;
  /** Language exactly as in the fence; null = no language ("texto"). */
  language: string | null;
  /** Path ONLY when the fence carries it (D-C6). */
  path?: string | null;
}

/** True once the element has been near the viewport; stays true afterwards. */
function useEverVisible(): [RefObject<HTMLDivElement>, boolean] {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (visible) return;
    const element = ref.current;
    if (element === null) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [visible]);
  return [ref, visible];
}

function Lines({ lines }: { lines: readonly HighlightedLine[] }) {
  return (
    <>
      {lines.map((line, index) => (
        <Fragment key={index}>
          <span className="line">
            {line.map((token, tokenIndex) => (
              <span
                key={tokenIndex}
                style={{
                  color: token.color,
                  fontStyle: token.italic ? 'italic' : undefined,
                  fontWeight: token.bold ? 600 : undefined,
                }}
              >
                {token.content}
              </span>
            ))}
          </span>
          {index < lines.length - 1 ? '\n' : null}
        </Fragment>
      ))}
    </>
  );
}

/**
 * Code block of the conversation (T051): DS `CodeBlock` frame + Shiki tokens.
 * Highlighting only starts when the block is near the viewport, so a long
 * history costs nothing until scrolled to; until then (and for unknown
 * languages) the code shows as plain text. Copy = the raw source (D-C9).
 */
function ChatCodeBlockImpl({ code, language, path }: ChatCodeBlockProps) {
  const [ref, visible] = useEverVisible();
  const [lines, setLines] = useState<readonly HighlightedLine[] | null>(null);
  const { copied, copy } = useCopyFeedback();

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    void highlightCode(code, language).then((result) => {
      if (!cancelled) setLines(result);
    });
    return () => {
      cancelled = true;
    };
  }, [visible, code, language]);

  const label = resolveLanguage(language)?.label ?? language ?? 'texto';

  return (
    <div ref={ref}>
      <CodeBlockFrame
        language={label}
        path={path ?? undefined}
        copied={copied}
        onCopy={() => void copy(code)}
      >
        {lines !== null ? <Lines lines={lines} /> : code}
      </CodeBlockFrame>
    </div>
  );
}

export const ChatCodeBlock = memo(ChatCodeBlockImpl);
