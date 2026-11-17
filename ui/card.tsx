import { lazy, memo, Suspense, useRef, useState, type MouseEvent } from 'react';
const Lightbox = lazy(() => import('./lightbox'));
import { Icon, type IconName } from './icons';
import { t } from './i18n';
import { RichText } from './rich';
import { articleFormat, count, headline, link, relative, type Article } from './lib';

export type CardActions = {
  open: (article: Article, from: HTMLElement | null) => void;
  save: (article: Article, on: boolean) => void;
  opened: (id: string) => void;
  hint: (label: string | null, distance?: number, mode?: 'back' | 'pull') => void;
  error: (text: string) => void;
};

/** Tall attachments stop here; the full image is one tap away. */
const MEDIA_CAP = 280;
const activity = [
  ['replies', 'card.replies', 'reply'],
  ['reposts', 'card.reposts', 'repost'],
  ['likes', 'card.likes', 'like'],
] as const;

function Avatar({ name, src, className = '' }: { name: string; src: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  const hue = [...name].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 360, 0);
  return <span className={`avatar ${className}`} aria-hidden="true" style={{ '--hue': hue } as React.CSSProperties}>
    <span>{[...name][0]?.toUpperCase() || 'R'}</span>
    {src && !failed && <img src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />}
  </span>;
}

function Photos({ items }: { items: unknown }) {
  if (!Array.isArray(items) || !items.length) return null;
  const shown = items.slice(0, 4);
  return <div className={`photos photos-${shown.length}`}>{shown.map((m, i) => <Photo key={i} media={m} single={shown.length === 1} />)}</div>;
}

/** A photo opens full size in a dialog (loaded on the first tap); a video frame links to the original post. The lightbox stops
 *  its clicks so the card underneath does not open the thread. */
function Photo({ media, single }: { media: Record<string, unknown>; single: boolean }) {
  const [failed, setFailed] = useState(false);
  const [cropped, setCropped] = useState(false);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const src = link(media.src);
  const w = Number(media.w), h = Number(media.h);
  if (!src || failed) return null;
  const image = <img src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" style={w && h ? { aspectRatio: `${w}/${h}` } : undefined}
    onLoad={event => { const el = event.currentTarget; if (single && el.naturalWidth && el.naturalHeight / el.naturalWidth * el.clientWidth > MEDIA_CAP + 8) setCropped(true); }}
    onError={() => setFailed(true)} />;
  if (media.type !== 'photo') return <span className="photo photo-video">{image}<span className="play" aria-label={t('card.videoOnX')}><Icon name="video" size={22} /></span></span>;
  return <>
    <button ref={trigger} type="button" className={`photo${cropped ? ' photo-cropped' : ''}`} aria-label={t('card.viewImage')} aria-haspopup="dialog" onClick={event => { event.stopPropagation(); setOpen(true); }}>
      {image}
      {cropped && <span className="photo-more" aria-hidden="true"><Icon name="expand" size={13} />{t('card.viewImage')}</span>}
    </button>
    {open && <Suspense fallback={null}><Lightbox src={src} close={() => { setOpen(false); trigger.current?.focus(); }} /></Suspense>}
  </>;
}

/** Only a real picture earns a preview: a missing, failed or logo-sized image leaves no empty box. While it
 *  loads the frame is a deliberate skeleton with a stable aspect ratio, so the list does not jump. */
function Preview({ article }: { article: Article }) {
  const [image, setImage] = useState<'loading' | 'ok' | 'none'>('loading');
  if (image === 'none') return null;
  return <div className={`preview${image === 'ok' ? ' has-image' : ' preview-loading'}`}>
    {image === 'loading' && <Icon name="image" size={22} className="preview-glyph" />}
    <img className="hero-image" src={`/api/image/${article.id}/preview`} alt="" loading="lazy" decoding="async" onLoad={event => setImage(event.currentTarget.naturalWidth < 400 ? 'none' : 'ok')} onError={() => setImage('none')} />
  </div>;
}

const formatIcons: Record<string, IconName> = { article: 'article', video: 'video', reddit: 'reddit' };

export const Card = memo(function Card({ article, seen, busy, inThread = false, actions, showReason = false }: { article: Article; seen: boolean; busy: boolean; inThread?: boolean; actions: CardActions; showReason?: boolean }) {
  const tweet = article.tweet as Record<string, any> | null;
  const isX = article.kind === 'x';
  const format = articleFormat(article.url);
  const name = isX ? String(tweet?.name || tweet?.author || article.source) : article.source;
  const icon = isX ? link(tweet?.avatar) : `/api/image/${article.id}/icon`;
  const profile = isX && tweet?.author ? `https://x.com/${encodeURIComponent(String(tweet.author))}` : '';
  const openFrom = (event: MouseEvent<HTMLElement>) => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault(); actions.open(article, event.currentTarget);
  };
  const onCardClick = (event: MouseEvent<HTMLElement>) => {
    if (inThread || (event.target as Element).closest('a,button,[role=dialog]') || window.getSelection()?.toString()) return;
    actions.open(article, event.currentTarget);
  };
  const tweetId = String(tweet?.id || article.url.match(/\/status\/(\d+)/)?.[1] || '');
  const published = new Date(article.publishedAt);

  return <article className={`feed-card ${isX ? 'tweet' : 'article'}${seen ? ' seen' : ''}${inThread ? ' thread-root' : ''}`} data-id={article.id} data-url={article.url} onClick={onCardClick}>
    <div className="card-row">
    <Avatar name={name} src={icon} className={isX ? '' : 'source'} />
    <div className="card-body">
      {tweet?.kind === 'retweet' && <div className="reposted"><Icon name="repost" size={14} /> {t('card.reposted', { by: String(tweet.by) })}</div>}
      <header className="card-head">
        <div className="author-line">
          {profile ? <a className="author" href={profile} target="_blank" rel="noopener noreferrer">{name}</a> : <b className="author">{name}</b>}
          {isX ? (inThread ? <span className="format-badge format-x" aria-label={t('card.post')} title={t('card.post')}><Icon name="x" size={12} /></span>
              : <a className="format-badge format-x" href={`/post/${article.id}`} aria-label={t('card.openThread')} title={t('card.openThread')} onClick={openFrom}><Icon name="x" size={12} /></a>)
            : <span className={`format-badge format-article format-${format.kind}`} role="img" aria-label={format.label} title={format.label}><Icon name={formatIcons[format.kind] ?? 'article'} size={14} /></span>}
          <div className="post-meta">
            <time dateTime={published.toISOString()} title={published.toLocaleString()}>{relative(article.publishedAt)}</time>
            <span className="unseen-dot" role="img" aria-label={t('card.unseen')} title={t('card.unseen')} hidden={seen} />
          </div>
        </div>
        <button className="icon-button bookmark" aria-label={article.saved ? t('card.unsave') : t('card.save')} aria-pressed={article.saved} disabled={busy} aria-busy={busy || undefined} onClick={() => actions.save(article, !article.saved)}><Icon name="bookmark" size={17} /></button>
      </header>
      {showReason && article.personalReason && <aside className="card-note" aria-label={t('hot.why')}>
        <div><span className="card-note-label"><Icon name="flame" size={13} />{t('hot.why')}</span><p>{article.personalReason}</p></div>
      </aside>}
      {isX ? <>
        <div className="post-text" onClick={event => { if ((event.target as Element).closest('a')) actions.opened(article.id); }}><RichText text={tweet?.text || article.title} links={tweet?.links} drop={tweet?.drop} /></div>
        <Photos items={tweet?.media} />
        {tweet?.article?.title && <a className="x-article" href={link(tweet.article.url) || article.url} target="_blank" rel="noopener noreferrer" onClick={inThread ? () => actions.opened(article.id) : openFrom}>
          {link(tweet.article.image) && <img src={link(tweet.article.image)} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />}
          <span className="x-article-body"><small>{t('card.articleOnX')}{inThread && <Icon name="external" size={11} />}</small><b>{String(tweet.article.title)}</b>{tweet.article.preview && <span>{String(tweet.article.preview)}</span>}</span>
        </a>}
        {tweet?.quote && typeof tweet.quote === 'object' && <div className="quote"><b>{String(tweet.quote.name || tweet.quote.handle || '')}</b><div className="post-text"><RichText text={tweet.quote.text} links={tweet.quote.links} drop={tweet.quote.drop} /></div><Photos items={tweet.quote.media} /></div>}
        <footer className="post-footer">
          <div className="metrics" aria-label={t('card.activity')}>{activity.map(([key, labelKey, iconName]) => {
            const replies = key === 'replies', label = t(labelKey);
            const href = replies ? (inThread ? article.url : `/post/${article.id}`) : `https://x.com/intent/${key === 'likes' ? 'like' : 'retweet'}?tweet_id=${encodeURIComponent(tweetId)}`;
            const labelText = replies ? (inThread ? t('card.viewReplies') : t('card.openThread')) : t('card.openOnX', { label });
            return <a key={key} className={`metric metric-${key}`} href={href} target="_blank" rel="noopener noreferrer" aria-label={`${labelText}, ${count(tweet?.[key])}`} title={label} onClick={replies && !inThread ? openFrom : undefined}><Icon name={iconName} size={16} /><span>{count(tweet?.[key])}</span></a>;
          })}</div>
        </footer>
      </> : <a className="article-link" href={article.url} target="_blank" rel="noopener noreferrer" onClick={openFrom}><h2>{headline(article.title)}</h2><Preview article={article} /></a>}
    </div>
    </div>
  </article>;
});
