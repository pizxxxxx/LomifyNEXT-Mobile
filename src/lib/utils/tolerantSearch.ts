/** Bounded matching for names, not a substitute for semantic/lyrics search. */
const transliteration: Record<string, string> = { а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'kh',ц:'ts',ч:'ch',ш:'sh',щ:'shch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya' };
const latinKeys = "qwertyuiop[]asdfghjkl;'zxcvbnm,.";
const russianKeys = 'йцукенгшщзхъфывапролджэячсмитьбю';
export function normalizeSearchText(value: unknown): string {
  return String(value ?? '').normalize('NFKD').toLocaleLowerCase('ru').replace(/ё/g,'е')
    .replace(/\p{M}/gu,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
}
function latin(value: string): string { return [...value].map(c => transliteration[c] ?? c).join(''); }
export function searchQueryVariants(query: string): string[] {
  const original = query.trim().replace(/\s+/g,' ');
  const letters = original.toLowerCase();
  const swapped = [...letters].map(c => {
    const at = latinKeys.indexOf(c), ru = russianKeys.indexOf(c);
    return at >= 0 ? russianKeys[at] : ru >= 0 ? latinKeys[ru] : c;
  }).join('');
  return [...new Set([original, swapped, latin(letters)])].filter(Boolean);
}
function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length-b.length)>max) return max+1;
  let previous = Array.from({length:b.length+1},(_,i)=>i), older = previous;
  for(let i=1;i<=a.length;i++) {
    const row=[i]; let least=i;
    for(let j=1;j<=b.length;j++) {
      row[j]=Math.min(previous[j]+1,row[j-1]+1,previous[j-1]+(a[i-1]===b[j-1]?0:1));
      if(i>1&&j>1&&a[i-1]===b[j-2]&&a[i-2]===b[j-1]) row[j]=Math.min(row[j],older[j-2]+1);
      least=Math.min(least,row[j]);
    }
    if(least>max) return max+1;
    older=previous; previous=row;
  }
  return previous[b.length];
}
export function searchMatchScore(text: unknown, query: string): number {
  const haystack=normalizeSearchText(text), original=normalizeSearchText(query);
  if(!haystack||!original) return 0;
  const words=haystack.split(' ').map(word=>word.slice(0,48));
  const variants=[...new Set([...searchQueryVariants(query).map(normalizeSearchText),latin(original)])];
  let best=0;
  for(let index=0;index<variants.length;index++) {
    const needle=variants[index];
    if(haystack===needle) best=Math.max(best,1000-index*80);
    else if(haystack.startsWith(needle)) best=Math.max(best,800-index*80);
    else if(haystack.includes(needle)) best=Math.max(best,650-index*80);
    if(best>=650) return best;
    const tokens=needle.split(' ').slice(0,8); let score=0;
    for(const token of tokens) {
      let match=0;
      for(const word of words) {
        const candidates=[word,latin(word)];
        for(const candidate of candidates) {
          if(candidate===token) match=Math.max(match,120);
          else if(candidate.startsWith(token)) match=Math.max(match,100);
          else if(token.length>=3&&candidate.includes(token)) match=Math.max(match,85);
          else if(token.length>=4&&token.length<=48) {
            const max=token.length>=7?2:1;
            const edits=distance(token,candidate,max);
            if(edits<=max) match=Math.max(match,70-edits*10);
          }
        }
      }
      if(!match) { score=0; break; }
      score+=match;
    }
    if(score) best=Math.max(best,300+score/tokens.length-index*60);
  }
  return best;
}
/** Yield during a large import so matching never monopolizes a navigation frame. */
export async function rankSearchMatches<T>(items: T[], query: string, label: (item:T)=>string, cancelled:()=>boolean=()=>false): Promise<T[]> {
  const matches: Array<{item:T;score:number;order:number}>=[];
  for(let i=0;i<items.length;i++) {
    if(cancelled()) return [];
    const score=searchMatchScore(label(items[i]),query);
    if(score) matches.push({item:items[i],score,order:i});
    if(i%80===79) await new Promise<void>(resolve=>setTimeout(resolve,0));
  }
  return matches.sort((a,b)=>b.score-a.score||a.order-b.order).map(entry=>entry.item);
}
/** Retry another spelling only after an empty server response, in the same catalog. */
export async function searchWithQueryVariants<T>(query: string, lookup:(query:string)=>Promise<T[]>): Promise<{tracks:T[];correctedQuery?:string}> {
  const variants=searchQueryVariants(query);
  const original=variants[0]||'';
  const tracks=await lookup(original);
  if(tracks.length||original.length<3) return {tracks};
  for(const alternate of variants.slice(1,3)) {
    const found=await lookup(alternate);
    if(found.length) return {tracks:found,correctedQuery:alternate};
  }
  return {tracks:[]};
}
