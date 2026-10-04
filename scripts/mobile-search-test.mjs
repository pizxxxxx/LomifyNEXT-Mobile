import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {writable} from 'svelte/store';
function load(path,deps,globals={}){
 const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports,require:id=>{assert(id in deps,id);return deps[id]},URL,URLSearchParams,AbortController,DOMException,console,setTimeout,clearTimeout,...globals});return exports;
}
const requests=[];
let rejectedMood=false;
const yandex=load('../src/lib/yandexDiscovery.ts',{'./yandex':{
 normalizeYandexToken:t=>t.trim(),mapYandexTrack:t=>t?.title?{id:String(t.id),title:t.title,source:'yandex'}:null,
 ymJson:async(url,token,init)=>{requests.push({url,token,init});if(url.includes('/rotor/session/new'))return{acceptedSeeds:rejectedMood?[]:[{type:'settingMoodEnergy',tag:JSON.parse(init.body).seeds[1].split(':')[1]}],sequence:[{type:'track',track:{id:'1',title:'Calm'}},{type:'track',track:{id:'1',title:'Calm'}},{type:'advert',track:{id:'3',title:'Advert'}}]};if(url.includes('suggest'))return{suggestions:[' ночной поезд ','ночной поезд',null,'ночной город']};if(url.includes('music-history'))return history;if(url.includes('/tracks?'))return[{id:'2',title:'Second'}];throw new Error('unexpected');}
}});
assert.equal((await yandex.yandexSearchSuggestions('fake','н')).length,0);
assert.equal(requests.length,0);
assert.equal((await yandex.yandexSearchSuggestions('fake','ноч')).join('|'),'ночной поезд|ночной город');
assert(requests[0].url.includes('/search/suggest?part='));
const history={historyTabs:[{items:[{context:{type:'album'},tracks:[
 {type:'track',data:{itemId:{trackId:'1',albumId:'99'},fullModel:{id:'1',title:'First'}}},
 {type:'album',data:{itemId:{id:'999'}}},
 {type:'track',data:{itemId:{trackId:'2',albumId:'99'}}},
 {type:'track',data:{itemId:{trackId:'1'}}},
 {type:'track',data:{itemId:{trackId:'../../bad'}}}
]}]}]};
assert.equal(yandex.yandexHistoryEntries(history).map(t=>t.id).join(','),'1,2');
assert.equal((await yandex.yandexRecentTracks('fake')).map(t=>t.title).join(','),'First,Second');
assert(requests.at(-1).url.endsWith('/tracks?trackIds=2'),'Only missing models are hydrated');
assert.equal(yandex.yandexHistoryEntries({historyTabs:null}).length,0);
console.log('PASS Yandex suggest debounce inputs, shape/deduplication and bounded chronological history hydration');
assert.equal((await yandex.yandexMoodTracks('fake','calm')).map(track=>track.title).join(','),'Calm');
const moodRequest=requests.at(-1), moodBody=JSON.parse(moodRequest.init.body);
assert(moodRequest.url.endsWith('/rotor/session/new'));assert.equal(moodRequest.init.method,'POST');
assert.equal(moodBody.seeds.join(','),'user:onyourwave,settingMoodEnergy:calm');assert(moodBody.incognito);
assert(!requests.some(request=>request.url.includes('/settings')),'Mood preview does not change the primary Wave');
const beforeMood=requests.length;
await assert.rejects(yandex.yandexMoodTracks('','calm'));await assert.rejects(yandex.yandexMoodTracks('fake','unknown'));
assert.equal(requests.length,beforeMood);
rejectedMood=true;await assert.rejects(yandex.yandexMoodTracks('fake','sad'),/не принял/);rejectedMood=false;
console.log('PASS Yandex isolated mood batch, valid seeds, deduplication and untouched global Wave settings');
const tolerant=load('../src/lib/utils/tolerantSearch.ts',{});
assert(tolerant.searchMatchScore('Ночной поезд Маяк','поезд ночнй')>0);
assert(tolerant.searchMatchScore('Солнце Ёлка','елка солнце')>0);
assert(tolerant.searchMatchScore('Кино','rbyj')>0);
assert(tolerant.searchMatchScore('Земфира','zemfira')>0);
assert.equal(tolerant.searchMatchScore('Ночной поезд','ночь заяц'),0);
assert.equal(tolerant.searchMatchScore('Кино','кн'),0,'Short fragments never use fuzzy substitutions');
assert(tolerant.searchMatchScore('Kai Angel','kai agnel')>0,'Adjacent swapped characters match');
assert(tolerant.searchMatchScore('Ночной поезд','ночной поезд')>tolerant.searchMatchScore('Ночной поезд','ночнй поезд'));
const catalogCalls=[];
const corrected=await tolerant.searchWithQueryVariants('rbyj',async text=>{catalogCalls.push(text);return text==='кино'?['Кино']:[];});
assert.equal(corrected.correctedQuery,'кино');assert.equal(catalogCalls.length,2);
catalogCalls.length=0;await tolerant.searchWithQueryVariants('Кино',async text=>{catalogCalls.push(text);return ['Кино'];});assert.equal(catalogCalls.length,1,'No duplicate request when the service already found results');
let stop=false;const many=Array.from({length:500},(_,i)=>`Ночной поезд ${i}`);setTimeout(()=>{stop=true;},0);
assert.equal((await tolerant.rankSearchMatches(many,'ночнй',x=>x,()=>stop)).length,0,'A newer query can interrupt a large local match');
console.log('PASS tolerant tokens, punctuation/diacritics, order, typos, keyboard layout, transliteration, server retry and cancellable collection matching');
let response={},status=200;
const discoveryRequests=[],opened=[];
const nativeFetch=async(url,init)=>{
 discoveryRequests.push({url,init});if(init.signal.aborted)throw new DOMException('cancelled','AbortError');
 if(url.includes('/auth/login/status'))return{ok:true,status:200,json:async()=>({status:'completed',sessionId:'fixture-session'})};
 return{ok:status===200,status,json:async()=>response};
};
const discovery=load('../src/lib/mobileDiscoverySearch.ts',{'@tauri-apps/plugin-http':{fetch:nativeFetch},'@tauri-apps/plugin-opener':{openUrl:async url=>opened.push(url)},'svelte/store':{writable}},{window:{__TAURI_INTERNALS__:{}},setTimeout:(fn,ms)=>setTimeout(fn,ms===1500?0:ms)});
const raw={id:42,title:'Song',user:{username:'Artist'},artwork_url:'https://i1.sndcdn.com/art.jpg',duration:180000};
response={collection:[{track:raw,matchedLine:'Found line'},{track:raw,matchedLine:'duplicate'},{track:{id:'bad'}}],page:0,page_size:20,has_more:true};
const lyrics=await discovery.searchDiscovery('lyrics','они тянут ко мне','fixture-session',new AbortController().signal);
assert.equal(lyrics.hits.length,1,'Provider paged collection must not be mistaken for an empty lyrics result');assert.equal(lyrics.hits[0].matchedLine,'Found line');assert(lyrics.hasMore);
assert.equal(lyrics.hits[0].track.source,'soundcloud');assert(lyrics.hits[0].track.discoverySearch);
let last=discoveryRequests.at(-1);assert(last.url.startsWith('https://api.scnative.space/search/lyrics?'));assert(last.url.includes('mode=text'));assert.equal(last.init.headers['x-session-id'],'fixture-session');assert(!last.url.includes('fixture-session'));
response={collection:[],page:1,page_size:20,has_more:false};
const nextLyrics=await discovery.searchDiscovery('lyrics','они тянут ко мне','fixture-session',new AbortController().signal,1);
assert.equal(nextLyrics.hasMore,false);assert(discoveryRequests.at(-1).url.includes('page=1'));
response={items:[raw],status:'preparing'};const vibe=await discovery.searchDiscovery('vibe','мягкий бас','fixture-session',new AbortController().signal);
assert(vibe.preparing);assert.equal(vibe.hits[0].matchedLine,null);assert(discoveryRequests.at(-1).url.includes('/search/vibe?'));
const n=discoveryRequests.length;await assert.rejects(discovery.searchDiscovery('vibe','test','',new AbortController().signal),e=>e.kind==='login');assert.equal(discoveryRequests.length,n,'No unauthenticated search or substitute lexical results');
status=401;await assert.rejects(discovery.searchDiscovery('vibe','test','session',new AbortController().signal),e=>e.kind==='login');
status=429;await assert.rejects(discovery.searchDiscovery('vibe','test','session',new AbortController().signal),e=>e.kind==='limited');
status=503;await assert.rejects(discovery.searchDiscovery('vibe','test','session',new AbortController().signal),e=>e.kind==='unavailable');
status=200;const cancelled=new AbortController();cancelled.abort();await assert.rejects(discovery.searchDiscovery('vibe','test','session',cancelled.signal),e=>e.name==='AbortError');
response={url:'https://unrelated.invalid/login',loginRequestId:'fixture'};await assert.rejects(discovery.beginDiscoveryLogin(new AbortController().signal));assert.equal(opened.length,0);
response={url:'https://secure.soundcloud.com/authorize?client_id=fixture',loginRequestId:'fixture'};assert.equal(await discovery.beginDiscoveryLogin(new AbortController().signal),'fixture-session');assert.equal(opened.length,1);
assert.equal(discoveryRequests.at(-1).init.headers['x-session-id'],undefined,'Login/status requests never receive a music-provider credential');
console.log('PASS lyric excerpts, audio-semantic endpoint, pagination, authorization, cancellation, rate limits and separate OAuth destination');
