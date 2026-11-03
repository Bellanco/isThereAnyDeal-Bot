import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { once } from 'node:events';
import { expect, it } from 'vitest';
import { buildFaithfulPreview } from '../scripts/telegram-preview-fiel.mjs';
import { compilePreviewRuntime } from '../scripts/telegram-preview.mjs';
import { buildOfficialPreview, loadOfficialSpec } from '../scripts/telegram-preview-oficial.mjs';

// Opt-in real LOCAL browser, fresh empty profile, no browser package/install,
// accounts or server. All HTTP(S) is additionally blocked at the page boundary.
it.skipIf(!process.env.PREVIEW_BROWSER_PATH)('local Chromium: semantic DOM, responsive layout, URL inspection and banner fallback', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'itad-preview-browser-'));
  let browser, socket;
  const pending = new Map();
  let serial = 0;
  let closed;
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++serial;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  try {
    const runtime = await compilePreviewRuntime(temp);
    const faithful = buildFaithfulPreview(runtime);
    const official = buildOfficialPreview(runtime, await loadOfficialSpec());
    const files = [path.join(temp, 'faithful.html'), path.join(temp, 'official.html')];
    await writeFile(files[0], faithful.html, 'utf8');
    await writeFile(files[1], official.html, 'utf8');
    browser = spawn(process.env.PREVIEW_BROWSER_PATH, [
      '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${path.join(temp, 'profile')}`,
      '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
      '--disable-component-update', '--disable-sync', '--disable-extensions', '--disable-default-apps',
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost', 'about:blank',
    ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    closed = once(browser, 'exit');
    const endpoint = await new Promise((resolve, reject) => {
      let log = '';
      const timer = setTimeout(() => reject(new Error('browser_start_timeout')), 15_000);
      browser.once('error', error => { clearTimeout(timer); reject(error); });
      browser.stderr.on('data', data => {
        log += data;
        const match = log.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
    });
    const port = new URL(endpoint).port;
    const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
    await once(socket, 'open');
    const external = [];
    const failed = new Map();
    const responses = [];
    const intercepted = [];
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const task = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) task.reject(new Error(JSON.stringify(message.error)));
        else task.resolve(message.result);
      } else if (message.method === 'Network.requestWillBeSent' &&
          /^https?:/.test(message.params.request.url)) external.push({
        id: message.params.requestId, url: message.params.request.url,
      });
      else if (message.method === 'Network.loadingFailed') failed.set(message.params.requestId, message.params);
      else if (message.method === 'Network.responseReceived' &&
          /^https?:/.test(message.params.response.url)) responses.push(message.params.response.url);
      else if (message.method === 'Fetch.requestPaused') {
        intercepted.push(message.params.request.url);
        call('Fetch.failRequest', { requestId: message.params.requestId, errorReason: 'BlockedByClient' }).catch(() => {});
      }
    });
    await call('Page.enable');
    await call('Runtime.enable');
    await call('Network.enable');
    // Intercept before network as a safety net, without Network.setBlockedURLs:
    // that option reports "inspector" before CSP can be observed independently.
    await call('Fetch.enable', { patterns: [
      { urlPattern: 'http://*', requestStage: 'Request' },
      { urlPattern: 'https://*', requestStage: 'Request' },
    ] });
    // Compare semantic trees against the same HTML parsed by the browser.
    // Only role/tabindex on tg-button are local adapter additions.
    const tree = `(node)=>node.nodeType===3?node.textContent:node.nodeType!==1?null:{
      tag:node.tagName,attrs:[...node.attributes].filter(a=>!(node.tagName==='TG-BUTTON'&&['role','tabindex'].includes(a.name))).map(a=>[a.name,a.value]).sort(),
      children:[...node.childNodes].map(tree).filter(n=>n!==null)
    }`;
    const summaries = [];
    for (const [index, file] of files.entries()) {
      await call('Page.navigate', { url: pathToFileURL(file).href });
      for (let attempts = 0; attempts < 100; attempts++) {
        if (await evaluate(`document.readyState==='complete'&&!!document.querySelector('tg-button[role="link"]')`)) break;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      const expected = index === 0 ? faithful.groups.flatMap((part, i) => [part, faithful.fallback[i]]) : official.groups.flat();
      expect(await evaluate(`(()=>{
        const tree=${tree};
        const expected=${JSON.stringify(expected)}.map(html=>{const template=document.createElement('template');template.innerHTML=html;return [...template.content.childNodes].map(tree)});
        const actual=[...document.querySelectorAll('article.rich-card')].map(article=>[...article.childNodes].map(tree));
        return JSON.stringify(actual)===JSON.stringify(expected);
      })()`)).toBe(true);
      if (index === 0) {
        await evaluate(`document.querySelector('#banners').click()`);
        expect(await evaluate(`document.querySelector('#banners').checked`)).toBe(false);
        await evaluate(`document.querySelector('#banners').focus()`);
        await call('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
        await call('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
        expect(await evaluate(`document.querySelector('#banners').checked`)).toBe(true);
      }
      for (const width of [320, 390, 414, 1280]) {
        await call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 500 });
        for (const theme of ['light', 'dark']) {
          await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
          for (const banners of index === 0 ? [true, false] : [false]) {
            if (index === 0) await evaluate(`document.querySelector('#banners').checked=${banners}`);
            const result = await evaluate(`(()=>{
              const visible=[...document.querySelectorAll('article')].filter(a=>a.getBoundingClientRect().height>0);
              const buttons=visible.flatMap(a=>[...a.querySelectorAll('tg-button')]);
              const rect=e=>e.getBoundingClientRect();
              return {
                cards:visible.length,overflow:document.documentElement.scrollWidth>innerWidth,
                images:visible.reduce((n,a)=>n+a.querySelectorAll('img').length,0),
                placeholders:visible.filter(a=>a.querySelector('img')).every(a=>
                  getComputedStyle(a.querySelector('img')).visibility==='hidden'&&
                  getComputedStyle(a,'::before').content==='"Banner de ejemplo"'),
                rows:buttons.every(b=>b.parentElement.children.length===1&&Math.abs(rect(b).width-rect(b.parentElement).width)<1),
                separate:buttons.every((b,i)=>!i||rect(b).top>=rect(buttons[i-1]).bottom),
                contained:buttons.every(b=>b.scrollWidth<=b.clientWidth),
                markInline:visible.flatMap(a=>[...a.querySelectorAll('mark')]).every(m=>getComputedStyle(m).display==='inline'),
                headings:visible.flatMap(a=>[...a.querySelectorAll('h3')]).every(h=>getComputedStyle(h).fontSize==='17px'),
                footer:visible.flatMap(a=>[...a.querySelectorAll('footer')]).every(f=>getComputedStyle(f).fontSize==='12px'&&getComputedStyle(f).fontWeight==='400')
              };
            })()`);
            expect(result).toEqual({
              cards: index === 0 ? 3 : 2, overflow: false, images: banners ? 3 : 0,
              placeholders: true,
              rows: true, separate: true, contained: true, markInline: true, headings: true, footer: true,
            });
            summaries.push({ page: index === 0 ? 'faithful' : 'official', width, theme, banners });
            if (process.env.PREVIEW_SCREENSHOT_DIR && index === 0 &&
                ((width === 390 && theme === 'dark' && banners) ||
                 (width === 1280 && theme === 'light' && !banners))) {
              const clip = await evaluate(`(()=>{
                const r=document.querySelector('.examples').getBoundingClientRect();
                return {x:0,y:r.y+scrollY,width:innerWidth,height:r.height,scale:1};
              })()`);
              const shot = await call('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: true });
              await writeFile(path.join(process.env.PREVIEW_SCREENSHOT_DIR, `preview-${width}-${theme}.png`),
                Buffer.from(shot.data, 'base64'));
            }
          }
        }
      }
      if (index === 0) await evaluate(`document.querySelector('#banners').checked=true`);
      const url = await evaluate(`document.querySelector('tg-button').getAttribute('url')`);
      await evaluate(`document.querySelector('tg-button').click()`);
      expect(await evaluate(`document.querySelector('output').textContent`)).toBe(`URL sin abrir: ${url}`);
      for (const key of [
        { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 },
        { key: ' ', code: 'Space', windowsVirtualKeyCode: 32 },
      ]) {
        await evaluate(`document.querySelector('output').textContent='';document.querySelector('tg-button').focus()`);
        await call('Input.dispatchKeyEvent', { type: 'keyDown', ...key });
        await call('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
        expect(await evaluate(`document.querySelector('output').textContent`)).toBe(`URL sin abrir: ${url}`);
      }
      const link = await evaluate(`document.querySelector('.rich-card a')?.getAttribute('href')`);
      await evaluate(`document.querySelector('.rich-card a').click()`);
      expect(await evaluate(`document.querySelector('output').textContent`)).toBe(`URL sin abrir: ${link}`);
      expect(await evaluate('location.href')).toBe(pathToFileURL(file).href);
      // Open the raw HTML disclosure with a genuine mouse click.
      const point = await evaluate(`(()=>{const s=document.querySelector('details summary');s.scrollIntoView();const r=s.getBoundingClientRect();return {x:r.x+10,y:r.y+10}})()`);
      await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
      await call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
      expect(await evaluate(`document.querySelector('details').open`)).toBe(true);
    }
    // Chromium emits requestWillBeSent even for images rejected by CSP before
    // network I/O. Distinguish blocked attempts from actual responses.
    expect(responses).toEqual([]);
    expect(intercepted).toEqual([]);
    for (const request of external) {
      expect(failed.get(request.id)?.blockedReason).toBe('csp');
    }
    console.log(`Local browser approved: ${summaries.length} viewport/theme/banner combinations; exact semantic trees; ${external.length} image attempts blocked by CSP; zero HTTP(S) responses.`);
  } finally {
    if (socket?.readyState === WebSocket.OPEN) {
      await call('Browser.close').catch(() => {});
      socket.close();
    }
    if (browser && browser.exitCode === null) {
      await Promise.race([closed, new Promise(resolve => setTimeout(resolve, 5000))]);
      if (browser.exitCode === null) browser.kill();
    }
    if (closed) await closed;
    await rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
}, 60_000);
