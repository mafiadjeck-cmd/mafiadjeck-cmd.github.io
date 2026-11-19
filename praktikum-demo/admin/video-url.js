'use strict';
const youtubeHosts = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);
const embedHosts = new Set(['youtube-nocookie.com', 'www.youtube-nocookie.com']);
const youtubeId = /^[A-Za-z0-9_-]{11}$/;

function parseVideoUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;

  if (url.hostname === 'instagram.com' || url.hostname === 'www.instagram.com') {
    const match = url.pathname.match(/^\/(p|reel)\/([A-Za-z0-9_-]{5,32})\/?$/);
    if (!match) return null;
    const href = 'https://www.instagram.com/' + match[1] + '/' + match[2] + '/';
    return { kind: 'instagram', src: href + 'embed/', href };
  }

  let id;
  if (url.hostname === 'youtu.be') {
    id = url.pathname.split('/').at(1);
  } else if (youtubeHosts.has(url.hostname)) {
    id = url.pathname === '/watch'
      ? url.searchParams.get('v')
      : url.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)\/?$/)?.[1];
  } else if (embedHosts.has(url.hostname)) {
    id = url.pathname.match(/^\/embed\/([^/]+)\/?$/)?.[1];
  } else if (/\.(mp4|webm)$/i.test(url.pathname)) {
    return { kind: 'file', src: url.href, href: url.href };
  }

  if (!youtubeId.test(id ?? '')) return null;
  return {
    kind: 'youtube',
    src: 'https://www.youtube-nocookie.com/embed/' + id + '?autoplay=1&playsinline=1',
    href: 'https://www.youtube.com/watch?v=' + id,
  };
}

globalThis.PraktikumVideoUrl = { parseVideoUrl };
