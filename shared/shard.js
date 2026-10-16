// Step 9: which worker process owns a coven. Covens are sharded by their
// 4-letter code (FNV-1a), so the coordinator can route any connection that
// names a code (?coven=ABCD) to the one worker that runs it, and the client
// can tell whether it is already connected to the right one.

export function shardOf(code, workers) {
  if (!(workers > 1)) return 0;
  let h = 0x811c9dc5;
  const s = String(code).toUpperCase();
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % workers;
}
