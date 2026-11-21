export async function stopWithDeadline(stop: () => Promise<void>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve()
        .then(stop)
        .then(
          () => true,
          () => false,
        ),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function handleShutdown(stop: () => Promise<void>, timeoutMs = 10_000) {
  let stopping = false;
  const onSignal = () => {
    if (stopping) return;
    stopping = true;
    void stopWithDeadline(stop, timeoutMs).then((finished) => {
      if (!finished) console.error('Shutdown did not complete within its deadline');
      process.exit(finished ? 0 : 1);
    });
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
}
