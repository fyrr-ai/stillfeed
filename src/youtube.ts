import { Innertube } from 'youtubei.js';

/** YouTube's channel RSS stopped answering (404), so channels are listed through YouTube's own web API. */
export const LATEST = 5;
export type Video = { url: string; guid: string; title: string; published_at: number; author: string; summary: string; content: string; image_url: string };
export type ChannelResult = { videos: Video[]; checked: string[]; error: string | null };

let client: Promise<Innertube> | undefined;
const youtube = () => client ??= Innertube.create({ retrieve_player: false });
const escape = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

/** The newest uploads of one channel. Only ids never checked before cost a metadata request; members-only,
 *  live and upcoming videos are skipped, and the channel keeps working when one video fails. */
export async function channelVideos(channelId: string, known: Set<string>, cutoff: number): Promise<ChannelResult> {
  const result: ChannelResult = { videos: [], checked: [], error: null };
  try {
    const yt = await youtube();
    const listing = await (await yt.getChannel(channelId)).getVideos();
    for (const item of (listing.videos as any[]).slice(0, LATEST)) {
      const id = String(item.content_id ?? item.video_id ?? item.id ?? '');
      if (!/^[\w-]{11}$/.test(id) || known.has(id)) continue;
      result.checked.push(id);
      if (/members only|members first/i.test(JSON.stringify(item.metadata ?? {}))) continue;
      try {
        const info: any = await yt.getBasicInfo(id);
        const micro = info.page?.[0]?.microformat, live = micro?.live_broadcast_details;
        const published = Date.parse(micro?.publish_date ?? '');
        if (!Number.isFinite(published) || published < cutoff || info.basic_info?.is_live || info.basic_info?.is_upcoming || (live?.start_timestamp && !live?.end_timestamp)) continue;
        const description = String(micro?.description?.toString?.() ?? info.basic_info?.short_description ?? '');
        result.videos.push({
          url: `https://www.youtube.com/watch?v=${id}`, guid: `yt:video:${id}`,
          title: String(info.basic_info?.title || 'Untitled video'), published_at: Math.floor(published / 1000),
          author: String(info.basic_info?.author ?? ''), summary: description.slice(0, 20000),
          content: description.split('\n\n').filter(p => p.trim()).map(p => `<p>${escape(p)}</p>`).join('').slice(0, 40000),
          image_url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
        });
      } catch { /* private or removed: skip this video, keep the channel */ }
    }
  } catch (error) { result.error = error instanceof Error ? `${error.name}: ${error.message.slice(0, 200)}` : 'YouTube listing failed'; }
  return result;
}

const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const unescape = (s: string) => s.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e: string) => e[0] === '#' ? String.fromCodePoint(parseInt(e.slice(e[1] === 'x' || e[1] === 'X' ? 2 : 1), e[1] === 'x' || e[1] === 'X' ? 16 : 10)) : entities[e.toLowerCase()] ?? m);

/** A video's captions as [start seconds, text]: English (manual before automatic) first, then any language.
 *  Returns null when the video has none. Uses the Android player API, which lists caption tracks without a login. */
export async function transcript(video: string): Promise<[number, string][] | null> {
  const page = await fetch(`https://www.youtube.com/watch?v=${video}`, { headers: { 'Accept-Language': 'en-US' }, signal: AbortSignal.timeout(20000) });
  const key = /"INNERTUBE_API_KEY":\s*"([\w-]+)"/.exec(await page.text())?.[1];
  if (!key) throw new Error('YouTube did not answer');
  const player = await (await fetch(`https://www.youtube.com/youtubei/v1/player?key=${key}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(20000),
    body: JSON.stringify({ context: { client: { clientName: 'ANDROID', clientVersion: '20.10.38' } }, videoId: video }) })).json() as any;
  const tracks: { baseUrl: string; languageCode: string; kind?: string }[] = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  const english = (t: { languageCode: string }) => /^en(-|$)/.test(t.languageCode);
  const track = tracks.find(t => english(t) && t.kind !== 'asr') ?? tracks.find(english) ?? tracks[0];
  if (!track) return null;
  const xml = await (await fetch(track.baseUrl.replace('&fmt=srv3', ''), { signal: AbortSignal.timeout(20000) })).text();
  if (!xml.trimStart().startsWith('<?xml') && !xml.includes('<transcript')) throw new Error('YouTube refused the transcript request');
  return [...xml.matchAll(/<text start="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g)]
    .map(([, start, text]) => [Math.round(Number(start)), unescape(unescape(text!)).replace(/<[^>]*>/g, '').trim()] as [number, string])
    .filter(([, text]) => text);
}
