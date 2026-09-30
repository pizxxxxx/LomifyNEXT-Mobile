// Debug emulator only. Exercises visible mobile controls without reading account data.
import assert from 'node:assert/strict';

const pages = await (await fetch('http://127.0.0.1:9223/json', { signal: AbortSignal.timeout(5000) })).json();
const page = pages.find(item => item.url?.includes('tauri.localhost'));
assert(page, 'LomifyNEXT WebView not found');
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});
let id = 0;
const pending = new Map();
socket.addEventListener('message', event => {
  const reply = JSON.parse(event.data);
  pending.get(reply.id)?.(reply);
  pending.delete(reply.id);
});
async function evaluate(expression) {
  const requestId = ++id;
  const response = new Promise((resolve, reject) => {
    pending.set(requestId, resolve);
    setTimeout(() => {
      if (!pending.has(requestId)) return;
      pending.delete(requestId);
      reject(new Error(`WebView timed out: ${expression.slice(0, 80)}`));
    }, 12000);
  });
  socket.send(JSON.stringify({ id: requestId, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
  const result = await response;
  assert(!result.error && !result.result?.exceptionDetails, JSON.stringify(result.error || result.result?.exceptionDetails));
  return result.result.result.value;
}
const nav = label => evaluate(`[...document.querySelectorAll('.mobile-nav button')].find(b=>b.textContent.includes(${JSON.stringify(label)})).click()`);
try {
  if (await evaluate(`!!document.querySelector('.mobile-player:not(.expanded)')`)) {
    if (await evaluate(`!!document.querySelector('.mobile-now-panel')`)) {
      await evaluate(`document.querySelector('.mobile-now-header button').click()`);
      await evaluate(`new Promise(resolve => setTimeout(resolve, 500))`);
    }
    assert.equal(await evaluate(`document.querySelectorAll('.mobile-now-panel').length`), 0);
    await evaluate(`document.querySelector('.mobile-player:not(.expanded) .mobile-mini-info').click()`);
    assert(await evaluate(`new Promise(resolve => setTimeout(() => resolve(document.querySelectorAll('.mobile-now-panel').length === 1), 80))`));
    await evaluate(`document.querySelector('.mobile-now-header button').click()`);
    assert(await evaluate(`new Promise(resolve => setTimeout(() => resolve(document.querySelectorAll('.mobile-now-panel').length === 0), 500))`));
    console.log('PASS player panel is removed after closing, no offscreen ghost');
  }
  await nav('Медиатека');
  assert(await evaluate(`!!document.querySelector('.mobile-profile-card')`));
  assert(await evaluate(`!!document.querySelector('.mobile-library button[aria-label="Создать плейлист"]')`));
  await evaluate(`document.querySelector('.mobile-library button[aria-label="Создать плейлист"]').click()`);
  assert(await evaluate(`!!document.querySelector('#mobile-playlist-name')`));
  await evaluate(`document.querySelector('.mobile-library button[aria-label="Создать плейлист"]').click()`);
  console.log('PASS mobile profile and create-playlist form');

  if (await evaluate(`!!document.querySelector('.mobile-library .mobile-mini-info')`)) {
    await evaluate(`(async()=>{const row=document.querySelector('.mobile-library .mobile-mini-info');row.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:1,pointerType:'touch',clientX:50,clientY:100}));await new Promise(r=>setTimeout(r,530));row.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:1,pointerType:'touch',clientX:50,clientY:100}));return true})()`);
    assert(await evaluate(`document.querySelector('.mobile-track-dialog')?.open === true`));
    assert(await evaluate(`document.querySelector('.mobile-track-dialog')?.textContent.includes('Не показывать больше')`));
    await evaluate(`document.querySelector('.mobile-track-dialog button[aria-label="Закрыть меню трека"]').click()`);
    assert(await evaluate(`document.querySelector('.mobile-track-dialog')?.open === false`));
    console.log('PASS long-press track menu and close');
    assert(await evaluate(`(()=>{const row=document.querySelector('.mobile-library .mobile-mini-info');row.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:2,pointerType:'touch',clientX:50,clientY:100}));window.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:2,pointerType:'touch',clientX:50,clientY:100}));row.addEventListener('click',e=>e.stopImmediatePropagation(),{once:true,capture:true});const click=new MouseEvent('click',{bubbles:true,cancelable:true});row.dispatchEvent(click);return !click.defaultPrevented})()`));
    console.log('PASS first tap after hold is not swallowed');
  }

  await nav('Настройки');
  const selectedSource = await evaluate(`document.querySelector('.mobile-source-options[aria-label="Источник музыки и Моей волны"] button[aria-pressed="true"]')?.textContent.trim()`);
  assert(selectedSource === 'SoundCloud' || selectedSource === 'Яндекс');
  await nav('Главная');
  assert.equal(await evaluate(`document.querySelectorAll('.mobile-wave-shortcut').length`), 1);
  assert(await evaluate(`document.querySelector('.mobile-wave-shortcut strong')?.textContent === 'Моя волна'`));
  assert(await evaluate(`document.querySelector('.mobile-wave-shortcut small')?.textContent === ${JSON.stringify(selectedSource === 'SoundCloud' ? 'SOUNDCLOUD' : 'ЯНДЕКС МУЗЫКА')}`));
  await evaluate(`document.querySelector('.mobile-wave-shortcut').click()`);
  assert(await evaluate(`document.querySelector('.mobile-wave-page h1')?.textContent === 'Моя волна'`));
  assert(await evaluate(`document.querySelector('.mobile-wave-kicker span')?.textContent === ${JSON.stringify(selectedSource === 'SoundCloud' ? 'SOUNDCLOUD' : 'ЯНДЕКС МУЗЫКА')}`));
  assert(await evaluate(`window.__TAURI_INTERNALS__.invoke('audio_visualizer_set_enabled',{enabled:true}).then(()=>true)`));
  await evaluate(`window.__TAURI_INTERNALS__.invoke('audio_visualizer_set_enabled',{enabled:false})`);
  console.log('PASS single selected-source Wave screen and Android FFT command');

  await nav('Настройки');
  assert.equal(await evaluate(`document.querySelectorAll('.mobile-accent-option').length`), 13);
  assert(await evaluate(`!!document.querySelector('input[aria-label="Сдвиг текста в миллисекундах"]')`));
  assert(await evaluate(`document.documentElement.scrollWidth === innerWidth`));
  console.log('PASS PC theme palette, lyrics offset and no horizontal overflow');
  await evaluate(`[...document.querySelectorAll('.mobile-setting-link')].find(b=>b.textContent.includes('Эквалайзер')).click()`);
  assert.equal(await evaluate(`document.querySelectorAll('.mobile-eq-band').length`), 10);
  assert(await evaluate(`document.documentElement.scrollWidth === innerWidth`));
  await evaluate(`[...document.querySelectorAll('.mobile-eq-presets button')].find(b=>b.textContent.includes('Бас')).click()`);
  assert(await evaluate(`document.querySelector('.mobile-equalizer input[role="switch"]').checked`));
  assert(await evaluate(`document.querySelector('.mobile-eq-presets button[aria-pressed="true"]').textContent.includes('Бас')`));
  await evaluate(`[...document.querySelectorAll('.mobile-eq-presets button')].find(b=>b.textContent.includes('Ровно')).click()`);
  assert.equal(await evaluate(`document.querySelector('.mobile-equalizer input[role="switch"]').checked`), false);
  console.log('PASS equalizer preset switching, flat bypass and layout');
} finally {
  socket.close();
}
