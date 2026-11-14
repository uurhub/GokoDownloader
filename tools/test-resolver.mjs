import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { parseSrcset, upgradeUrl, buildCandidates } = await import(pathToFileURL(path.join(root, 'extension/lib/imageResolver.js')).href);
const { extractVideoId, isYouTubeVideoPage, thumbnailCandidates, canonicalWatchUrl } = await import(pathToFileURL(path.join(root, 'extension/lib/youtube.js')).href);

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log('PASS', name); }
  else { fail++; console.log('FAIL', name, '\n  got     ', a, '\n  expected', e); }
}
const first = (u) => upgradeUrl(u)[0];

// extractVideoId
const ID = 'dQw4w9WgXcQ';
for (const [u, exp] of [
  [`https://www.youtube.com/watch?v=${ID}&t=5s`, ID],
  [`https://m.youtube.com/watch?v=${ID}`, ID],
  [`https://music.youtube.com/watch?v=${ID}&list=x`, ID],
  [`https://www.youtube.com/shorts/${ID}?feature=share`, ID],
  [`https://www.youtube.com/live/${ID}`, ID],
  [`https://www.youtube.com/embed/${ID}`, ID],
  [`https://www.youtube.com/v/${ID}`, ID],
  [`https://youtu.be/${ID}?si=abc`, ID],
  [`https://www.youtube-nocookie.com/embed/${ID}`, ID],
  ['https://www.youtube.com/watch?v=short', null],
  ['https://www.youtube.com/feed/subscriptions', null],
  ['https://example.com/watch?v=' + ID, null],
]) check('extractVideoId ' + u, extractVideoId(u), exp);
check('isYouTubeVideoPage true', isYouTubeVideoPage(`https://youtu.be/${ID}`), true);
check('isYouTubeVideoPage false', isYouTubeVideoPage('https://www.youtube.com/'), false);
check('canonicalWatchUrl', canonicalWatchUrl(ID), `https://www.youtube.com/watch?v=${ID}`);
check('thumb jpg first', thumbnailCandidates(ID)[0], { url: `https://i.ytimg.com/vi/${ID}/maxresdefault.jpg`, name: 'maxresdefault', width: 1280, height: 720 });
check('thumb jpg len', thumbnailCandidates(ID).length, 4);
const tw = thumbnailCandidates(ID, 'webp');
check('thumb webp first', tw[0].url, `https://i.ytimg.com/vi_webp/${ID}/maxresdefault.webp`);
check('thumb webp fallback jpg', [tw.length, tw[4].url], [8, `https://i.ytimg.com/vi/${ID}/maxresdefault.jpg`]);

// parseSrcset
check('srcset basic', parseSrcset('a.jpg 1x, b.jpg 2x'), [{ url: 'a.jpg', w: 0, x: 1 }, { url: 'b.jpg', w: 0, x: 2 }]);
check('srcset cloudinary commas', parseSrcset('https://r.com/upload/w_300,h_200/a.jpg 300w, https://r.com/upload/w_600,h_400/a.jpg 600w').map((e) => [e.url, e.w]),
  [['https://r.com/upload/w_300,h_200/a.jpg', 300], ['https://r.com/upload/w_600,h_400/a.jpg', 600]]);
check('srcset no descriptor', parseSrcset('a.jpg').map((e) => e.url), ['a.jpg']);
check('srcset comma no space', parseSrcset('a.jpg 100w,b.jpg 200w').map((e) => e.url), ['a.jpg', 'b.jpg']);
check('srcset newline/ws', parseSrcset('\n a.jpg 1x ,\n b.jpg 2x\n').length, 2);
check('srcset empty', parseSrcset(''), []);

// upgradeUrl
check('twitter query', first('https://pbs.twimg.com/media/ABC?format=jpg&name=small'), 'https://pbs.twimg.com/media/ABC?format=jpg&name=orig');
check('twitter legacy', first('https://pbs.twimg.com/media/ABC.jpg:large'), 'https://pbs.twimg.com/media/ABC.jpg:orig');
check('wikimedia', first('https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Cat.jpg/300px-Cat.jpg'), 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Cat.jpg');
check('wikimedia thumb host svg', first('https://thumb.wikimedia.org/wikipedia/commons/thumb/5/5a/Scheme_cat_anatomy.svg/960px-Scheme_cat_anatomy.svg.png?utm_source=commons.wikimedia.org&utm_campaign=index&utm_content=thumbnail'), 'https://upload.wikimedia.org/wikipedia/commons/5/5a/Scheme_cat_anatomy.svg');
check('wikimedia thumb host jpg', first('https://thumb.wikimedia.org/wikipedia/en/thumb/a/ab/Cat.jpg/250px-Cat.jpg?utm_source=en.wikipedia.org&utm_content=thumbnail'), 'https://upload.wikimedia.org/wikipedia/en/a/ab/Cat.jpg');
check('google =w', first('https://lh3.googleusercontent.com/abc123=w400-h300-no'), 'https://lh3.googleusercontent.com/abc123=s0');
check('google =s', first('https://lh3.googleusercontent.com/abc123=s220'), 'https://lh3.googleusercontent.com/abc123=s0');
check('google path', first('https://lh3.googleusercontent.com/a/b/c/s220/photo.jpg'), 'https://lh3.googleusercontent.com/a/b/c/s0/photo.jpg');
check('ggpht', first('https://yt3.ggpht.com/xyz=s88-c-k-c0x00ffffff-no-rj'), 'https://yt3.ggpht.com/xyz=s0');
check('ytimg', upgradeUrl('https://i.ytimg.com/vi/ID12345678A/hqdefault.jpg?sqp=abc'),
  ['https://i.ytimg.com/vi/ID12345678A/maxresdefault.jpg', 'https://i.ytimg.com/vi/ID12345678A/sddefault.jpg', 'https://i.ytimg.com/vi/ID12345678A/hqdefault.jpg']);
check('ytimg webp hq720', first('https://i.ytimg.com/vi_webp/ID12345678A/hq720.webp'), 'https://i.ytimg.com/vi_webp/ID12345678A/maxresdefault.webp');
check('pinterest', upgradeUrl('https://i.pinimg.com/236x/ab/cd/ef/hash.jpg'), ['https://i.pinimg.com/originals/ab/cd/ef/hash.jpg', 'https://i.pinimg.com/originals/ab/cd/ef/hash.png']);
check('shopify suffix', first('https://cdn.shopify.com/s/files/1/0/0/products/shirt_grande.jpg?v=123'), 'https://cdn.shopify.com/s/files/1/0/0/products/shirt.jpg?v=123');
check('shopify dims', first('https://cdn.shopify.com/s/files/1/products/shirt_600x400@2x.jpg'), 'https://cdn.shopify.com/s/files/1/products/shirt.jpg');
check('shopify width param', first('https://cdn.shopify.com/s/files/shirt.jpg?v=1&width=300'), 'https://cdn.shopify.com/s/files/shirt.jpg?v=1');
check('wordpress', first('https://x.com/wp-content/uploads/2020/01/pic-300x200.jpg'), 'https://x.com/wp-content/uploads/2020/01/pic.jpg');
check('wordpress scaled', upgradeUrl('https://x.com/wp-content/uploads/pic-scaled-300x200.jpg'), ['https://x.com/wp-content/uploads/pic-scaled.jpg', 'https://x.com/wp-content/uploads/pic.jpg']);
check('wikia', first('https://static.wikia.nocookie.net/foo/images/a/ab/Img.png/revision/latest/scale-to-width-down/300?cb=1'), 'https://static.wikia.nocookie.net/foo/images/a/ab/Img.png/revision/latest?cb=1');
check('wikia smart', first('https://static.wikia.nocookie.net/foo/images/a/ab/Img.png/revision/latest/smart/width/200/height/200?cb=1'), 'https://static.wikia.nocookie.net/foo/images/a/ab/Img.png/revision/latest?cb=1');
check('imgur', first('https://i.imgur.com/AbCdEfGm.jpg'), 'https://i.imgur.com/AbCdEfG.jpg');
check('imgur untouched', upgradeUrl('https://i.imgur.com/AbCdEfG.jpg'), []);
check('reddit preview', first('https://preview.redd.it/abc123.jpg?width=640&s=sig'), 'https://i.redd.it/abc123.jpg');
check('unsplash', first('https://images.unsplash.com/photo-1?w=400&h=300&q=80&fit=crop&ixid=KEEP'), 'https://images.unsplash.com/photo-1?ixid=KEEP');
check('cloudinary', first('https://res.cloudinary.com/demo/image/upload/w_300,h_200,c_fill/v123/sample.jpg'), 'https://res.cloudinary.com/demo/image/upload/v123/sample.jpg');
check('cloudinary chained', first('https://res.cloudinary.com/demo/image/upload/f_auto/q_auto/sample.jpg'), 'https://res.cloudinary.com/demo/image/upload/sample.jpg');
check('cloudinary folder kept', upgradeUrl('https://res.cloudinary.com/demo/image/upload/my_folder/sample.jpg'), []);
check('generic params', first('https://cdn.example.com/a.jpg?w=300&h=200&id=7'), 'https://cdn.example.com/a.jpg?id=7');
check('generic all stripped', first('https://cdn.example.com/a.jpg?width=300'), 'https://cdn.example.com/a.jpg');
check('amazon', first('https://m.media-amazon.com/images/I/71abc._AC_SX300_.jpg'), 'https://m.media-amazon.com/images/I/71abc.jpg');
check('amazon SL', first('https://images-na.ssl-images-amazon.com/images/I/71abc._SL500_.png'), 'https://images-na.ssl-images-amazon.com/images/I/71abc.png');
check('bing', first('https://th.bing.com/th/id/OIP.abc123?w=200&h=100&c=7&rs=1&qlt=90'), 'https://th.bing.com/th/id/OIP.abc123');
check('signed untouched', upgradeUrl('https://cdn.example.com/a.jpg?w=300&sig=abc'), []);
check('amz signed untouched', upgradeUrl('https://b.s3.amazonaws.com/a.jpg?w=1&X-Amz-Signature=abc'), []);
check('instagram untouched', upgradeUrl('https://scontent.cdninstagram.com/v/a.jpg?stp=dst-jpg_s150x150&oh=1&oe=2'), []);
check('fbcdn untouched', upgradeUrl('https://scontent.xx.fbcdn.net/v/a.jpg?w=100'), []);
check('redditmedia untouched', upgradeUrl('https://styles.redditmedia.com/t5_1/styles/icon.png?width=256'), []);
check('invalid url', upgradeUrl('not a url'), []);

// buildCandidates
const bc = buildCandidates({
  src: 'https://x.com/wp-content/uploads/p-300x200.jpg',
  currentSrc: 'https://x.com/wp-content/uploads/p-600x400.jpg',
  srcset: 'https://x.com/wp-content/uploads/p-300x200.jpg 300w, https://x.com/wp-content/uploads/p-1200x800.jpg 1200w',
  sources: [], dataAttrs: { 'data-orig-file': 'https://x.com/wp-content/uploads/p.jpg' },
  parentHref: 'https://x.com/gallery/full.png?v=1', bgImage: null,
});
check('build parentHref first', bc[0], 'https://x.com/gallery/full.png?v=1');
check('build data attr second', bc[1], 'https://x.com/wp-content/uploads/p.jpg');
check('build dedup', new Set(bc).size, bc.length);
check('build cap', bc.length <= 12, true);
check('build ignores non-image parent', buildCandidates({ src: 'https://a.com/x.jpg', parentHref: 'https://a.com/page.html' }), ['https://a.com/x.jpg']);
check('build variant before base', buildCandidates({ src: 'https://pbs.twimg.com/media/A?format=jpg&name=small' }), ['https://pbs.twimg.com/media/A?format=jpg&name=orig', 'https://pbs.twimg.com/media/A?format=jpg&name=small']);
check('build srcset largest', buildCandidates({ srcset: 'https://a.com/1.jpg 1x, https://a.com/3.jpg 3x', src: 'https://a.com/1.jpg' })[0], 'https://a.com/3.jpg');
check('build data uri skipped', buildCandidates({ src: 'data:image/gif;base64,AAA', dataAttrs: { 'data-src': 'https://a.com/real.jpg' } }), ['https://a.com/real.jpg']);
check('build data uri fallback', buildCandidates({ src: 'data:image/gif;base64,AAA' }), ['data:image/gif;base64,AAA']);
check('build empty', buildCandidates({}), []);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
