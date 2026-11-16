import {test,expect} from 'bun:test';
import {extract} from './reader';
test('reader extracts article text and images, resolves relative links and strips active content',()=>{
 const paragraphs=Array.from({length:8},(_,i)=>`<p>Research report ${i}. Researchers released a useful open model today. This explains its design, training data and evaluation in detail. <a href="details">Read the methodology.</a></p>`).join('');
 const result=extract(`<html><head><title>New open model</title></head><body><nav>Navigation</nav><article><h1>New open model</h1>${paragraphs}<img src="../photo.png" onerror="alert(1)"><script>alert(1)</script><a href="javascript:alert(1)">Bad</a><iframe src="https://evil.test"></iframe></article></body></html>`,'https://example.com/blog/story');
 expect(result.title).toContain('New open model');expect(result.text).toContain('Researchers');expect(result.html).toContain('https://example.com/photo.png');expect(result.html).toContain('https://example.com/blog/details');expect(result.html).not.toMatch(/onerror|<script|javascript:|<iframe/);
});
test('reader reports unreadable pages instead of caching an empty article',()=>{expect(()=>extract('<html><body>Login</body></html>','https://example.com')).toThrow('does not provide');});

import {youtubeId,isReddit,transcriptReading,feedReading} from './reader';
test('video and Reddit links are recognised',()=>{
  expect(youtubeId('https://www.youtube.com/watch?v=Sjdvu4nHfDk')).toBe('Sjdvu4nHfDk');
  expect(youtubeId('https://youtu.be/Sjdvu4nHfDk')).toBe('Sjdvu4nHfDk');
  expect(youtubeId('https://www.youtube.com/shorts/yVaVR2Ywfik')).toBe('yVaVR2Ywfik');
  expect(youtubeId('https://example.com/watch?v=x')).toBeNull();
  expect(isReddit('https://www.reddit.com/r/LocalLLaMA/comments/1')).toBe(true);
});
test('a transcript becomes timestamped, escaped paragraphs of about 90 seconds',()=>{
  const r=transcriptReading('abc','Talk','Channel','https://www.youtube.com/watch?v=abc',[[0,'Hello <b>world</b>'],[30,'more'],[95,'next part'],[200,'  ']]);
  expect(r.html).toBe('<p><a href="https://www.youtube.com/watch?v=abc&amp;t=0s" target="_blank" rel="noopener noreferrer">0:00</a> Hello &lt;b&gt;world&lt;/b&gt; more</p><p><a href="https://www.youtube.com/watch?v=abc&amp;t=95s" target="_blank" rel="noopener noreferrer">1:35</a> next part</p>');
  expect(r.text).toBe('Hello <b>world</b> more\n\nnext part');
  expect(()=>transcriptReading('abc','T','C','u',[])).toThrow();
});
test('feed content is a sanitized fallback only when it has enough text',()=>{
  const r=feedReading({title:'Post',author:'/u/me',url:'https://www.reddit.com/r/x/comments/1',content:'<p>'+'Useful text. '.repeat(10)+'</p><script>alert(1)</script>'});
  expect(r?.html.includes('<script')).toBe(false);expect(r?.text.startsWith('Useful text.')).toBe(true);
  expect(feedReading({title:'Short',url:'u',content:'<p>too short</p>'})).toBeNull();
});
