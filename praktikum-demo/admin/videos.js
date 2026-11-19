(function (root) {
  'use strict';

  function replaceVideos(doc, entries) {
    const visible = [];
    for (const entry of entries) {
      if (entry.status !== 'published') continue;
      const title = entry.title.trim();
      const video = root.PraktikumVideoUrl.parseVideoUrl(entry.url);
      if (!title || !video) throw new Error('Укажите название и ссылку на YouTube, MP4 или WebM для каждого видео, которое будет видно на сайте.');
      visible.push({ title, titleKy: entry.titleKy?.trim() || '', url: video.href, status: 'published', video });
    }

    doc.querySelector('#videos')?.remove();
    const menu = doc.querySelector('#mainMenu');
    menu.querySelector('a[href="#videos"]')?.closest('li').remove();
    if (!visible.length) return [];

    const node = (tag, className, text) => {
      const element = doc.createElement(tag);
      if (className) element.className = className;
      if (text) element.textContent = text;
      return element;
    };
    const languages = (element, ru, ky) => {
      element.append(node('span','i18n ru',ru), node('span','i18n ky',ky));
      return element;
    };
    const link = (className, href, ru, ky) => {
      const element = languages(node('a',className),ru,ky);
      element.href = href;
      element.target = '_blank';
      element.rel = 'noopener noreferrer';
      return element;
    };

    const item = node('li');
    const menuLink = languages(node('a'),'Видео','Видеолор');
    menuLink.setAttribute('href','#videos');
    item.append(menuLink);
    const reviewsLink = menu.querySelector('a[href="#reviews"]');
    menu.insertBefore(item,reviewsLink?.closest('li') || null);

    const section = node('section','video-section');
    section.id = 'videos';
    section.setAttribute('aria-labelledby','video-heading');
    const container = node('div','container');
    const head = node('div','section-head');
    const heading = languages(node('h2','eyebrow-title'),'Видео','Видеолор');
    heading.id = 'video-heading';
    head.append(heading);
    const grid = node('div','video-grid');

    visible.forEach(({ title, titleKy, video }, index) => {
      const card = node('article','video-card');
      const frame = node('div','video-frame');
      const titleId = 'video-title-' + index;
      const play = link('video-play',video.href,'Смотреть','Көрүү');
      const icon = node('span','video-play-icon');
      icon.setAttribute('aria-hidden','true');
      play.prepend(icon);
      play.setAttribute('aria-describedby',titleId);
      frame.append(play);

      const template = node('template');
      const player = node(video.kind === 'youtube' ? 'iframe' : 'video');
      player.setAttribute('src', video.src);
      if (video.kind === 'youtube') {
        player.setAttribute('title',title);
        player.setAttribute('referrerpolicy','strict-origin-when-cross-origin');
        player.setAttribute('allow','autoplay; encrypted-media; picture-in-picture; fullscreen');
        player.setAttribute('allowfullscreen','');
      } else {
        player.setAttribute('aria-labelledby',titleId);
        player.setAttribute('controls','');
        player.setAttribute('playsinline','');
        player.setAttribute('autoplay','');
        player.setAttribute('preload','none');
      }
      template.content.append(player);

      const details = node('div','video-details');
      const cardTitle = languages(node('h3'),title,titleKy || title);
      cardTitle.id = titleId;
      const onYouTube = video.kind === 'youtube';
      details.append(cardTitle,link('video-source',video.href,onYouTube ? 'Открыть на YouTube' : 'Открыть видео',onYouTube ? 'YouTube’дан ачуу' : 'Видеону ачуу'));
      card.append(frame,template,details);
      grid.append(card);
    });

    container.append(head,grid);
    section.append(container);
    doc.querySelector('#reviews').before(section);
    return visible.map(({ video, ...entry }) => entry);
  }

  root.PraktikumVideoEditor = { replaceVideos };
})(typeof globalThis !== 'undefined' ? globalThis : window);
