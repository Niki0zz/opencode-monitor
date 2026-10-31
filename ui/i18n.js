'use strict';

(function () {
  const translations = {
    en: {
      'app.sub': 'usage',
      'limits.title': 'Go limits',
      'limits.rolling': 'Rolling',
      'limits.weekly': 'Weekly',
      'limits.monthly': 'Monthly',
      'limits.empty': 'no data',
      'limits.limited': 'limit reached · ',
      'ranges.today': 'Today',
      'ranges.7d': '7 days',
      'ranges.30d': '30 days',
      'hero.spend': 'spend',
      'hero.estimate': 'estimate',
      'hero.tokens': 'tokens',
      'stats.input': 'input',
      'stats.output': 'output',
      'stats.cache': 'cache',
      'stats.sessions': 'sessions',
      'tabs.models': 'Models',
      'tabs.activity': 'Activity',
      'models.empty': 'No data for this period yet',
      'models.messages': '{n} msgs',
      'models.messagesOne': '{n} msg',
      'models.tokens': '{n} tokens',
      'models.tokensOne': '{n} token',
      'models.ofLimit': '{p}% monthly',
      'models.ofBudget': 'of {limit}',
      'models.free': 'free',
      'activity.empty': 'No activity',
      'activity.untitled': 'Untitled',
      'footer.console': 'Console ↗',
      'footer.updated': 'updated {time}',
      'footer.offline': 'collector offline',
      'reset.soon': 'reset imminent',
      'reset.in': 'reset in {h} h {m} min',
      'reset.at': 'reset {date} {time}',
      'banner.db': 'OpenCode database not found. Start OpenCode once, or set OPENCODE_DB.',
      'banner.limits': 'Go limits are unavailable: {error}',
      'banner.offline': 'Cannot reach the local collector. Restart OpenCode Monitor.',
      'banner.demo': 'Demo mode: sample data',
      'notify.title': '{level}: Go limit',
      'notify.warning': 'Warning',
      'notify.critical': 'Critical',
      'notify.body': '{name} at {percent}%',
      'title.pin': 'Always on top',
      'title.mini': 'Mini mode',
      'title.expand': 'Expand',
      'title.close': 'Hide to tray',
      'title.console': 'Open OpenCode Console',
    },
    ru: {
      'app.sub': 'расход',
      'limits.title': 'Ограничения Go',
      'limits.rolling': 'Rolling',
      'limits.weekly': 'Weekly',
      'limits.monthly': 'Monthly',
      'limits.empty': 'нет данных',
      'limits.limited': 'лимит исчерпан · ',
      'ranges.today': 'Сегодня',
      'ranges.7d': '7 дней',
      'ranges.30d': '30 дней',
      'hero.spend': 'расход',
      'hero.estimate': 'оценка',
      'hero.tokens': 'токенов',
      'stats.input': 'вход',
      'stats.output': 'выход',
      'stats.cache': 'кеш',
      'stats.sessions': 'сессий',
      'tabs.models': 'Модели',
      'tabs.activity': 'Активность',
      'models.empty': 'Пока нет данных за этот период',
      'models.messages': '{n} сообщ.',
      'models.messagesOne': '{n} сообщ.',
      'models.tokens': '{n} токенов',
      'models.tokensOne': '{n} токен',
      'models.ofLimit': '{p}% за месяц',
      'models.ofBudget': 'из {limit}',
      'models.free': 'бесплатно',
      'activity.empty': 'Нет активности',
      'activity.untitled': 'Без названия',
      'footer.console': 'Console ↗',
      'footer.updated': 'обновлено {time}',
      'footer.offline': 'нет связи с коллектором',
      'reset.soon': 'сброс вот-вот',
      'reset.in': 'сброс через {h} ч {m} мин',
      'reset.at': 'сброс {date} {time}',
      'banner.db': 'База OpenCode не найдена. Запустите OpenCode или задайте OPENCODE_DB.',
      'banner.limits': 'Лимиты Go недоступны: {error}',
      'banner.offline': 'Нет связи с локальным коллектором. Перезапустите OpenCode Monitor.',
      'banner.demo': 'Демо-режим: тестовые данные',
      'notify.title': '{level}: лимит Go',
      'notify.warning': 'Внимание',
      'notify.critical': 'Критично',
      'notify.body': '{name}: {percent}%',
      'title.pin': 'Поверх других окон',
      'title.mini': 'Мини-режим',
      'title.expand': 'Развернуть',
      'title.close': 'Скрыть в трей',
      'title.console': 'Открыть OpenCode Console',
    },
  };

  const params = new URLSearchParams(location.search);
  const requested = params.get('lang');
  const detected = (requested || navigator.language || 'en').toLowerCase();
  const lang = detected.startsWith('ru') ? 'ru' : 'en';
  const locale = lang === 'ru' ? 'ru-RU' : 'en-US';
  const messages = translations[lang];

  function t(key, vars) {
    let text = messages[key] || translations.en[key] || key;
    if (vars) {
      for (const [name, value] of Object.entries(vars)) {
        text = text.replace(new RegExp('\\{' + name + '\\}', 'g'), String(value));
      }
    }
    return text;
  }

  function apply(root) {
    const scope = root || document;
    for (const el of scope.querySelectorAll('[data-i18n]')) {
      el.textContent = t(el.getAttribute('data-i18n'));
    }
    for (const el of scope.querySelectorAll('[data-i18n-title]')) {
      const value = t(el.getAttribute('data-i18n-title'));
      el.title = value;
      el.setAttribute('aria-label', value);
    }
    document.documentElement.lang = lang;
  }

  window.I18N = { lang, locale, t, apply };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => apply());
  } else {
    apply();
  }
})();
