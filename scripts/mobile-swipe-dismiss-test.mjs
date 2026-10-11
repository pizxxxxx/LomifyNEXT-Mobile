import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as easing from 'svelte/easing';
let ios = true;
class MotionEvent { constructor(type, options) { this.type = type; this.detail = options.detail; } }
function load(file) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
    { exports, CustomEvent: MotionEvent, require: name => name === 'svelte/easing' ? easing : { get isIOS() { return ios; } } });
  return exports;
}
const { mobileSwipeDismiss } = load('../src/lib/actions/mobileSwipeDismiss.ts');
const { createMobilePlayerTransition } = load('../src/lib/utils/mobilePlayerTransition.ts');
function fixture(targetType = 'header') {
  const props = new Map(), listeners = new Map(), events = [], options = new Map();
  let captured = false, closes = 0, captures = 0;
  const node = { clientHeight: 800, dataset: {},
    style: { setProperty: (k, v) => props.set(k, v), getPropertyValue: k => props.get(k) || '', removeProperty: k => props.delete(k) },
    addEventListener: (k, v, opt) => { listeners.set(k, v); options.set(k, opt); }, removeEventListener: k => listeners.delete(k),
    setPointerCapture() { captured = true; captures++; }, hasPointerCapture: () => captured, releasePointerCapture() { captured = false; },
    dispatchEvent: e => events.push(e)
  };
  const control = { classList: { contains: name => name === 'mobile-now-dismiss' && targetType === 'dismiss' } };
  const target = { closest: selector => selector.startsWith('.mobile-now-header') ? targetType !== 'lyrics' : ['control', 'dismiss'].includes(targetType) ? control : null };
  const action = mobileSwipeDismiss(node, () => closes++);
  function send(type, y, time, x = 160, extra = {}) {
    const e = { type, target, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, clientX: x, clientY: y, timeStamp: time,
      defaultPrevented: false, stopped: false, preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...extra };
    listeners.get(type)?.(e);
    return e;
  }
  function touch(type, y, time, extra = {}) {
    const finger = { identifier: 1, clientX: 160, clientY: y };
    return send(type, y, time, 160, { touches: type === 'touchend' || type === 'touchcancel' ? [] : [finger], changedTouches: [finger], ...extra });
  }
  return { node, target, action, props, listeners, events, options, send, touch, closes: () => closes, captures: () => captures };
}
// A short 80 px flick used to set translate to the full height and race the outro.
const flick = fixture();
flick.send('pointerdown', 30, 0); flick.send('pointermove', 70, 40); flick.send('pointermove', 110, 80); flick.send('pointerup', 110, 90);
assert.equal(flick.closes(), 1);
assert.equal(flick.props.get('--mobile-player-dismiss-y'), '80px', 'Release preserves the position under the finger');
assert.equal(flick.node.dataset.swipeDragging, undefined);
const transition = createMobilePlayerTransition(flick.node, 'out', false);
assert(transition.duration >= 280 && transition.duration <= 500, 'Short flick must not close in 180 ms');
assert.equal(transition.css(1), 'transform:translate3d(0,0px,0)', 'First outro frame starts at the release offset');
assert.equal(transition.css(0), 'transform:translate3d(0,720px,0)', 'Outro covers only the remaining distance');
const releaseVelocity = Number(flick.props.get('--mobile-player-dismiss-velocity'));
const h = 0.00001;
assert(Math.abs((transition.easing(h) - transition.easing(0)) / h * 720 / transition.duration - releaseVelocity) < .001, 'Initial outro speed matches the finger');
assert(Math.abs((transition.easing(1) - transition.easing(1-h)) / h) < .001, 'Outro brakes to rest');
assert.equal(flick.events.at(-1).detail.duration, transition.duration + 20, 'Native controls stay on the moving surface for the full animation');
for (const velocity of [0, .6, 1, 2, 6, 30]) {
  flick.props.set('--mobile-player-dismiss-velocity', String(velocity));
  const config = createMobilePlayerTransition(flick.node, 'out', false);
  let previous = 0;
  for (let i=0; i<=100; i++) { const y=config.easing(i/100); assert(y>=previous-1e-9 && y<=1+1e-9, 'No backwards step or overshoot'); previous=y; }
}
console.log('PASS short flick: preserved offset, one remaining path, matched velocity, monotonic easing and native control handoff');
for (const type of ['pointercancel', 'lostpointercapture']) {
  const f=fixture();f.send('pointerdown',30,0);f.send('pointermove',230,100);f.send(type,230,110,160,{target:f.node});
  assert.equal(f.closes(),0);assert.equal(f.props.get('--mobile-player-dismiss-y'),'0px');
  assert.equal(f.node.dataset.swipeDragging,undefined);f.action.destroy();assert.equal(f.listeners.size,0);
}
// A capture transfer from the child handle used to abort the gesture at 8–10 px.
const transfer=fixture('dismiss');transfer.send('pointerdown',30,0);transfer.send('pointermove',40,10);
transfer.send('lostpointercapture',40,11);
assert.equal(transfer.props.get('--mobile-player-dismiss-y'),'10px');
assert.equal(transfer.node.dataset.swipeDragging,'true','Losing the child capture is not losing the panel capture');
transfer.send('pointermove',110,80);transfer.send('pointerup',110,90);assert.equal(transfer.closes(),1);
const finger=fixture('dismiss');
finger.send('pointerdown',30,0,160,{pointerType:'touch'});finger.touch('touchstart',30,0);
assert.equal(finger.touch('touchmove',40,10).defaultPrevented,true,'Recognized finger drag prevents native scrolling');
assert.equal(finger.props.get('--mobile-player-dismiss-y'),'10px');
finger.send('lostpointercapture',40,11,160,{pointerType:'touch'});
finger.send('pointercancel',40,12,160,{pointerType:'touch',target:finger.node});
finger.touch('touchmove',70,40);assert.equal(finger.props.get('--mobile-player-dismiss-y'),'40px');
finger.touch('touchmove',110,80);assert.equal(finger.props.get('--mobile-player-dismiss-y'),'80px');
finger.touch('touchend',110,90);finger.send('pointerup',110,91,160,{pointerType:'touch'});
finger.touch('touchend',110,92);
assert.equal(finger.closes(),1,'Touch and compatibility pointer events must not close twice');
assert.equal(finger.captures(),0,'Touch Events do not transfer implicit pointer capture');
assert.equal(finger.props.get('--mobile-player-dismiss-y'),'80px');
assert.equal(finger.options.get('touchmove').passive,false);
const accidentalClick=finger.send('click',110,93);assert(accidentalClick.defaultPrevented && accidentalClick.stopped);
for (const cancel of ['touchcancel','multitouch']) {
  const f=fixture('dismiss');f.touch('touchstart',30,0);f.touch('touchmove',230,100);
  if(cancel==='touchcancel')f.touch('touchcancel',230,110);
  else f.touch('touchstart',230,110,{touches:[{identifier:1},{identifier:2}]});
  f.touch('touchend',230,120);assert.equal(f.closes(),0);assert.equal(f.props.get('--mobile-player-dismiss-y'),'0px');
  assert.equal(f.node.dataset.swipeDragging,undefined);f.action.destroy();assert.equal(f.listeners.size,0);
}
for(const type of ['lyrics','control']) {
  const f=fixture(type);f.touch('touchstart',30,0);assert.equal(f.touch('touchmove',230,100).defaultPrevented,false);
  f.touch('touchend',230,110);assert.equal(f.closes(),0,'Lyric scrolling and controls do not become dismissal gestures');
}
const touchTap=fixture('dismiss');touchTap.touch('touchstart',30,0);touchTap.touch('touchend',30,100);
assert.equal(touchTap.send('click',30,101).defaultPrevented,false,'A tap still reaches the handle click handler');
const touchHeld=fixture();touchHeld.touch('touchstart',30,0);touchHeld.touch('touchmove',110,80);touchHeld.touch('touchend',110,300);
assert.equal(touchHeld.closes(),0,'Holding a finger cancels stale inertia');
const touchHorizontal=fixture();touchHorizontal.touch('touchstart',30,0);
const sideways={identifier:1,clientX:220,clientY:40};
assert.equal(touchHorizontal.touch('touchmove',40,100,{touches:[sideways],changedTouches:[sideways]}).defaultPrevented,false);
touchHorizontal.touch('touchend',40,110,{changedTouches:[sideways]});assert.equal(touchHorizontal.closes(),0);
console.log('PASS capture transfer at 10 px, continuous touch drag, compatibility pointer cancellation, single release, touch cancel/multitouch and untouched scrolling/taps');
const held=fixture();held.send('pointerdown',30,0);held.send('pointermove',110,80);held.send('pointerup',110,300);
assert.equal(held.closes(),0,'Holding after a short drag cancels stale inertia');
const slow=fixture();slow.send('pointerdown',30,0);slow.send('pointermove',90,300);slow.send('pointerup',90,320);
assert.equal(slow.closes(),0,'A short slow drag returns to open');
const long=fixture();long.send('pointerdown',30,0);long.send('pointermove',230,600);long.send('pointerup',230,900);
assert.equal(long.closes(),1,'A long drag closes even without inertia');
for (const type of ['lyrics','control']) { const f=fixture(type);f.send('pointerdown',30,0);f.send('pointermove',230,100);f.send('pointerup',230,110);assert.equal(f.closes(),0); }
const horizontal=fixture();horizontal.send('pointerdown',30,0);horizontal.send('pointermove',40,100,220);horizontal.send('pointerup',40,110,220);assert.equal(horizontal.closes(),0);
const tap=fixture('dismiss');tap.send('pointerdown',30,0);tap.send('pointerup',30,100);assert.equal(tap.closes(),0,'A tap remains the button click handler’s responsibility');
assert.equal(createMobilePlayerTransition(tap.node,'out',false).duration,480,'Tap retains its existing timing');
assert.equal(createMobilePlayerTransition(flick.node,'out',true).duration,0,'Reduced motion has no settling animation');
assert.equal(flick.events.at(-1).detail.duration,0);
ios=false;assert.deepEqual(Object.keys(mobileSwipeDismiss(fixture().node,()=>{})),[]);
console.log('PASS slow/held drag, long drag, cancellation, lost capture, lyric/control guards, tap, reduced motion and cleanup');
