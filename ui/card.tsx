import { memo, useState, type MouseEvent } from 'react';
import { RichText } from './rich';
import { articleBadge, count, headline, link, relative, type Article } from './lib';

export type CardActions = {
  open: (article: Article, from: HTMLElement | null) => void;
  save: (article: Article, on: boolean) => void;
  opened: (id: string) => void;
  hint: (label: string | null, distance?: number) => void;
  error: (text: string) => void;
};

const BookmarkIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4z" /></svg>;
const activity = [
  ['replies', 'Replies', <path key="r" d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5z" />],
  ['reposts', 'Reposts', <path key="p" d="m17 2 4 4-4 4M3 11V8a2 2 0 0 1 2-2h16M7 22l-4-4 4-4m14-1v3a2 2 0 0 1-2 2H3" />],
  ['likes', 'Likes', <path key="l" d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z" />],
] as const;

function Avatar({ name, src, className = '' }: { name: string; src: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  const hue = [...name].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 360, 0);
  return <span className={`avatar ${className}`} aria-hidden="true" style={{ '--hue': hue } as React.CSSProperties}>
    <span>{[...name][0]?.toUpperCase() || 'R'}</span>
    {src && !failed && <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />}
  </span>;
}

function Photos({ items }: { items: unknown }) {
  if (!Array.isArray(items) || !items.length) return null;
  return <div className={`photos photos-${Math.min(items.length, 4)}`}>{items.slice(0, 4).map((m, i) => <Photo key={i} media={m} />)}</div>;
}
function Photo({ media }: { media: Record<string, unknown> }) {
  const [failed, setFailed] = useState(false);
  return <span className="photo">
    {!failed && <img src={link(media.src)} alt="" loading="lazy" referrerPolicy="no-referrer" style={media.w && media.h ? { aspectRatio: `${Number(media.w)}/${Number(media.h)}` } : undefined} onError={() => setFailed(true)} />}
    {media.type !== 'photo' && <span className="play" aria-label="Video on original post">▶</span>}
  </span>;
}

/** Only a real picture earns a preview: a missing, failed or logo-sized image leaves no empty box (as on X). */
function Preview({ article }: { article: Article }) {
  const [image, setImage] = useState<'loading' | 'ok' | 'none'>('loading');
  if (image === 'none') return null;
  return <div className={`preview${image === 'ok' ? ' has-image' : ' preview-loading'}`}>
    <img className="hero-image" src={`/api/image/${article.id}/preview`} alt="" loading="lazy" decoding="async" onLoad={event => setImage(event.currentTarget.naturalWidth < 400 ? 'none' : 'ok')} onError={() => setImage('none')} />
  </div>;
}

export type CardNote = { label: string; text: string; onDismiss?: () => void };
export const Card = memo(function Card({ article, seen, busy, inThread = false, actions, note }: { article: Article; seen: boolean; busy: boolean; inThread?: boolean; actions: CardActions; note?: CardNote }) {
  const tweet = article.tweet as Record<string, any> | null;
  const isX = article.kind === 'x';
  const badge = articleBadge(article.url);
  const name = isX ? String(tweet?.name || tweet?.author || article.source) : article.source;
  const icon = isX ? link(tweet?.avatar) : `/api/image/${article.id}/icon`;
  const profile = isX && tweet?.author ? `https://x.com/${encodeURIComponent(String(tweet.author))}` : '';
  const openFrom = (event: MouseEvent<HTMLElement>) => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault(); actions.open(article, event.currentTarget);
  };
  const onCardClick = (event: MouseEvent<HTMLElement>) => {
    if (inThread || (event.target as Element).closest('a,button') || window.getSelection()?.toString()) return;
    actions.open(article, event.currentTarget);
  };
  const tweetId = String(tweet?.id || article.url.match(/\/status\/(\d+)/)?.[1] || '');
  const published = new Date(article.publishedAt);

  return <article className={`feed-card ${isX ? 'tweet' : 'article'}${seen ? ' seen' : ''}${inThread ? ' thread-root' : ''}`} data-id={article.id} data-url={article.url} onClick={onCardClick}>
    <div className="card-row">
    <Avatar name={name} src={icon} className={isX ? '' : 'source'} />
    <div className="card-body">
      {tweet?.kind === 'retweet' && <div className="reposted">↻ {String(tweet.by)} reposted</div>}
      <header className="card-head">
        <div className="author-line">
          {profile ? <a className="author" href={profile} target="_blank" rel="noopener noreferrer">{name}</a> : <b className="author">{name}</b>}
          {isX ? (inThread ? <span className="format-badge format-x" aria-label="Post from X">X</span> : <a className="format-badge format-x" href={`/post/${article.id}`} aria-label="Open thread" onClick={openFrom}>X</a>)
            : <span className={`format-badge format-article format-${badge.kind}`} aria-label={badge.label} title={badge.label}>{badge.letter}</span>}
          <div className="post-meta">
            <time dateTime={published.toISOString()} title={published.toLocaleString()}>{relative(article.publishedAt)}</time>
            <span className="unseen-dot" role="img" aria-label="Not seen" hidden={seen} />
          </div>
        </div>
        <button className="icon-button bookmark" aria-label={article.saved ? 'Remove from Saved' : 'Save for later'} aria-pressed={article.saved} disabled={busy} aria-busy={busy || undefined} onClick={() => actions.save(article, !article.saved)}><BookmarkIcon /></button>
      </header>
      {note && <aside className="card-note" lang="cs" aria-label={note.label}>
        <div><span className="card-note-label">{note.label}</span><p lang="cs">{note.text}</p></div>
        {note.onDismiss && <button className="icon-button card-note-dismiss" aria-label="Nezajímá mě" title="Nezajímá mě" onClick={note.onDismiss}>✕</button>}
      </aside>}
      {isX ? <>
        <div className="post-text" onClick={event => { if ((event.target as Element).closest('a')) actions.opened(article.id); }}><RichText text={tweet?.text || article.title} links={tweet?.links} drop={tweet?.drop} /></div>
        <Photos items={tweet?.media} />
        {tweet?.article?.title && <a className="x-article" href={link(tweet.article.url) || article.url} target="_blank" rel="noopener noreferrer" onClick={inThread ? () => actions.opened(article.id) : openFrom}>
          {link(tweet.article.image) && <img src={link(tweet.article.image)} alt="" loading="lazy" referrerPolicy="no-referrer" />}
          <span className="x-article-body"><small>{inThread ? 'Article on X ↗' : 'Article on X'}</small><b>{String(tweet.article.title)}</b>{tweet.article.preview && <span>{String(tweet.article.preview)}</span>}</span>
        </a>}
        {tweet?.quote && typeof tweet.quote === 'object' && <div className="quote"><b>{String(tweet.quote.name || tweet.quote.handle || '')}</b><div className="post-text"><RichText text={tweet.quote.text} links={tweet.quote.links} drop={tweet.quote.drop} /></div><Photos items={tweet.quote.media} /></div>}
        <footer className="post-footer">
          <div className="metrics" aria-label="Post activity">{activity.map(([key, label, iconPath]) => {
            const replies = key === 'replies';
            const href = replies ? (inThread ? article.url : `/post/${article.id}`) : `https://x.com/intent/${key === 'likes' ? 'like' : 'retweet'}?tweet_id=${encodeURIComponent(tweetId)}`;
            const labelText = replies ? (inThread ? 'View replies on X' : 'Open thread') : `Open ${label} on X`;
            return <a key={key} className={`metric metric-${key}`} href={href} target="_blank" rel="noopener noreferrer" aria-label={`${labelText}, ${count(tweet?.[key])}`} title={label} onClick={replies && !inThread ? openFrom : undefined}><svg viewBox="0 0 24 24" aria-hidden="true">{iconPath}</svg><span>{count(tweet?.[key])}</span></a>;
          })}</div>
        </footer>
      </> : <a className="article-link" href={article.url} target="_blank" rel="noopener noreferrer" onClick={openFrom}><h2>{headline(article.title)}</h2><Preview article={article} /></a>}
    </div>
    </div>
  </article>;
});
