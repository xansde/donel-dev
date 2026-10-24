import { Button } from '@donel-dev/design-system';
import { Check, Copy } from 'lucide-react';
import { memo, useCallback, useMemo, useRef } from 'react';
import type { ClipboardEvent, ComponentProps, ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Element, ElementContent } from 'hast';
import {
  chatMarkdownClipboardPayload,
  serializeTableElementToMarkdown,
} from '../../../../shared/chat/t3/markdownClipboard';
import { ChatCodeBlock } from './CodeBlock';
import { parseFence } from './codeFence';
import { classifyLink } from './links';
import { useCopyFeedback } from './useCopyFeedback';
import styles from './Markdown.module.css';

export interface MarkdownProps {
  /** Markdown source. Raw HTML in it is dropped, never rendered. */
  source: string;
  /** Opens an http(s)/mailto link through `chat:open-external` (wired by the container). */
  onOpenExternal: (url: string) => void;
  className?: string;
}

const REMARK_PLUGINS = [remarkGfm];

// Keep every href as written so `classifyLink` decides; nothing but http(s)/mailto
// is ever put on an element (see the `a` component).
const keepUrl = (url: string): string => url;

function hastText(node: ElementContent): string {
  if (node.type === 'text') return node.value;
  if (node.type === 'element') return node.children.map(hastText).join('');
  return '';
}

function TableFrame({ children }: { children?: ReactNode }) {
  const tableRef = useRef<HTMLTableElement>(null);
  const { copied, copy } = useCopyFeedback();
  return (
    <div className={styles.tableFrame}>
      <div className={styles.tableScroll}>
        <table ref={tableRef}>{children}</table>
      </div>
      <Button
        variant="ghost"
        className={styles.tableCopy}
        aria-label="Copiar tabela"
        title="Copiar tabela como markdown"
        onClick={() => {
          if (tableRef.current) void copy(serializeTableElementToMarkdown(tableRef.current));
        }}
      >
        {copied ? <Check size={14} strokeWidth={2} aria-hidden="true" /> : <Copy size={14} strokeWidth={1.75} aria-hidden="true" />}
      </Button>
    </div>
  );
}

/**
 * Assistant markdown (T051): `react-markdown` + `remark-gfm`, raw HTML dropped
 * (`skipHtml`, no rehype-raw), links opened only through `onOpenExternal`,
 * Windows paths shown as text, images never loaded, code in Shiki blocks,
 * tables with "Copiar tabela" (as markdown). A text selection copied from here
 * is re-serialised as markdown (T3 `markdownClipboard`).
 */
function MarkdownImpl({ source, onOpenExternal, className }: MarkdownProps) {
  const openRef = useRef(onOpenExternal);
  openRef.current = onOpenExternal;

  const components = useMemo<Components>(
    () => ({
      a({ href, children }: ComponentProps<'a'>) {
        const link = classifyLink(href);
        if (link.kind === 'external') {
          return (
            <a
              href={link.url}
              title={link.url}
              rel="noreferrer"
              onClick={(event) => {
                event.preventDefault();
                openRef.current(link.url);
              }}
            >
              {children}
            </a>
          );
        }
        if (link.kind === 'path') {
          return (
            <span className={styles.path} title={link.path}>
              {children}
            </span>
          );
        }
        return <span>{children}</span>;
      },
      img({ alt }: ComponentProps<'img'>) {
        return <span className={styles.image}>{alt ? `[imagem: ${alt}]` : '[imagem]'}</span>;
      },
      // A fenced block arrives as <pre><code class="language-x">; the inline
      // `code` below never sees it because `pre` renders from the hast node.
      pre({ node }) {
        const code = node?.children.find((child): child is Element => child.type === 'element' && child.tagName === 'code');
        if (!code) return null;
        const meta = (code.data as { meta?: string } | undefined)?.meta;
        const { language, path } = parseFence(code.properties?.className as string[] | undefined, meta);
        return <ChatCodeBlock code={hastText(code).replace(/\n$/, '')} language={language} path={path} />;
      },
      code({ children }: ComponentProps<'code'>) {
        return <code className={styles.inlineCode}>{children}</code>;
      },
      table({ children }: ComponentProps<'table'>) {
        return <TableFrame>{children}</TableFrame>;
      },
    }),
    [],
  );

  const handleCopy = useCallback((event: ClipboardEvent<HTMLDivElement>) => {
    const selection = window.getSelection();
    if (!selection) return;
    const payload = chatMarkdownClipboardPayload(selection);
    if (!payload) return;
    event.preventDefault();
    event.clipboardData.setData('text/plain', payload.text);
    event.clipboardData.setData('text/html', payload.html);
  }, []);

  return (
    <div className={[styles.root, className].filter(Boolean).join(' ')} onCopy={handleCopy}>
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} skipHtml urlTransform={keepUrl} components={components}>
        {source}
      </ReactMarkdown>
    </div>
  );
}

export const Markdown = memo(MarkdownImpl);
