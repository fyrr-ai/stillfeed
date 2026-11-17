import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {brotliCompressSync,brotliDecompressSync,gzipSync,gunzipSync,constants} from 'node:zlib';
import {serveStatic} from './static';

test('immutable bundles serve exact build-time Brotli and gzip bytes with the original type and cache policy',async()=>{
  const root=mkdtempSync(join(tmpdir(),'stillfeed-static-')),file='assets/build/prepared-'+crypto.randomUUID()+'.js',body=Buffer.from('export const text="'+ 'A practical article. '.repeat(3000)+'";');
  const br=brotliCompressSync(body,{params:{[constants.BROTLI_PARAM_QUALITY]:11}}),gzip=gzipSync(body,{level:9});
  try{
    mkdirSync(join(root,'assets/build'),{recursive:true});writeFileSync(join(root,file),body);writeFileSync(join(root,file+'.br'),br);writeFileSync(join(root,file+'.gz'),gzip);
    for(const [encoding,expected] of [['br',br],['gzip',gzip]] as const){
      const response=(await serveStatic(root,file,new Request('http://localhost/'+file,{headers:{'Accept-Encoding':encoding}})))!;
      expect(response.headers.get('Content-Encoding')).toBe(encoding);expect(response.headers.get('Content-Type')).toContain('javascript');expect(response.headers.get('Cache-Control')).toContain('immutable');
      expect(Buffer.from(await response.arrayBuffer()).equals(expected)).toBe(true);
      const unchanged=await serveStatic(root,file,new Request('http://localhost/'+file,{headers:{'If-None-Match':response.headers.get('ETag')!}}));expect(unchanged?.status).toBe(304);
    }
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('older bundles without sidecars retain readable compressed and uncompressed responses',async()=>{
  const root=mkdtempSync(join(tmpdir(),'stillfeed-static-')),file='assets/build/legacy-'+crypto.randomUUID()+'.js',body=Buffer.from('export default '+JSON.stringify('The original text. '.repeat(2000)));
  try{
    mkdirSync(join(root,'assets/build'),{recursive:true});writeFileSync(join(root,file),body);
    for(const encoding of ['br','gzip','identity']){
      const response=(await serveStatic(root,file,new Request('http://localhost/'+file,{headers:{'Accept-Encoding':encoding}})))!;
      const bytes=Buffer.from(await response.arrayBuffer());
      expect((encoding==='br'?brotliDecompressSync(bytes):encoding==='gzip'?gunzipSync(bytes):bytes).equals(body)).toBe(true);
    }
  }finally{rmSync(root,{recursive:true,force:true});}
});
