import { useEffect, useRef, useState } from 'react';
import { animate, motion, useDragControls, useMotionValue } from 'motion/react';
import { Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger } from '@ui-sdk/react/popover';
import { Card, type CardActions } from './card';
import { Icon } from './icons';
import { languageName, t } from './i18n';
import { COMMIT, gestureAllowed, headline, isReddit, prepared, reducedMotion, youtubeId, type Article, type Reading, type Summary } from './lib';

export type DetailRoute = { kind: 'article' | 'post'; id: string; article: Article | null; missing?: boolean };

const Original = ({ url }: { url: string }) => <a className="original" href={url} target="_blank" rel="noopener noreferrer">{t('reader.openOriginal')} <Icon name="external" size={13} /></a>;

/** The summary block: "AI summary · Czech" from the server's language, the model behind an info popover. */
function SummaryBlock({ summary, language, retry }: { summary: Summary | 'failed' | null; language: string; retry: () => void }) {
  const code = summary && summary !== 'failed' && summary.language ? summary.language : language;
  const name = languageName(code);
  const model = summary && summary !== 'failed' ? summary.model : undefined;
  const label = name ? t('reader.summaryIn', { language: name }) : t('reader.summary');
  return <section className="ai-summary" aria-label={label}>
    <header>
      <b><Icon name="sparkles" size={15} />{label}</b>
      <Popover>
        <PopoverTrigger className="icon-button summary-info" aria-label={t('reader.summaryInfo')}><Icon name="info" size={17} /></PopoverTrigger>
        <PopoverContent className="popover" side="bottom" align="end" sideOffset={6}>
          <PopoverTitle className="popover-title">{label}</PopoverTitle>
          <PopoverDescription className="popover-text">{t('reader.summaryGenerated')}{model ? ` ${t('reader.summaryModel', { model })}.` : ''}</PopoverDescription>
        </PopoverContent>
      </Popover>
    </header>
    <div aria-live="polite">
      {summary === null ? <p className="summary-pending">{t('reader.summaryPreparing')}</p>
        : summary === 'failed' ? <><p className="summary-pending">{t('reader.summaryUnavailable')}</p><button className="secondary-button summary-retry" onClick={retry}>{t('reader.summaryRetry')}</button></>
        : <ul lang={code || undefined}>{summary.points.map((point, i) => <li key={i}>{point}</li>)}</ul>}
    </div>
  </section>;
}

function ArticleReader({ article, language }: { article: Article; language: string }) {
  const [content, setContent] = useState<Reading | { error: string } | null>(null);
  const [summary, setSummary] = useState<Summary | 'failed' | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false; setContent(null); setSummary(null);
    prepared<Reading>(`/api/article/${article.id}/content`, () => cancelled)
      .then(result => { if (!cancelled) setContent(result); })
      .catch(error => { if (!cancelled) setContent({ error: error instanceof Error ? error.message : t('reader.loadFailed') }); });
    return () => { cancelled = true; };
  }, [article.id]);
  const ready = content !== null && !('error' in content);
  useEffect(() => {
    if (!ready) return;
    let cancelled = false; setSummary(null);
    prepared<Summary>(`/api/article/${article.id}/summary`, () => cancelled, attempt ? { retry: true } : undefined)
      .then(result => { if (!cancelled) setSummary(result); })
      .catch(() => { if (!cancelled) setSummary('failed'); });
    return () => { cancelled = true; };
  }, [article.id, ready, attempt]);

  const video = youtubeId(article.url);
  if (content === null) return <><p className="field-help">{t('reader.loadingArticle')}</p><Original url={article.url} /></>;
  if ('error' in content) return <><p role="alert">{content.error}</p><Original url={article.url} /></>;
  return <>
    <p className="eyebrow">{article.source}</p><h1>{content.title}</h1>
    {video && <div className="video-embed"><iframe src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(video)}`} title={content.title} loading="lazy" allow="encrypted-media; picture-in-picture; fullscreen" referrerPolicy="strict-origin-when-cross-origin" /></div>}
    {content.author && <p className="reader-byline">{content.author}</p>}
    <SummaryBlock summary={summary} language={language} retry={() => setAttempt(n => n + 1)} />
    {/* Server-side sanitized by the reader worker. */}
    <details className="full-article" open={!video}>
      <summary><Icon name="article" size={16} /><span>{video ? t('reader.transcript') : isReddit(article.url) ? t('reader.post') : t('reader.fullArticle')}</span><Icon name="chevron" size={18} className="disclosure" /></summary>
      <div className="reading-prose" dangerouslySetInnerHTML={{ __html: content.html }} />
    </details>
  </>;
}

/** The detail is a page with its own URL; swipe right goes back, saving is the bookmark button only. */
export function Detail({ route, busy, notice, actions, back, next, onNext, language, discuss }: { route: DetailRoute | null; busy: boolean; notice: string; actions: CardActions; back: () => void; next: Article | null; onNext: () => void; language: string; discuss: () => void }) {
  const ref = useRef<HTMLElement>(null);
  const x = useMotionValue(0);
  const article = route?.article ?? null;
  useEffect(() => { x.set(0); }, [route?.id, x]);

  const controls = useDragControls();
  const settle = () => animate(x, 0, reducedMotion.matches ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 42 });

  return <motion.section id="articlePage" ref={ref} hidden={route === null} style={{ x }}
    // Swipe right follows the finger and slides the page away.
    drag="x" dragListener={false} dragControls={controls} dragConstraints={{ left: 0 }} dragElastic={{ left: 0, right: 0 }} dragMomentum={false}
    onPointerDown={event => { if (route && event.isPrimary && gestureAllowed(event.target, event.clientX)) controls.start(event, { distanceThreshold: 8 }); }}
    // A dedicated compositor layer only while dragging keeps a long article from repainting on every move.
    onDragStart={() => ref.current?.classList.add('dragging')}
    onDragEnd={(_, info) => {
      actions.hint(null);
      const along = Math.abs(info.offset.y) <= 65;
      // A quick flick goes back even when it is short, like the system gesture.
      if (along && (info.offset.x >= COMMIT || (info.offset.x > 30 && info.velocity.x > 400))) {
        if (reducedMotion.matches) { back(); return; }
        const remaining = innerWidth - x.get(), speed = Math.max(info.velocity.x, 1800);
        void animate(x, innerWidth, { type: 'tween', ease: 'easeOut', duration: Math.min(.22, remaining / speed) }).then(() => { ref.current?.classList.remove('dragging'); back(); });
        return;
      }
      void settle().then(() => ref.current?.classList.remove('dragging'));
    }}>
    <header className="article-toolbar">
      <button id="articleBack" className="icon-button" aria-label={t('reader.back')} title={t('reader.back')} onClick={back}><Icon name="back" /></button>
      <b id="detailLabel">{route?.kind === 'post' ? t('reader.thread') : t('reader.article')}</b>
      <button id="detailDiscuss" className="icon-button" aria-label={t('chat.title')} title={t('chat.title')} disabled={!article} onClick={discuss}><Icon name="reply" /></button>
      <button id="detailSave" className="icon-button bookmark" aria-label={article?.saved ? t('card.unsave') : t('card.save')} aria-pressed={Boolean(article?.saved)} disabled={busy} onClick={() => article && actions.save(article, !article.saved)}><Icon name="bookmark" /></button>
      <a id="articleOriginal" className="original toolbar-link" href={article?.url} target="_blank" rel="noopener noreferrer">{t('reader.original')} <Icon name="external" size={14} /></a>
    </header>
    <main id="readingContent" className="reading-content">
      {notice && <p className="notice error" role="alert">{notice}</p>}
      {route?.missing ? <p className="field-help">{t('reader.missing')}</p>
        : !article ? <p className="field-help">{t('reader.loading')}</p>
        : route?.kind === 'post' ? <><Card article={article} seen busy={busy} inThread actions={actions} />{Boolean((article.tweet as Record<string, any> | null)?.article?.title) && <div className="x-article-reader"><ArticleReader key={article.id} article={article} language={language} /></div>}<a className="thread-conversation" href={article.url} target="_blank" rel="noopener noreferrer">{t('reader.conversation')} <Icon name="external" size={14} /></a></>
        : <ArticleReader key={article.id} article={article} language={language} />}
      {article && next && <button className="next-entry" onClick={onNext}><span>{t('reader.next')}</span><b>{next.kind === 'x' ? String((next.tweet as Record<string, unknown> | null)?.name || next.source) : headline(next.title)}</b><Icon name="next" size={18} /></button>}
    </main>
  </motion.section>;
}
