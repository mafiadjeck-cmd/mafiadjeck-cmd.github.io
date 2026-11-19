(function (root) {
  'use strict';

  const programs = {
    basics: {
      title: { ru: 'Бухгалтерия с нуля · 3 в 1', ky: 'Бухгалтердик эсеп нөлдөн · 3 в 1' },
      description: { ru: 'Бухучёт, налоги и практические занятия в 1С. Для тех, кто начинает с нуля.', ky: 'Бухгалтердик эсеп, салыктар жана 1С боюнча практика. Жаңы баштагандар үчүн.' },
      format: 'onsite', duration: { ru: '1,5 месяца', ky: '1,5 ай' }, link: '#course'
    },
    singleTax: {
      title: { ru: 'Бухгалтер на едином налоге', ky: 'Бирдиктүү салык боюнча бухгалтер' },
      description: { ru: 'Живые занятия в Zoom, задания с обратной связью и записи уроков.', ky: 'Zoom аркылуу түз сабактар, мугалим текшере турган тапшырмалар жана сабактардын жазуулары.' },
      format: 'online', duration: { ru: '1 месяц', ky: '1 ай' }, link: 'https://www.instagram.com/p/DfldxuHRdwB/'
    },
    generalTax: {
      title: { ru: 'Общий режим, НДС и импорт', ky: 'Жалпы режим, КНС жана импорт' },
      description: { ru: 'Темы программы «Бухгалтерия 3 в 1» для тех, кто хочет вести учёт в более крупной компании.', ky: 'Ири компанияда эсеп жүргүзүүнү каалагандар үчүн «Бухгалтерия 3 в 1» программасынын темалары.' },
      duration: { ru: '1,5 месяца', ky: '1,5 ай' }, link: 'https://www.instagram.com/p/Dfqj9m9RUvC/'
    }
  };

  const teachers = {
    baktygul: { ru: 'Бактыгуль Омурзакова', ky: 'Бактыгүл Өмүрзакова' },
    asel: { ru: 'Асель Окенова', ky: 'Асель Окенова' },
    shohjahon: { ru: 'Шохжахон Мадаминов', ky: 'Шохжахон Мадаминов' }
  };
  const formats = {
    onsite: { ru: 'Очно, Бишкек', ky: 'Бишкекте, офлайн' },
    online: { ru: 'Онлайн', ky: 'Онлайн' }
  };

  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + 'T00:00:00Z');
    return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value;
  }

  function validGroup(group) {
    return group && Object.hasOwn(programs, group.program) &&
      Object.hasOwn(formats, group.format) && Object.hasOwn(teachers, group.teacher) &&
      validDate(group.start) && /^\d{1,7}$/.test(String(group.price)) && Number(group.price) > 0 &&
      typeof group.scheduleRu === 'string' && !!group.scheduleRu.trim() &&
      typeof group.scheduleKy === 'string' && !!group.scheduleKy.trim();
  }

  function todayInBishkek(now = new Date()) {
    const parts = new Intl.DateTimeFormat('ru', {
      timeZone: 'Asia/Bishkek', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(now);
    const part = type => parts.find(item => item.type === type).value;
    return [part('year'), part('month'), part('day')].join('-');
  }

  function upcoming(groups, now) {
    const today = todayInBishkek(now);
    return (Array.isArray(groups) ? groups : []).filter(
      group => group?.status === 'published' && validGroup(group) && group.start >= today
    ).sort((first, second) => first.start.localeCompare(second.start));
  }

  const api = { programs, teachers, formats, validGroup, upcoming };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PraktikumGroups = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
