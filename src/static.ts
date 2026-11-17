import { brotliCompressSync, constants } from 'node:zlib';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

/** Immutable bundles use build-time compression. Other assets use a fast fallback, cached in memory.
 *  Content-hashed bundles in assets/build never change, so browsers keep them for a year without asking. */
type Bytes = Uint8Array<ArrayBuffer>;
type Entry = { body: Bytes; br: Bytes | null; gzip: Bytes | null; etag: string; type: string; mtime: number };
const cache = new Map<string, Entry>();
const COMPRESSIBLE = /^(text\/|application\/(javascript|json|manifest\+json)|image\/svg\+xml)/;
const TYPES: Record<string, string> = { webmanifest: 'application/manifest+json', js: 'text/javascript;charset=utf-8', html: 'text/html;charset=utf-8', css: 'text/css;charset=utf-8' };

export function cacheControl(file: string) {
  if (file.startsWith('assets/build/')) return 'public, max-age=31536000, immutable';
  if (file.startsWith('assets/fonts/') || file.startsWith('assets/icons/')) return 'public, max-age=604800';
  return 'no-cache';
}

export async function serveStatic(root: string, file: string, request: Request): Promise<Response | null> {
  const handle = Bun.file(join(root, file));
  if (!await handle.exists()) return null;
  const mtime = handle.lastModified;
  let entry = cache.get(file);
  if (!entry || entry.mtime !== mtime) {
    const body = new Uint8Array(await handle.arrayBuffer());
    const type = TYPES[file.split('.').pop()!] ?? handle.type;
    const small = body.byteLength < 1024 || !COMPRESSIBLE.test(type);
    const precompressed=file.startsWith('assets/build/')&&file.endsWith('.js');
    const brFile=Bun.file(join(root,file+'.br')),gzipFile=Bun.file(join(root,file+'.gz'));
    const br=small?null:precompressed&&await brFile.exists()?new Uint8Array(await brFile.arrayBuffer()):new Uint8Array(brotliCompressSync(body,{params:{[constants.BROTLI_PARAM_QUALITY]:4}}));
    const gzip=small?null:precompressed&&await gzipFile.exists()?new Uint8Array(await gzipFile.arrayBuffer()):new Uint8Array(Bun.gzipSync(body,{level:6}));
    entry = { body, type, mtime, etag: `"${createHash('sha1').update(body).digest('base64url').slice(0, 20)}"`,
      br, gzip };
    cache.set(file, entry);
  }
  const headers: Record<string, string> = { 'Content-Type': entry.type, 'Cache-Control': cacheControl(file), ETag: entry.etag, 'X-Content-Type-Options': 'nosniff', Vary: 'Accept-Encoding' };
  if (request.headers.get('If-None-Match') === entry.etag) return new Response(null, { status: 304, headers });
  const accepts = request.headers.get('Accept-Encoding') ?? '';
  if (entry.br && /\bbr\b/.test(accepts)) return new Response(entry.br, { headers: { ...headers, 'Content-Encoding': 'br' } });
  if (entry.gzip && /\bgzip\b/.test(accepts)) return new Response(entry.gzip, { headers: { ...headers, 'Content-Encoding': 'gzip' } });
  return new Response(entry.body, { headers });
}
