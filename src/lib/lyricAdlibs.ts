export interface AdlibItem {
  text: string;
  isPrefix: boolean;
  triggerThreshold: number;
  time?: number;
}
export interface AdlibCue {
  id: string;
  text: string;
  side: 'left' | 'right' | 'center';
  start: number;
  end: number;
}
const wordStamp = /<(\d+):(\d+(?:\.\d+)?)>/gu;
export const stripLyricTimestamps = (text: string) => text.replace(wordStamp, '');
function speechWeight(text: string): number {
  const clean = stripLyricTimestamps(text).replace(/[()[\]]/gu, '');
  const vowels = clean.match(/[аеёиоуыэюяaeiouy]/giu)?.length ?? 0;
  const words = clean.trim().split(/\s+/u).filter(Boolean).length;
  return vowels * .22 + words * .16;
}

export function extractAdlibs(text: string): { mainText: string; adlibs: AdlibItem[] } {
  const adlibs: AdlibItem[] = [];
  const totalWeight = Math.max(.1, speechWeight(text));
  for (const match of text.matchAll(/\(([^)]+)\)/gu)) {
    const content = stripLyricTimestamps(match[1]).trim();
    if (!content) continue;
    const before = text.slice(0, match.index);
    // Enhanced LRC may contain an actual timestamp for the backing vocal.
    const stamp = match[1].match(/^\s*<(\d+):(\d+(?:\.\d+)?)>/u) ??
      before.match(/<(\d+):(\d+(?:\.\d+)?)>\s*$/u);
    adlibs.push({ text: content, isPrefix: !stripLyricTimestamps(before).trim(),
      triggerThreshold: Math.min(.95, speechWeight(before) / totalWeight),
      ...(stamp ? { time: Number(stamp[1]) * 60 + Number(stamp[2]) } : {}) });
  }
  const mainText = stripLyricTimestamps(text).replace(/\(([^)]+)\)/gu, ' ')
    .replace(/\s+([,.:!?…])/gu, '$1').replace(/\s+/gu, ' ').trim();
  return { mainText, adlibs };
}

/** Build from source lines before synthetic pause rows are inserted. */
export function buildAdlibTimeline(
  lines: Array<{ time: number; text: string; adlibs?: AdlibItem[] }>,
  sungDuration: (text: string, gap: number) => number
): AdlibCue[] {
  const cues: AdlibCue[] = [];
  lines.forEach((line, index) => {
    if (line.time < 0) return;
    const gap = Math.max(.4, (lines[index + 1]?.time ?? line.time + 3.2) - line.time);
    const singing = sungDuration(line.text, gap);
    line.adlibs?.forEach((adlib, part) => {
      const start = adlib.time ?? line.time + (adlib.isPrefix ? 0 : singing * adlib.triggerThreshold);
      const visible = Math.min(3.6, Math.max(1.8, speechWeight(adlib.text) + 1.2));
      cues.push({ id: `${index}:${part}`, text: adlib.text,
        side: adlib.text.length > 6 ? 'center' : (index + part) % 2 ? 'right' : 'left',
        start, end: start + visible });
    });
  });
  cues.sort((a, b) => a.start - b.start);
  return cues;
}

/** Seeking and line changes use audio time; they never reset the cue clock. */
export function activeAdlibAt(cues: AdlibCue[], position: number): AdlibCue | null {
  if (!Number.isFinite(position)) return null;
  let low = 0, high = cues.length - 1, found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (cues[middle].start <= position) { found = middle; low = middle + 1; }
    else high = middle - 1;
  }
  const cue = cues[found];
  return cue && position < cue.end ? cue : null;
}
