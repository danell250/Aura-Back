import { yieldToEventLoop } from './asyncUtils';

export const runSettledBatches = async <T, R>(params: {
  items: T[];
  batchSize: number;
  worker: (item: T) => Promise<R>;
  onRejected?: (reason: unknown, item: T) => void;
  onFulfilled?: (value: R, item: T) => void;
}): Promise<R[]> => {
  const fulfilled: R[] = [];

  for (let start = 0; start < params.items.length; start += params.batchSize) {
    const batch = params.items.slice(start, start + params.batchSize);
    const settled = await Promise.allSettled(batch.map((item) => params.worker(item)));

    settled.forEach((result, index) => {
      const item = batch[index];
      if (result.status === 'rejected') {
        params.onRejected?.(result.reason, item);
        return;
      }

      fulfilled.push(result.value);
      params.onFulfilled?.(result.value, item);
    });

    await yieldToEventLoop();
  }

  return fulfilled;
};

export const runSettledConcurrentChunks = async <T>(params: {
  items: T[];
  concurrency: number;
  worker: (item: T) => Promise<void>;
  onRejected?: (reason: unknown, item: T) => void;
}): Promise<void> => {
  for (let start = 0; start < params.items.length; start += params.concurrency) {
    const chunk = params.items.slice(start, start + params.concurrency);
    const settled = await Promise.allSettled(chunk.map((item) => params.worker(item)));

    settled.forEach((result, index) => {
      if (result.status === 'rejected') {
        params.onRejected?.(result.reason, chunk[index]);
      }
    });

    await yieldToEventLoop();
  }
};
