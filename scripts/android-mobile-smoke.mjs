// Requires the app's debug WebView forwarded to localhost:9223. No credentials read.
import assert from 'node:assert/strict';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const pages = await (await fetch('http://127.0.0.1:9223/json', { signal: AbortSignal.timeout(5000) })).json();
const page = pages.find(p => p.url?.includes('tauri.localhost'));
assert(page, 'LomifyNEXT WebView not found');
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
let id = 0;
const pending = new Map();
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
});
async function evaluate(expression, method = 'Runtime.evaluate', params) {
  const requestId = ++id;
  let timeout;
  const reply = new Promise((resolve, reject) => {
    pending.set(requestId, resolve);
    timeout = setTimeout(() => { pending.delete(requestId); reject(new Error('WebView response timed out')); }, 10000);
  });
  socket.send(JSON.stringify({ id: requestId, method, params: params || { expression, returnByValue: true, awaitPromise: true } }));
  try {
    const response = await reply;
    assert(!response.error && !response.result?.exceptionDetails, JSON.stringify(response.error || response.result?.exceptionDetails));
    return method === 'Runtime.evaluate' ? response.result.result.value : response.result;
  } finally { clearTimeout(timeout); }
}
async function until(expression, timeout = 25000) {
  const start = Date.now();
  while (!(await evaluate(expression))) {
    assert(Date.now() - start < timeout, `Timed out: ${expression}`);
    await sleep(250);
  }
}
const nav = label => evaluate(`[...document.querySelectorAll('.mobile-nav button')].find(b=>b.textContent.includes(${JSON.stringify(label)})).click()`);
try {
  await nav('Настройки');
  await until(`!!document.querySelector('.mobile-preference-card')`);
  assert.equal(await evaluate(`document.querySelectorAll('.mobile-accent-option').length`), 13);
  assert.equal(await evaluate(`document.querySelectorAll('.mobile-settings select').length`), 0);
  assert(await evaluate(`document.documentElement.scrollWidth === innerWidth`), 'Page overflows horizontally');
  await evaluate(`window.__smokeSettingsPane = document.querySelector('.mobile-pane:not([hidden])'); window.__smokeSettingsPane.scrollTop = 180`);
  const scroll = await evaluate(`window.__smokeSettingsPane.scrollTop`);
  await nav('Главная');
  await nav('Настройки');
  assert.equal(await evaluate(`document.querySelector('.mobile-pane:not([hidden])') === window.__smokeSettingsPane`), true);
  assert.equal(await evaluate(`window.__smokeSettingsPane.scrollTop`), scroll);
  console.log('PASS settings palette, no native selects, retained tab DOM and scroll');
  await nav('Главная');
  await evaluate(`document.querySelector('.mobile-wave-shortcut').click()`);
  await until(`!!document.querySelector('.mobile-wave-page')`);
  await sleep(300);
  assert(await evaluate(`document.querySelector('.mobile-wave-page h1').textContent === 'Моя волна' && document.documentElement.scrollWidth === innerWidth`));
  if (await evaluate(`document.querySelector('.mobile-wave-play').textContent.includes('Подключить')`)) {
    await evaluate(`document.querySelector('.mobile-wave-play').click()`);
    await until(`document.querySelector('.mobile-service-card.is-yandex')?.open === true && !document.querySelector('.mobile-settings').closest('.mobile-pane').hidden`);
    assert(await evaluate(`document.querySelector('#mobile-yandex-token').type === 'password' && document.querySelector('.is-yandex .mobile-connection-steps').textContent.includes('Ваш токен готов')`));
    console.log('PASS My Wave separate screen and direct guided Yandex setup');
  } else {
    await evaluate(`document.querySelector('.mobile-header button[aria-label="Назад"]').click()`);
    await until(`!document.querySelector('.mobile-wave-page')`);
    await nav('Настройки');
    console.log('PASS My Wave screen and back (live account playback intentionally not started)');
  }
  await evaluate(`document.querySelector('.mobile-service-card.is-soundcloud').open = true`);
  if (await evaluate(`!!document.querySelector('#mobile-sc-profile')`)) {
    await evaluate(`{ const profile=document.querySelector('#mobile-sc-profile'); profile.value='https://example.com/not-a-profile'; profile.dispatchEvent(new Event('input',{bubbles:true})); }`);
    await sleep(30);
    await evaluate(`document.querySelector('#mobile-sc-profile').form.requestSubmit()`);
    await until(`document.querySelector('#mobile-sc-error').textContent.includes('Нужна ссылка на профиль')`);
    await evaluate(`{ const profile=document.querySelector('#mobile-sc-profile'); profile.value=''; profile.dispatchEvent(new Event('input',{bubbles:true})); }`);
  }
  assert(await evaluate(`document.querySelector('.is-soundcloud .mobile-security-note').textContent.includes('Пароль и токен SoundCloud не нужны')`));
  assert(await evaluate(`document.documentElement.scrollWidth === innerWidth`));
  console.log('PASS SoundCloud instructions and invalid-profile rejection');
  await evaluate('', 'Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  assert(await evaluate(`matchMedia('(prefers-reduced-motion: reduce)').matches`));
  assert(await evaluate(`parseFloat(getComputedStyle(document.querySelector('.mobile-nav-indicator')).transitionDuration) < .001`));
  await evaluate('', 'Emulation.setEmulatedMedia', { features: [] });
  console.log('PASS reduced-motion media preference');

  await nav('Поиск');
  await until(`!!document.querySelector('.search-command input')`);
  await evaluate(`window.__smokeSearch = document.querySelector('.search-command input'); window.__smokeSearch.value = 'Miyagi'; window.__smokeSearch.dispatchEvent(new Event('input', {bubbles:true}))`);
  const started = Date.now();
  await until(`document.querySelectorAll('.search-track-list .track-row-card').length > 0`, 35000);
  const rows = await evaluate(`document.querySelectorAll('.search-track-list .track-row-card').length`);
  await nav('Настройки'); await nav('Поиск');
  assert(await evaluate(`document.querySelector('.search-command input') === window.__smokeSearch && window.__smokeSearch.value === 'Miyagi'`));
  assert.equal(await evaluate(`document.querySelectorAll('.search-track-list .track-row-card').length`), rows);
  console.log(`PASS search results (${rows} rows in ${Date.now() - started} ms), input/result retention`);

  await nav('Медиатека');
  await until(`!!document.querySelector('.mobile-library .mobile-mini-info')`);
  await evaluate(`document.querySelector('.mobile-library .mobile-mini-info').click()`);
  await until(`window.__TAURI_INTERNALS__.invoke('audio_is_playing')`, 45000);
  const position = await evaluate(`window.__TAURI_INTERNALS__.invoke('audio_get_position')`);
  await sleep(800);
  assert((await evaluate(`window.__TAURI_INTERNALS__.invoke('audio_get_position')`)) > position);
  await evaluate(`document.querySelector('.mobile-player:not(.expanded) .mobile-mini-info').click()`);
  await sleep(350);
  assert(await evaluate(`!!document.querySelector('.mobile-now-panel') && document.querySelector('.mobile-content').inert`));
  await evaluate(`{ const seek=document.querySelector('.mobile-seek input'); seek.value='20'; seek.dispatchEvent(new Event('input',{bubbles:true})); }`);
  assert.equal(await evaluate(`document.querySelector('.mobile-time span').textContent`), '0:20');
  await evaluate(`document.querySelector('.mobile-seek input').dispatchEvent(new Event('change',{bubbles:true}))`);
  await sleep(300);
  assert((await evaluate(`window.__TAURI_INTERNALS__.invoke('audio_get_position')`)) >= 19);
  await evaluate(`document.querySelector('.mobile-now-panel button[aria-label="Свернуть плеер"]').click()`);
  await sleep(500);
  assert(await evaluate(`!document.querySelector('.mobile-now-panel') && !document.querySelector('.mobile-content').inert && document.activeElement?.getAttribute('aria-label')?.startsWith('Открыть плеер')`));
  console.log('PASS native playback, advancing position, seek, panel focus and close');
} finally {
  // Leave the emulator quiet, on the redesigned settings screen.
  await evaluate(`document.querySelector('.mobile-player:not(.expanded) button[aria-label="Пауза"]')?.click(); delete window.__smokeSettingsPane; delete window.__smokeSearch`).catch(() => {});
  await sleep(300);
  await nav('Настройки').catch(() => {});
  await evaluate(`document.querySelector('.mobile-pane:not([hidden])')?.scrollTo({top:0})`).catch(() => {});
  socket.close();
}
