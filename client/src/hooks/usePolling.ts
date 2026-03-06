import { useEffect, useRef } from 'react';

// Polls a callback every `intervalMs` until `shouldStop` returns true or component unmounts
export function usePolling(
  callback: () => Promise<void>,
  intervalMs: number,
  shouldStop: boolean
) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (shouldStop) return;

    const run = async () => {
      await callbackRef.current();
    };

    run();
    const id = setInterval(run, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, shouldStop]);
}
