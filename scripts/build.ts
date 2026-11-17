import { rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import {brotliCompressSync,constants} from 'node:zlib';

/** Builds the UI: code-split, content-hashed bundles in assets/build (cached forever by the server) and
 *  index.html from ui/index.html with the stylesheet inlined, the entry and its chunks preloaded. */
const root = join(import.meta.dir, '..'), out = join(root, 'assets/build');
rmSync(out, { recursive: true, force: true });
const result = await Bun.build({
  entrypoints: [join(root, 'ui/main.tsx')], outdir: out, target: 'browser', splitting: true, minify: true,
  naming: { entry: '[name]-[hash].[ext]', chunk: 'chunk-[hash].[ext]' },
  define: { 'process.env.NODE_ENV': '"production"' },
});
if (!result.success) { for (const log of result.logs) console.error(log); process.exit(1); }
// Hash-named bundles are immutable: compress them at build time, never on a reader's request.
for(const output of result.outputs){
  if(!output.path.endsWith('.js')||output.size<1024)continue;
  const body=new Uint8Array(await output.arrayBuffer());
  await Bun.write(output.path+'.br',brotliCompressSync(body,{params:{[constants.BROTLI_PARAM_QUALITY]:11}}));
  await Bun.write(output.path+'.gz',Bun.gzipSync(body,{level:9}));
}
const url = (path: string) => '/' + relative(root, path);
const entry = result.outputs.find(o => o.kind === 'entry-point')!;
// Only the chunks the entry imports statically are needed for the first paint; lazy ones load later.
const text = await entry.text();
// Static imports look like `from"./chunk-x.js"` or `import"./chunk-x.js"`; lazy ones are `import("./chunk-x.js")`.
const eager = result.outputs.filter(o => o.kind === 'chunk' && new RegExp(`(from|import)\\s*["']\\./${o.path.split('/').pop()!.replace('.', '\\.')}["']`).test(text));
const css = (await Bun.file(join(root, 'assets/styles.css')).text()).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s*\n\s*/g, '\n').trim();
const early = await Bun.build({entrypoints:[join(root,'ui/early.ts')],target:'browser',minify:true});
if(!early.success)throw new Error('Could not build the initial feed request');
const earlyScript = (await early.outputs[0]!.text()).replace(/<\/script/gi,'<\\/script');
const head = [
  `<script>(()=>{${earlyScript}})();</script>`,
  `<link rel="preload" href="/assets/fonts/geist-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>`,
  ...eager.map(o => `<link rel="modulepreload" href="${url(o.path)}">`),
  `<style>${css}</style>`,
  `<script type="module" src="${url(entry.path)}"></script>`,
].join('\n  ');
const html = (await Bun.file(join(root, 'ui/index.html')).text()).replace('<!-- build -->', head);
await Bun.write(join(root, 'index.html'), html);
const sizes = result.outputs.map(o => `${relative(root, o.path)} ${(o.size / 1024).toFixed(1)} KB`);
console.log(sizes.join('\n'));
