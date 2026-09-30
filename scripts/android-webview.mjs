// Local-only debug helper. Forward the app's webview_devtools_remote_<pid> to 9223.
// No credentials or browser storage are dumped; evaluate only the supplied expression.
const pages = await (await fetch('http://127.0.0.1:9223/json', { signal: AbortSignal.timeout(5000) })).json();
const page = pages.find(p => p.url?.includes('tauri.localhost') || p.title === 'LomifyNEXT');
if (!page) throw new Error('LomifyNEXT WebView not found');
const socket = new WebSocket(page.webSocketDebuggerUrl);
const timer = setTimeout(() => { console.error('WebView timed out'); process.exit(1); }, 20000);
const method = process.argv[2] === '--method' ? process.argv[3] : 'Runtime.evaluate';
const params = method !== 'Runtime.evaluate' ? JSON.parse(process.argv[4] || '{}') : {
  expression: process.argv[2] || 'JSON.stringify({width:innerWidth,height:innerHeight,text:document.body.innerText})',
  returnByValue: true, awaitPromise: true
};
socket.addEventListener('open', () => socket.send(JSON.stringify({ id: 1, method, params })));
socket.addEventListener('message', e => {
  const result = JSON.parse(e.data);
  if (result.id !== 1) return;
  console.log(JSON.stringify(result.result || result.error, null, 2));
  clearTimeout(timer);
  socket.close();
});
