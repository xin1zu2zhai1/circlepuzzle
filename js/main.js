// 起動処理：画面を組み立て、共有 URL があればその問題を、なければ新しい問題を出す。

import { createApp } from './ui.js';

function boot() {
  const app = createApp();
  app.start(window.location.search);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
