/** Give the navigation/pressed state one paint before mounting a new screen. */
export function afterMobilePaint(work: () => void): () => void {
  let cancelled = false;
  let frame = 0;
  let task: ReturnType<typeof setTimeout> | undefined;
  const run = () => { if (!cancelled) work(); };
  if (document.hidden) task = setTimeout(run, 0);
  else frame = requestAnimationFrame(() => { task = setTimeout(run, 0); });
  return () => {
    cancelled = true;
    cancelAnimationFrame(frame);
    if (task !== undefined) clearTimeout(task);
  };
}
