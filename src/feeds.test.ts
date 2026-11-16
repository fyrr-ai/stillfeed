import {test,expect} from 'bun:test';
import {parseFeed,subscriptions} from './feeds';
const feed={id:'example',url:'https://example.com/feed',title:'Example',ai:1};
test('RSS normalizes GUID, content, author and media without losing the original HTML',async()=>{
 const xml=`<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>Test</title><link>https://example.com</link><item><guid>entry-1</guid><link>https://example.com/post</link><title>Models &amp; tools</title><dc:creator>Alice</dc:creator><pubDate>Sat, 14 Nov 2026 12:00:00 GMT</pubDate><content:encoded><![CDATA[<p>Hello <b>AI</b></p>]]></content:encoded><media:thumbnail url="https://cdn.example.com/hero.jpg" /></item></channel></rss>`;
 const [entry]=await parseFeed(xml,feed);expect(entry?.title).toBe('Models & tools');expect(entry?.summary).toBe('Hello AI');expect(entry?.content).toBe('<p>Hello <b>AI</b></p>');expect(entry?.author).toBe('Alice');expect(entry?.image_url).toBe('https://cdn.example.com/hero.jpg');expect(entry?.guid).toBe('entry-1');expect(entry?.trusted_ai).toBe(true);
});
test('Atom and JSON Feed share the same normalized model',async()=>{
 const atom=`<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom</title><entry><id>stable-id</id><title>Example</title><link href="https://example.com/atom"/><updated>2026-11-14T12:00:00Z</updated><content type="html">&lt;p&gt;A useful tool&lt;/p&gt;</content></entry></feed>`;
 expect((await parseFeed(atom,feed))[0]?.url).toBe('https://example.com/atom');
 const json=JSON.stringify({version:'https://jsonfeed.org/version/1.1',items:[{id:'stable-id',url:'https://example.com/json',title:'Tool',content_text:'Useful tool',image:'https://cdn.example.com/image.png',date_published:'2026-11-14T12:00:00Z'}]});
 const [entry]=await parseFeed(json,feed);expect(entry?.guid).toBe('stable-id');expect(entry?.summary).toBe('Useful tool');expect(entry?.image_url).toBe('https://cdn.example.com/image.png');
});
test('OPML seed is deduplicated and excludes the retired local X export',()=>{
 const rows=subscriptions('<opml><body><outline><outline title="A" ai="1" xmlUrl="https://example.com/feed"/><outline title="A" xmlUrl="https://example.com/feed"/><outline xmlUrl="http://127.0.0.1:3200/data/follows.xml"/></outline></body></opml>');expect(rows.length).toBe(1);
});

test('structured Atom authors normalize without aborting the whole feed',async()=>{
 const xml='<feed xmlns="http://www.w3.org/2005/Atom"><title>Research</title><entry><id>one</id><title>New model</title><link href="https://example.com/one"/><author><name>Alice</name><email>alice@example.com</email></author><updated>2026-11-14T12:00:00Z</updated><summary>Research update</summary></entry></feed>';
 const [entry]=await parseFeed(xml,feed);expect(entry?.author).toBe('Alice');expect(entry?.title).toBe('New model');
});
