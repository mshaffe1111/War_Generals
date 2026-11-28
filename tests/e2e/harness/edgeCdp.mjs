import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

export const DEFAULT_EDGE_PATH =
  process.env.WAR_GENERALS_EDGE_PATH ||
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

export const VIEWPORT_PRESETS = Object.freeze({
  MOBILE_PORTRAIT: Object.freeze({
    name: 'MOBILE_PORTRAIT',
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
    hasTouch: true,
  }),
  MOBILE_LANDSCAPE: Object.freeze({
    name: 'MOBILE_LANDSCAPE',
    width: 844,
    height: 390,
    deviceScaleFactor: 2,
    mobile: true,
    hasTouch: true,
  }),
  DESKTOP_LAPTOP: Object.freeze({
    name: 'DESKTOP_LAPTOP',
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
    hasTouch: false,
  }),
  DESKTOP_WIDE: Object.freeze({
    name: 'DESKTOP_WIDE',
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
    hasTouch: false,
  }),
});

const KEY_DEFS = {
  Space: { key: ' ', code: 'Space', text: ' ', windowsVirtualKeyCode: 32 },
  ' ': { key: ' ', code: 'Space', text: ' ', windowsVirtualKeyCode: 32 },
  Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
  Enter: { key: 'Enter', code: 'Enter', text: '\r', windowsVirtualKeyCode: 13 },
  Tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 },
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getKeyPayload(key) {
  if (KEY_DEFS[key]) {
    return KEY_DEFS[key];
  }
  const upper = key.length === 1 ? key.toUpperCase() : key;
  const vk = upper.length === 1 ? upper.charCodeAt(0) : 0;
  return {
    key,
    code: key.length === 1 && /[a-z]/i.test(key) ? `Key${upper}` : key,
    text: key.length === 1 ? key : undefined,
    windowsVirtualKeyCode: vk,
  };
}

/**
 * Launches headless Microsoft Edge and returns a zero-dependency Node 26 native WebSocket CDP driver.
 *
 * @param {{ swiftshader?: boolean, edgePath?: string, profileRootDir?: string }} [opts]
 */
export async function launchEdgeBrowser(opts = {}) {
  const {
    swiftshader = false,
    edgePath = DEFAULT_EDGE_PATH,
    profileRootDir = path.resolve(process.cwd(), 'test-results', 'e2e', '_edge_profiles'),
  } = opts;

  if (!fs.existsSync(edgePath)) {
    throw new Error(
      `Microsoft Edge executable not found at "${edgePath}". Set WAR_GENERALS_EDGE_PATH if installed elsewhere.`
    );
  }

  fs.mkdirSync(profileRootDir, { recursive: true });
  const staleCutoffMs = Date.now() - 30 * 60 * 1000;
  try {
    for (const entry of fs.readdirSync(profileRootDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith('edge-')) continue;
      const stalePath = path.join(profileRootDir, entry.name);
      try {
        if (fs.statSync(stalePath).mtimeMs < staleCutoffMs) {
          fs.rmSync(stalePath, { recursive: true, force: true });
        }
      } catch {
        // Ignore locked/in-use stale profile dirs
      }
    }
  } catch {
    // Ignore profileRootDir scan errors
  }

  const userDataDir = path.join(profileRootDir, `edge-${randomUUID()}`);
  fs.mkdirSync(userDataDir, { recursive: true });

  const args = [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-component-update',
    '--disable-background-networking',
    '--disable-sync',
    '--metrics-recording-only',
    '--disable-gpu-sandbox',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--autoplay-policy=no-user-gesture-required',
    ...(swiftshader
      ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
      : ['--use-gl=angle', '--use-angle=d3d11']),
    'about:blank',
  ];

  const proc = spawn(edgePath, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  const wsUrl = await new Promise((resolve, reject) => {
    let buffer = '';
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for Edge DevTools WebSocket URL. Output:\n${buffer}`));
    }, 15000);

    const onChunk = (chunk) => {
      buffer += chunk.toString('utf8');
      const match = buffer.match(/DevTools listening on (ws:\/\/[^\s\r\n]+)/);
      if (match) {
        clearTimeout(timeout);
        proc.stderr.off('data', onChunk);
        proc.stdout.off('data', onChunk);
        resolve(match[1]);
      }
    };

    proc.stderr.on('data', onChunk);
    proc.stdout.on('data', onChunk);
    proc.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Edge exited prematurely (code=${code}) before DevTools opened:\n${buffer}`));
    });
  });

  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('CDP WebSocket open timeout')), 10000);
    ws.addEventListener(
      'open',
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true }
    );
    ws.addEventListener(
      'error',
      (ev) => {
        clearTimeout(timeout);
        reject(new Error(`CDP WebSocket error: ${ev?.message || 'unknown'}`));
      },
      { once: true }
    );
  });

  let nextId = 1;
  const pending = new Map();
  const sessionListeners = new Map();

  ws.addEventListener('message', (event) => {
    let msg;
    try {
      msg = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString());
    } catch {
      return;
    }

    if (typeof msg.id === 'number') {
      const entry = pending.get(msg.id);
      if (entry) {
        pending.delete(msg.id);
        clearTimeout(entry.timer);
        if (msg.error) {
          entry.reject(new Error(`CDP ${entry.method} error (${msg.error.code}): ${msg.error.message}`));
        } else {
          entry.resolve(msg.result || {});
        }
      }
      return;
    }

    if (msg.sessionId && msg.method) {
      const handler = sessionListeners.get(msg.sessionId);
      if (handler) {
        handler(msg.method, msg.params || {});
      }
    }
  });

  ws.addEventListener('close', () => {
    for (const [id, entry] of pending.entries()) {
      clearTimeout(entry.timer);
      entry.reject(new Error(`CDP WebSocket closed while waiting for ${entry.method} (#${id})`));
    }
    pending.clear();
  });

  function send(method, params = {}, sessionId, timeoutMs = 20000) {
    if (ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error(`CDP WebSocket is not open (state=${ws.readyState})`));
    }
    const id = nextId++;
    const payload = sessionId ? { id, method, params, sessionId } : { id, method, params };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP command timed out (${timeoutMs}ms): ${method}`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer, method });
      ws.send(JSON.stringify(payload));
    });
  }

  const openSessions = new Set();

  /**
   * Creates an isolated page target + attached CDP session with viewport & error traps.
   *
   * @param {typeof VIEWPORT_PRESETS[keyof typeof VIEWPORT_PRESETS]} [preset]
   * @param {{ fresh?: boolean }} [sessionOpts]
   */
  async function createSession(preset = VIEWPORT_PRESETS.DESKTOP_LAPTOP, sessionOpts = {}) {
    let browserContextId;
    if (sessionOpts?.fresh) {
      const createdCtx = await send('Target.createBrowserContext', {});
      browserContextId = createdCtx.browserContextId;
    }
    let targetId;
    let sessionId;
    try {
      const targetParams = browserContextId
        ? { url: 'about:blank', browserContextId }
        : { url: 'about:blank' };
      ({ targetId } = await send('Target.createTarget', targetParams));
      ({ sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }));
    } catch (err) {
      if (browserContextId) {
        await send('Target.disposeBrowserContext', { browserContextId }, undefined, 5000).catch(() => {});
      }
      throw err;
    }

    const consoleErrors = [];
    const pageErrors = [];
    const failedRequests = [];
    const requestUrls = new Map();
    const frameNavigatedWaiters = [];
    const pageLoadWaiters = [];
    const domContentWaiters = [];
    let interceptedSubstrings = [];
    let fetchEnabled = false;
    let currentViewport = { ...preset };
    let closed = false;

    sessionListeners.set(sessionId, (method, params) => {
      if (method === 'Runtime.consoleAPICalled') {
        if (params.type === 'error') {
          const text = (params.args || [])
            .map((a) => (a.value !== undefined ? String(a.value) : a.description || a.type || ''))
            .join(' ');
          consoleErrors.push(text);
        }
      } else if (method === 'Runtime.exceptionThrown') {
        const det = params.exceptionDetails || {};
        const desc = det.exception?.description || det.text || 'Uncaught exception';
        pageErrors.push(desc);
      } else if (method === 'Network.requestWillBeSent') {
        if (params.requestId && params.request?.url) {
          requestUrls.set(params.requestId, params.request.url);
        }
      } else if (method === 'Network.responseReceived') {
        const status = params.response?.status ?? 0;
        const url = params.response?.url || requestUrls.get(params.requestId) || '';
        if (status >= 400) {
          failedRequests.push({ url, status, type: params.type || 'Other' });
        }
      } else if (method === 'Network.loadingFailed') {
        if (!params.canceled) {
          const url = requestUrls.get(params.requestId) || '';
          failedRequests.push({
            url,
            status: 0,
            errorText: params.errorText || 'loadingFailed',
            type: params.type || 'Other',
          });
        }
      } else if (method === 'Page.frameNavigated') {
        if (!params.frame?.parentId) {
          while (frameNavigatedWaiters.length > 0) {
            const resolveNav = frameNavigatedWaiters.shift();
            resolveNav();
          }
        }
      } else if (method === 'Page.domContentEventFired') {
        while (domContentWaiters.length > 0) {
          const resolveDom = domContentWaiters.shift();
          resolveDom();
        }
      } else if (method === 'Page.loadEventFired') {
        while (pageLoadWaiters.length > 0) {
          const resolveLoad = pageLoadWaiters.shift();
          resolveLoad();
        }
      } else if (method === 'Fetch.requestPaused') {
        const reqUrl = params.request?.url || '';
        const should404 = interceptedSubstrings.some((sub) => reqUrl.includes(sub));
        if (should404) {
          send(
            'Fetch.fulfillRequest',
            {
              requestId: params.requestId,
              responseCode: 404,
              responseHeaders: [{ name: 'Content-Type', value: 'text/plain' }],
              body: Buffer.from('Not Found').toString('base64'),
            },
            sessionId
          ).catch(() => {});
        } else {
          send('Fetch.continueRequest', { requestId: params.requestId }, sessionId).catch(() => {});
        }
      }
    });

    await Promise.all([
      send('Page.enable', {}, sessionId),
      send('Runtime.enable', {}, sessionId),
      send('Network.enable', {}, sessionId),
      send('DOM.enable', {}, sessionId),
    ]);

    async function setViewport(presetOrDims) {
      const width = Math.max(1, Math.round(presetOrDims.width));
      const height = Math.max(1, Math.round(presetOrDims.height));
      const deviceScaleFactor = Number(presetOrDims.deviceScaleFactor ?? 1);
      const mobile = Boolean(presetOrDims.mobile ?? false);
      const hasTouch = Boolean(presetOrDims.hasTouch ?? mobile);
      currentViewport = {
        name: presetOrDims.name || `${width}x${height}`,
        width,
        height,
        deviceScaleFactor,
        mobile,
        hasTouch,
      };
      await send(
        'Emulation.setDeviceMetricsOverride',
        {
          width,
          height,
          deviceScaleFactor,
          mobile,
          screenWidth: width,
          screenHeight: height,
        },
        sessionId
      );
      await send(
        'Emulation.setTouchEmulationEnabled',
        hasTouch ? { enabled: true, maxTouchPoints: 5 } : { enabled: false },
        sessionId
      );
    }

    await setViewport(preset);

    function waitForFrameNavigated(timeoutMs = 15000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const idx = frameNavigatedWaiters.indexOf(done);
          if (idx !== -1) frameNavigatedWaiters.splice(idx, 1);
          reject(new Error(`Timed out waiting for Page.frameNavigated (${timeoutMs}ms)`));
        }, timeoutMs);
        const done = () => {
          clearTimeout(timer);
          resolve();
        };
        frameNavigatedWaiters.push(done);
      });
    }

    function waitForDomContentEvent(timeoutMs = 15000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const idx = domContentWaiters.indexOf(done);
          if (idx !== -1) domContentWaiters.splice(idx, 1);
          reject(new Error(`Timed out waiting for Page.domContentEventFired (${timeoutMs}ms)`));
        }, timeoutMs);
        const done = () => {
          clearTimeout(timer);
          resolve();
        };
        domContentWaiters.push(done);
      });
    }

    function waitForLoadEvent(timeoutMs = 15000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const idx = pageLoadWaiters.indexOf(done);
          if (idx !== -1) pageLoadWaiters.splice(idx, 1);
          reject(new Error(`Timed out waiting for Page.loadEventFired (${timeoutMs}ms)`));
        }, timeoutMs);
        const done = () => {
          clearTimeout(timer);
          resolve();
        };
        pageLoadWaiters.push(done);
      });
    }

    async function goto(url, { waitUntilLoad = true, waitUntil = 'interactive', timeoutMs = 15000 } = {}) {
      const navP = waitForFrameNavigated(timeoutMs);
      const evtP = !waitUntilLoad
        ? null
        : waitUntil === 'load'
          ? waitForLoadEvent(timeoutMs)
          : waitUntil === 'domcontentloaded'
            ? waitForDomContentEvent(timeoutMs)
            : null;
      const navRes = await send('Page.navigate', { url }, sessionId, timeoutMs);
      if (navRes?.errorText) {
        throw new Error(`Navigation to ${url} failed: ${navRes.errorText}`);
      }
      await navP;
      if (evtP) {
        await evtP;
      } else if (waitUntilLoad) {
        await waitFor(() => document.readyState === 'interactive' || document.readyState === 'complete', {
          timeoutMs,
          intervalMs: 40,
        });
      }
    }

    async function reload({ waitUntilLoad = true, waitUntil = 'interactive', timeoutMs = 15000 } = {}) {
      const navP = waitForFrameNavigated(timeoutMs);
      const evtP = !waitUntilLoad
        ? null
        : waitUntil === 'load'
          ? waitForLoadEvent(timeoutMs)
          : waitUntil === 'domcontentloaded'
            ? waitForDomContentEvent(timeoutMs)
            : null;
      await send('Page.reload', { ignoreCache: true }, sessionId, timeoutMs);
      await navP;
      if (evtP) {
        await evtP;
      } else if (waitUntilLoad) {
        await waitFor(() => document.readyState === 'interactive' || document.readyState === 'complete', {
          timeoutMs,
          intervalMs: 40,
        });
      }
    }

    async function evaluate(fnOrString, ...args) {
      const expression =
        typeof fnOrString === 'function'
          ? `(${fnOrString.toString()})(...${JSON.stringify(args)})`
          : String(fnOrString);
      const res = await send(
        'Runtime.evaluate',
        {
          expression,
          awaitPromise: true,
          returnByValue: true,
        },
        sessionId
      );
      if (res.exceptionDetails) {
        const det = res.exceptionDetails;
        throw new Error(det.exception?.description || det.text || 'Evaluation error');
      }
      return res.result ? res.result.value : undefined;
    }

    async function waitFor(fnOrExpr, { timeoutMs = 10000, intervalMs = 80, args = [] } = {}) {
      const deadline = Date.now() + timeoutMs;
      let lastErr = null;
      while (Date.now() <= deadline) {
        try {
          const val = await evaluate(fnOrExpr, ...args);
          if (val) return val;
        } catch (err) {
          lastErr = err;
        }
        await sleep(intervalMs);
      }
      const suffix = lastErr ? ` (last error: ${lastErr.message})` : '';
      throw new Error(`waitFor timed out after ${timeoutMs}ms${suffix}`);
    }

    async function getRect(selector) {
      return evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        const visible =
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          Number(style.opacity) > 0 &&
          rect.width > 0 &&
          rect.height > 0;
        return {
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
          cx: rect.left + rect.width / 2,
          cy: rect.top + rect.height / 2,
          visible,
        };
      }, selector);
    }

    async function tapPoint(x, y, { isTouch = currentViewport.hasTouch } = {}) {
      const px = Math.round(x);
      const py = Math.round(y);
      if (isTouch) {
        await send(
          'Input.dispatchTouchEvent',
          { type: 'touchStart', touchPoints: [{ x: px, y: py, id: 1 }] },
          sessionId
        );
        await sleep(25);
        await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, sessionId);
      } else {
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: px, y: py }, sessionId);
        await send(
          'Input.dispatchMouseEvent',
          { type: 'mousePressed', x: px, y: py, button: 'left', clickCount: 1 },
          sessionId
        );
        await sleep(20);
        await send(
          'Input.dispatchMouseEvent',
          { type: 'mouseReleased', x: px, y: py, button: 'left', clickCount: 1 },
          sessionId
        );
      }
    }

    async function clickSelector(selector, { timeoutMs = 5000 } = {}) {
      const rect = await waitFor(
        (sel) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          const st = getComputedStyle(el);
          if (st.display === 'none' || st.visibility === 'hidden' || r.width <= 0 || r.height <= 0) {
            return null;
          }
          return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
        },
        { timeoutMs, args: [selector] }
      );
      await tapPoint(rect.cx, rect.cy, { isTouch: currentViewport.hasTouch });
    }

    async function dragPoints(
      x1,
      y1,
      x2,
      y2,
      { steps = 10, holdBeforeMoveMs = 0, cancel = false, isTouch = currentViewport.hasTouch } = {}
    ) {
      const sx = Math.round(x1);
      const sy = Math.round(y1);
      const ex = Math.round(x2);
      const ey = Math.round(y2);
      const nSteps = Math.max(1, steps);

      if (isTouch) {
        await send(
          'Input.dispatchTouchEvent',
          { type: 'touchStart', touchPoints: [{ x: sx, y: sy, id: 1 }] },
          sessionId
        );
        if (holdBeforeMoveMs > 0) await sleep(holdBeforeMoveMs);
        for (let i = 1; i <= nSteps; i++) {
          const t = i / nSteps;
          const ix = Math.round(sx + (ex - sx) * t);
          const iy = Math.round(sy + (ey - sy) * t);
          await send(
            'Input.dispatchTouchEvent',
            { type: 'touchMove', touchPoints: [{ x: ix, y: iy, id: 1 }] },
            sessionId
          );
          await sleep(16);
        }
        await send(
          'Input.dispatchTouchEvent',
          { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] },
          sessionId
        );
      } else {
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: sx, y: sy }, sessionId);
        await send(
          'Input.dispatchMouseEvent',
          { type: 'mousePressed', x: sx, y: sy, button: 'left', clickCount: 1 },
          sessionId
        );
        if (holdBeforeMoveMs > 0) await sleep(holdBeforeMoveMs);
        for (let i = 1; i <= nSteps; i++) {
          const t = i / nSteps;
          const ix = Math.round(sx + (ex - sx) * t);
          const iy = Math.round(sy + (ey - sy) * t);
          await send(
            'Input.dispatchMouseEvent',
            { type: 'mouseMoved', x: ix, y: iy, button: 'left' },
            sessionId
          );
          await sleep(16);
        }
        if (cancel) {
          await evaluate((cx, cy) => {
            const target = document.elementFromPoint(cx, cy) || window;
            target.dispatchEvent(
              new PointerEvent('pointercancel', {
                bubbles: true,
                cancelable: true,
                clientX: cx,
                clientY: cy,
                pointerId: 1,
                pointerType: 'mouse',
              })
            );
          }, ex, ey);
        } else {
          await send(
            'Input.dispatchMouseEvent',
            { type: 'mouseReleased', x: ex, y: ey, button: 'left', clickCount: 1 },
            sessionId
          );
        }
      }
    }

    async function longPress(x, y, holdMs = 380, { isTouch = currentViewport.hasTouch } = {}) {
      const px = Math.round(x);
      const py = Math.round(y);
      if (isTouch) {
        await send(
          'Input.dispatchTouchEvent',
          { type: 'touchStart', touchPoints: [{ x: px, y: py, id: 1 }] },
          sessionId
        );
        await sleep(holdMs);
        await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, sessionId);
      } else {
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: px, y: py }, sessionId);
        await send(
          'Input.dispatchMouseEvent',
          { type: 'mousePressed', x: px, y: py, button: 'left', clickCount: 1 },
          sessionId
        );
        await sleep(holdMs);
        await send(
          'Input.dispatchMouseEvent',
          { type: 'mouseReleased', x: px, y: py, button: 'left', clickCount: 1 },
          sessionId
        );
      }
    }

    async function wheel(x, y, deltaY, deltaX = 0) {
      await send(
        'Input.dispatchMouseEvent',
        { type: 'mouseWheel', x: Math.round(x), y: Math.round(y), deltaX, deltaY },
        sessionId
      );
    }

    async function pressKey(key) {
      const def = getKeyPayload(key);
      await send(
        'Input.dispatchKeyEvent',
        {
          type: 'rawKeyDown',
          key: def.key,
          code: def.code,
          windowsVirtualKeyCode: def.windowsVirtualKeyCode,
          nativeVirtualKeyCode: def.windowsVirtualKeyCode,
        },
        sessionId
      );
      if (def.text) {
        await send(
          'Input.dispatchKeyEvent',
          {
            type: 'char',
            text: def.text,
            unmodifiedText: def.text,
            key: def.key,
            code: def.code,
            windowsVirtualKeyCode: def.windowsVirtualKeyCode,
          },
          sessionId
        );
      }
      await send(
        'Input.dispatchKeyEvent',
        {
          type: 'keyUp',
          key: def.key,
          code: def.code,
          windowsVirtualKeyCode: def.windowsVirtualKeyCode,
          nativeVirtualKeyCode: def.windowsVirtualKeyCode,
        },
        sessionId
      );
    }

    async function capturePngBase64() {
      const res = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
      return res.data;
    }

    async function intercept404(urlSubstrings) {
      interceptedSubstrings = Array.isArray(urlSubstrings) ? [...urlSubstrings] : [String(urlSubstrings)];
      if (!fetchEnabled) {
        await send(
          'Fetch.enable',
          { patterns: [{ urlPattern: '*', requestStage: 'Request' }] },
          sessionId
        );
        fetchEnabled = true;
      }
    }

    async function clearInterceptions() {
      interceptedSubstrings = [];
      if (fetchEnabled) {
        await send('Fetch.disable', {}, sessionId);
        fetchEnabled = false;
      }
    }

    function getErrors() {
      return {
        consoleErrors: [...consoleErrors],
        pageErrors: [...pageErrors],
        failedRequests: [...failedRequests],
      };
    }

    function resetErrors() {
      consoleErrors.length = 0;
      pageErrors.length = 0;
      failedRequests.length = 0;
    }

    async function close() {
      if (closed) return;
      closed = true;
      openSessions.delete(session);
      sessionListeners.delete(sessionId);
      try {
        await send('Target.closeTarget', { targetId }, undefined, 5000);
      } catch {
        // Ignore target close errors if browser is shutting down
      }
      if (browserContextId) {
        await send('Target.disposeBrowserContext', { browserContextId }, undefined, 5000).catch(() => {});
      }
    }

    const session = {
      targetId,
      sessionId,
      getViewport: () => ({ ...currentViewport }),
      goto,
      reload,
      setViewport,
      evaluate,
      waitFor,
      getRect,
      clickSelector,
      tapPoint,
      dragPoints,
      longPress,
      wheel,
      pressKey,
      capturePngBase64,
      intercept404,
      clearInterceptions,
      getErrors,
      resetErrors,
      close,
    };

    openSessions.add(session);
    return session;
  }

  let browserClosed = false;
  async function close() {
    if (browserClosed) return;
    browserClosed = true;

    for (const s of Array.from(openSessions)) {
      await s.close().catch(() => {});
    }

    try {
      await send('Browser.close', {}, undefined, 3000);
    } catch {
      // Best effort
    }

    try {
      ws.close();
    } catch {
      // Ignore
    }

    const waitProcExit = (ms) =>
      new Promise((resolve) => {
        if (proc.exitCode !== null) {
          resolve(true);
          return;
        }
        const timer = setTimeout(() => {
          proc.off('exit', onExit);
          resolve(false);
        }, ms);
        const onExit = () => {
          clearTimeout(timer);
          resolve(true);
        };
        proc.once('exit', onExit);
      });

    const exitedGracefully = await waitProcExit(1200);
    if (!exitedGracefully && proc.pid) {
      if (process.platform === 'win32') {
        await new Promise((resolve) => {
          const killer = spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], {
            stdio: 'ignore',
            windowsHide: true,
          });
          killer.once('exit', () => resolve());
          killer.once('error', () => resolve());
        });
      } else {
        try {
          proc.kill('SIGKILL');
        } catch {
          // Ignore
        }
      }
      await waitProcExit(800);
    }

    for (let attempt = 0; attempt < 16; attempt++) {
      try {
        fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 2, retryDelay: 50 });
        if (!fs.existsSync(userDataDir)) break;
      } catch (err) {
        const code = err?.code;
        if ((code === 'EBUSY' || code === 'EPERM') && attempt === 2 && process.platform === 'win32' && proc.pid) {
          await new Promise((resolve) => {
            const killer = spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], {
              stdio: 'ignore',
              windowsHide: true,
            });
            killer.once('exit', () => resolve());
            killer.once('error', () => resolve());
          });
        }
      }
      await sleep(200);
    }
  }

  return {
    wsUrl,
    createSession,
    close,
  };
}
