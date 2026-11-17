import { useEffect, useRef, useState } from 'react';
import { Drawer, DrawerBackdrop, DrawerClose, DrawerContent, DrawerDescription, DrawerTitle } from '@ui-sdk/react/drawer';
import { Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger } from '@ui-sdk/react/popover';
import { AssistantRuntimeProvider, ComposerPrimitive, MessagePrimitive, ThreadPrimitive, useExternalStoreRuntime, type AppendMessage, type ThreadMessageLike } from '@assistant-ui/react';
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown';
import type { ChatContext, ChatMessage } from '../src/chat';
import { api } from './lib';
import { Icon } from './icons';
import { t, type Key } from './i18n';

type Conversation = { id: string; label: string; count: number; messages: ChatMessage[]; ai: {provider: string; model: string} | null; sources: {id: string; title: string; kind: string}[] };
const textOf = (m: AppendMessage) => m.content.filter(p => p.type === 'text').map(p => p.text).join('\n');
function UserMessage() { return <MessagePrimitive.Root className="chat-message chat-user"><MessagePrimitive.Parts /></MessagePrimitive.Root>; }
function AssistantMessage() { return <MessagePrimitive.Root className="chat-message chat-assistant"><MessagePrimitive.Parts components={{ Text: () => <MarkdownTextPrimitive smooth={false} /> }} /></MessagePrimitive.Root>; }

function Conversation({ context, navigate }: { context: ChatContext; navigate: (id: string) => void }) {
  const [data, setData] = useState<Conversation | null>(null), [error, setError] = useState(''), [sending, setSending] = useState(false);
  const [reload, setReload] = useState(0);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const failedSend = useRef<{id: string; text: string} | null>(null);
  const running = sending || Boolean(data?.messages.some(m => m.state === 'queued' || m.state === 'working'));
  const latest = useRef(data); latest.current = data;
  useEffect(() => {
    let disposed = false, timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = latest.current ? await api<Conversation>(`/api/chat/${latest.current.id}`) : await api<Conversation>('/api/chat', {context});
        if (!disposed) { setData(next); if (!failedSend.current) setError(''); }
      } catch (e) { if (!disposed) setError(e instanceof Error ? e.message : t('chat.failed')); }
      if (!disposed) timer = setTimeout(poll, 1500);
    }
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, [context, reload]);
  async function send(value: {id: string; text: string}) {
    if (!data) return;
    setSending(true); setError(''); failedSend.current = value;
    try { setData(await api<Conversation>(`/api/chat/${data.id}/messages`, value)); failedSend.current = null; }
    catch (e) { setError(e instanceof Error ? e.message : t('chat.failed')); }
    finally { setSending(false); }
  }
  async function action(kind: 'cancel' | 'clear' | 'retry') {
    if (!data) return;
    try { setData(await api<Conversation>(`/api/chat/${data.id}/${kind}`, {})); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : t('chat.failed')); }
  }
  const runtime = useExternalStoreRuntime({
    messages: data?.messages.filter(m => m.text) ?? [],
    convertMessage: (m: ChatMessage): ThreadMessageLike => ({id: m.id, role: m.role, content: m.text}),
    isRunning: running, isLoading: !data, isDisabled: !data?.ai,
    onNew: async (message: AppendMessage) => { await send({id: crypto.randomUUID().replaceAll('-', ''), text: textOf(message)}); },
    onCancel: () => action('cancel'),
  });
  const last = data?.messages.at(-1);
  const suggestions: Key[] = context.kind === 'article' ? ['chat.explain', 'chat.critique'] : ['chat.important', 'chat.connections'];
  const scope = context.kind === 'article' ? data?.sources[0]?.kind === 'x' ? t('chat.thisPost') : t('chat.thisArticle') : context.kind === 'hot' ? t('tabs.hot') : data?.label === 'Saved' ? t('tabs.saved') : t('chat.batch');
  const contextLabel = context.kind === 'article' ? data?.label || t('chat.loading') : t('chat.itemCount', {n: data?.count ?? 0});
  return <AssistantRuntimeProvider runtime={runtime}>
    <div className="chat-context">
      <Popover>
        <PopoverTrigger className="chat-context-trigger" aria-label={t('chat.context')}>
          <Icon name={context.kind === 'article' ? 'article' : 'inbox'} size={16} />
          <span><b>{scope}</b><small>{contextLabel}</small></span><Icon name="chevron" size={15} />
        </PopoverTrigger>
        <PopoverContent className="popover chat-context-popover" side="bottom" align="start" sideOffset={6}>
          <PopoverTitle className="popover-title">{scope}</PopoverTitle>
          <PopoverDescription className="popover-text">{contextLabel}</PopoverDescription>
          {context.kind === 'article' && <button className="ghost-button" onClick={() => navigate(context.id)}>{t('chat.openSource')}<Icon name="next" size={15} /></button>}
        </PopoverContent>
      </Popover>
      <Popover open={optionsOpen} onOpenChange={setOptionsOpen}>
        <PopoverTrigger className="icon-button" aria-label={t('chat.options')}><Icon name="more" size={18} /></PopoverTrigger>
        <PopoverContent className="popover chat-options" side="bottom" align="end" sideOffset={6}>
          <PopoverTitle className="popover-title">{t('chat.options')}</PopoverTitle>
          <PopoverDescription className="popover-text">{data?.ai ? `${data.ai.provider} · ${data.ai.model}` : t('chat.off')}</PopoverDescription>
          <button className="ghost-button" disabled={!data?.messages.length || running} onClick={() => { setOptionsOpen(false); void action('clear'); }}><Icon name="trash" size={15} />{t('chat.new')}</button>
        </PopoverContent>
      </Popover>
    </div>
    <ThreadPrimitive.Root className="chat-thread">
      <ThreadPrimitive.Viewport className="chat-scroll" onClick={event => {
        const anchor = (event.target as Element).closest('a');
        const match = /^\/(?:article|post)\/([a-f0-9]{32})$/.exec(anchor?.getAttribute('href') || '');
        if (match) { event.preventDefault(); navigate(match[1]!); }
        else if (anchor) { anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; }
      }}>
        {data && !data.messages.length && <div className="chat-welcome"><h2>{context.kind === 'article' ? t('chat.articleQuestion') : t('chat.feedQuestion')}</h2><p>{t('chat.intro')}</p>
          {data.ai && <div className="chat-suggestions">{suggestions.map(key => <button className="secondary-button" key={key} onClick={() => runtime.thread.append(t(key))}>{t(key)}</button>)}</div>}
        </div>}
        {!data && !error && <p className="field-help">{t('chat.loading')}</p>}
        {data && !data.ai && <p className="field-help">{t('chat.off')}</p>}
        <ThreadPrimitive.Messages components={{UserMessage, AssistantMessage}} />
        {running && <p className="chat-pending" role="status"><Icon name="refresh" size={14} className="spinning" />{t('chat.thinking')}</p>}
        {last?.state === 'failed' && <div className="chat-error" role="alert"><p>{last.error || t('chat.failed')}</p><button className="secondary-button" onClick={() => void action('retry')}>{t('feed.retry')}</button></div>}
        {last?.state === 'cancelled' && <p className="field-help">{t('chat.stopped')}</p>}
      </ThreadPrimitive.Viewport>
      {error && <div className="chat-error" role="alert"><p>{error}</p><button className="secondary-button" onClick={() => failedSend.current ? void send(failedSend.current) : setReload(n => n + 1)}>{t('feed.retry')}</button></div>}
      <ComposerPrimitive.Root className="chat-composer">
        <ComposerPrimitive.Input aria-label={t('chat.question')} placeholder={t('chat.placeholder')} maxLength={8000} rows={1} autoFocus={false} />
        {running ? <ComposerPrimitive.Cancel className="icon-button" disabled={sending} aria-label={t('chat.stop')}><Icon name="close" size={18} /></ComposerPrimitive.Cancel> : <ComposerPrimitive.Send className="icon-button" aria-label={t('chat.send')}><Icon name="up" size={18} /></ComposerPrimitive.Send>}
      </ComposerPrimitive.Root>
    </ThreadPrimitive.Root>
  </AssistantRuntimeProvider>;
}

export function ChatPanel({ open, context, close, settled, navigate, returnFocus }: { open: boolean; context: ChatContext; close: () => void; settled: () => void; navigate: (id: string) => void; returnFocus: string }) {
  return <Drawer side="right" open={open} onOpenChange={value => { if (!value) close(); }} onOpenChangeComplete={value => { if (!value) settled(); }}>
    <DrawerBackdrop className="side-backdrop chat-backdrop" />
    <DrawerContent id="chatPanel" className="chat-panel" initialFocus="content" finalFocus={() => document.getElementById(returnFocus)}>
      <header className="chat-header"><DrawerTitle>{t('chat.title')}</DrawerTitle><DrawerClose className="icon-button" aria-label={t('chat.close')}><Icon name="close" /></DrawerClose></header>
      <DrawerDescription className="sr-only">{t('chat.description')}</DrawerDescription>
      {open && <Conversation key={JSON.stringify(context)} context={context} navigate={navigate} />}
    </DrawerContent>
  </Drawer>;
}
