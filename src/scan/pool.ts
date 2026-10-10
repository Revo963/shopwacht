/** Runs `fn` over `items` with at most `limit` in flight. Stops scheduling after the first failure. */
export async function pool<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < items.length) {
      signal?.throwIfAborted();
      const i = next++;
      try {
        await fn(items[i]!, i);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
}
