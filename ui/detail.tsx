import { useEffect, useRef, useState } from 'react';
import { animate, motion, useDragControls, useMotionValue } from 'motion/react';
import { Card, type CardActions } from './card';
import { COMMIT, gestureAllowed, headline, isReddit, prepared, reducedMotion, youtubeId, type Article, type Reading } from './lib';

export type DetailRoute = { kind: 'article' | 'post'; id: string; article: Article | null; missing?: boolean };
type Summary = { points: string[]; model?: string };

function ArticleReader({ article }: { article: Article }) {
  const [content, setContent] = useState<Reading | { error: string } | null>(null);
  const [summary, setSummary] = useState<Summary | 'failed' | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false; setContent(null); setSummary(null);
    prepared<Reading>(`/api/article/${article.id}/content`, () => cancelled)
      .then(result => { if (!cancelled) setContent(result); })
      .catch(error => { if (!cancelled) setContent({ error: error instanceof Error ? error.message : 'Could not load this article.' }); });
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
  if (content === null) return <><p className="field-help">Loading article…</p><a className="original" href={article.url} target="_blank" rel="noopener noreferrer">Open original ↗</a></>;
  if ('error' in content) return <><p role="alert">{content.error}</p><a className="original" href={article.url} target="_blank" rel="noopener noreferrer">Open original ↗</a></>;
  return <>
    <p className="eyebrow">{article.source}</p><h1>{content.title}</h1>
    {video && <div className="video-embed"><iframe src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(video)}`} title={content.title} loading="lazy" allow="encrypted-media; picture-in-picture; fullscreen" referrerPolicy="strict-origin-when-cross-origin" /></div>}
    {content.author && <p className="reader-byline">{content.author}</p>}
    <section className="czech-summary" aria-label="Czech summary">
      <header><b>Czech summary</b><span>{summary && summary !== 'failed' && summary.model === 'gpt-6-luna' ? 'Luna' : 'AI-generated'}</span></header>
      <div aria-live="polite">
        {summary === null ? <p>Preparing Czech summary…</p>
          : summary === 'failed' ? <><p>Summary unavailable.</p><button className="summary-retry" onClick={() => setAttempt(n => n + 1)}>Try again</button></>
          : <ul lang="cs">{summary.points.map((point, i) => <li key={i}>{point}</li>)}</ul>}
      </div>
    </section>
    {/* Server-side sanitized by the reader worker. */}
    <details className="full-article" open={!video}><summary>{video ? 'Transcript' : isReddit(article.url) ? 'Post' : 'Full article'}</summary><div className="reading-prose" dangerouslySetInnerHTML={{ __html: content.html }} /></details>
  </>;
}

/** The detail is a page with its own URL; swipe right goes back, swipe left saves. */
export function Detail({ route, busy, notice, actions, back, next, onNext }: { route: DetailRoute | null; busy: boolean; notice: string; actions: CardActions; back: () => void; next: Article | null; onNext: () => void }) {
  const ref = useRef<HTMLElement>(null);
  const x = useMotionValue(0);
  const article = route?.article ?? null;
  useEffect(() => { x.set(0); }, [route?.id, x]);

  const controls = useDragControls();
  const settle = () => animate(x, 0, reducedMotion.matches ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 42 });

  return <motion.section id="articlePage" ref={ref} hidden={route === null} style={{ x }}
    // Swipe right follows the finger and slides the page away; saving is the bookmark button only.
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
      <button id="articleBack" className="icon-button" aria-label="Back to feed" onClick={back}>←</button>
      <b id="detailLabel">{route?.kind === 'post' ? 'Thread' : 'Article'}</b>
      <button id="detailSave" className="icon-button bookmark" aria-label={article?.saved ? 'Remove from Saved' : 'Save for later'} aria-pressed={Boolean(article?.saved)} disabled={busy} onClick={() => article && actions.save(article, !article.saved)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4z" /></svg></button>
      <a id="articleOriginal" className="original" href={article?.url} target="_blank" rel="noopener noreferrer">Original ↗</a>
    </header>
    <main id="readingContent" className="reading-content">
      {notice && <p className="notice error" role="alert">{notice}</p>}
      {route?.missing ? 'This article is no longer available.'
        : !article ? <p className="field-help">Loading…</p>
        : route?.kind === 'post' ? <><Card article={article} seen busy={busy} inThread actions={actions} />{Boolean((article.tweet as Record<string, any> | null)?.article?.title) && <div className="x-article-reader"><ArticleReader key={article.id} article={article} /></div>}<a className="thread-conversation" href={article.url} target="_blank" rel="noopener noreferrer">View conversation on X ↗</a></>
        : <ArticleReader key={article.id} article={article} />}
      {article && next && <button className="next-entry" onClick={onNext}><span>Next</span><b>{next.kind === 'x' ? String((next.tweet as Record<string, unknown> | null)?.name || next.source) : headline(next.title)}</b><span aria-hidden="true">→</span></button>}
    </main>
  </motion.section>;
}
