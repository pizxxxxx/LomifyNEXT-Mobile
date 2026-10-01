// Exercise the actual gesture action: cancellation, touch arbitration and history.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
class Target {
  listeners=new Map(); dataset={}; props=new Map(); children=[]; inert=false; clientWidth=390;
  style={setProperty:(key,value)=>this.props.set(key,value),removeProperty:key=>this.props.delete(key)};
  addEventListener(type,fn){this.listeners.set(type,[...(this.listeners.get(type)||[]),fn]);}
  removeEventListener(type,fn){this.listeners.set(type,(this.listeners.get(type)||[]).filter(item=>item!==fn));}
  dispatchEvent(event){for(const fn of this.listeners.get(event.type)||[])fn(event);}
  querySelector(){return content;} closest(){return null;} getBoundingClientRect(){return{left:0};}
  setAttribute(){} append(child){this.children.push(child);} prepend(child){this.children.unshift(child);} remove(){}
  setPointerCapture(){} hasPointerCapture(){return false;} releasePointerCapture(){}
}
const stage=new Target(),content=new Target(),window=new Target(),document=new Target();
document.body = new Target();
let modal=false,available=true,reduced=false,backs=0,id=0;
const timers=new Map(),frames=[];
document.querySelector=()=>modal?{}:null;document.createElement=()=>new Target();
const store={subscribe(fn){fn(available);return()=>{};}};
const environment={exports:{},window,document,history:{state:{},back(){backs++;window.dispatchEvent({type:'popstate'});}},
  matchMedia:()=>({matches:reduced}),CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}},
  requestAnimationFrame:fn=>{frames.push(fn);},setTimeout:fn=>{timers.set(++id,fn);return id;},clearTimeout:key=>timers.delete(key),
  require:name=>name==='svelte/store'?{get:()=>available}:{mobileCanGoBack:store,mobileBackPreview:()=>new Target()}};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/lib/actions/mobileSwipeBack.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,environment);
const action=environment.exports.mobileSwipeBack(stage);
function pointer(type,x,y=300,time=0){stage.dispatchEvent({type,pointerId:1,isPrimary:true,button:0,pointerType:'mouse',clientX:x,clientY:y,timeStamp:time,preventDefault(){}});}
function drain(){for(const [key,fn] of [...timers]){timers.delete(key);fn();}while(frames.length)frames.shift()();}
pointer('pointerdown',5);pointer('pointermove',35,300,100);pointer('pointerup',35,300,200);drain();assert.equal(backs,0);assert.equal(stage.dataset.edgeBack,undefined);
pointer('pointerdown',5);pointer('pointermove',220,300,300);pointer('pointerup',220,300,400);drain();assert.equal(backs,1);assert.equal(stage.dataset.edgeBack,undefined);
pointer('pointerdown',5);pointer('pointermove',220,300,300);pointer('pointercancel',220,300,400);drain();assert.equal(backs,1);
pointer('pointerdown',50);pointer('pointermove',350);pointer('pointerup',350);drain();assert.equal(backs,1,'Gesture must begin at the left edge');
console.log('PASS pointer edge: commit, short cancellation, pointer cancellation and non-edge exclusion');
let prevented=0;
function touch(type,x,y=300,time=0){const point={identifier:7,clientX:x,clientY:y};stage.dispatchEvent({type,touches:type==='touchend'||type==='touchcancel'?[]:[point],changedTouches:[point],timeStamp:time,preventDefault(){prevented++;}});}
touch('touchstart',5);touch('touchmove',8,340);touch('touchend',8,340);drain();assert.equal(prevented,0);assert.equal(backs,1,'Vertical scrolling must not navigate');
touch('touchstart',5);touch('touchmove',220,302,300);touch('touchend',220,302,400);drain();assert.equal(prevented,1);assert.equal(backs,2);
touch('touchstart',5);touch('touchmove',220,302,300);touch('touchcancel',220,302,400);drain();assert.equal(backs,2);
console.log('PASS touch: vertical scroll remains native; horizontal commit and touch cancellation');
for(const block of ['modal','root','player']){modal=block==='modal';available=block!=='root';environment.history.state={mobilePlayer:block==='player'};pointer('pointerdown',5);pointer('pointermove',220);pointer('pointerup',220);drain();assert.equal(backs,2);}
modal=false;available=true;environment.history.state={};reduced=true;
pointer('pointerdown',5);pointer('pointermove',220);assert.equal(stage.dataset.backReduced,'true');pointer('pointerup',220);drain();assert.equal(backs,3);
pointer('pointerdown',5);pointer('pointermove',220);pointer('pointerup',220);window.dispatchEvent({type:'lomify:mobile-navigation'});drain();assert.equal(backs,3,'Changing destination cancels a pending gesture');
action.destroy();assert.equal(stage.listeners.get('touchmove').length,0);
console.log('PASS modal/root/player guards, reduced motion, interruption and listener cleanup');
const makeStore=value=>({value,set(next){this.value=next;}});
const artistStore=makeStore('Маяк'),viewStore=makeStore('artist'),previousStore=makeStore('home');
let mobile=true;const navigations=[];const navigationExports={};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../src/lib/utils/navigation.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports:navigationExports,history:{state:{mobileView:'artist',mobileArtistAlbum:'old'}},require:name=>({
 'svelte/store':{get:store=>store.value},'$lib/stores':{currentArtist:artistStore,currentView:viewStore,previousView:previousStore},
 '$lib/mobile':{get isMobile(){return mobile;}},'$lib/mobileNavigation':{pushMobileHistory:state=>navigations.push(state)}
}[name])});
navigationExports.goToArtist('Луна');assert.equal(navigations.length,1);assert.equal(navigations[0].mobileArtist,'Луна');assert.equal(navigations[0].mobileArtistAlbum,undefined);
navigationExports.goToArtist('Луна');assert.equal(navigations.length,1,'Selecting the same artist must not duplicate history');
mobile=false;navigationExports.goToArtist('Север');assert.equal(navigations.length,1,'Desktop navigation must not use phone history');
console.log('PASS artist-to-artist history records the name once and leaves desktop navigation unchanged');
