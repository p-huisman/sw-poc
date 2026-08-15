/**
 * Intercept fetch requests and queue them.
 *
 * Used to hold page requests while the authentication service worker is
 * being registered and clients are initialised. Once authentication is
 * ready the queue is flushed (or rejected) and the original fetch is
 * restored.
 */

interface QueuedFetchRequest {
  args: [URL | RequestInfo, RequestInit?];
  resolve: (value: Response) => void;
  reject: (reason: Error) => void;
  timestamp: number;
}

// Save the original fetch function (bound, so it can be called standalone)
const originalFetch = window.fetch.bind(window);

// Queue for the fetch requests
const fetchQueue: QueuedFetchRequest[] = [];

// Track if queuing is active to prevent double initialization
let isQueuing = false;

// Timeout for queued requests (30 seconds)
const QUEUE_TIMEOUT_MS = 30000;

/**
 * Start queuing the fetch requests
 *
 * @description Replaces window.fetch with a version that queues requests
 * until stopFetchQueuing is called. Calling it twice is a no-op.
 * @see stopFetchQueuing
 */
export function startFetchQueuing(): void {
  if (isQueuing) {
    console.warn("[fetch-queue] Already queuing fetch requests");
    return;
  }
  isQueuing = true;
  window.fetch = queueFetchRequest;
}

/**
 * Stop queuing the fetch requests
 *
 * @param removeQueue - reject and discard the queued requests instead of
 * flushing them through the original fetch function
 *
 * @description Restores the original fetch function and then either flushes
 * the queued requests (default) or rejects them (removeQueue = true).
 * @see startFetchQueuing
 */
export function stopFetchQueuing(removeQueue = false): void {
  if (!isQueuing) {
    console.warn("[fetch-queue] Not currently queuing fetch requests");
    return;
  }

  isQueuing = false;
  window.fetch = originalFetch;

  if (removeQueue) {
    // Properly reject all queued promises to prevent memory leaks
    while (fetchQueue.length > 0) {
      const item = fetchQueue.pop();
      if (item) {
        item.reject(new Error("Fetch request cancelled during queue cleanup"));
      }
    }
    return;
  }

  const queue = fetchQueue.splice(0, fetchQueue.length);

  // Flush the queued requests through the original fetch function
  queue.forEach((item) => {
    // Do not flush requests that already expired while queued
    if (Date.now() - item.timestamp > QUEUE_TIMEOUT_MS) {
      item.reject(new Error("Fetch request timed out in queue"));
      return;
    }

    originalFetch(item.args[0], item.args[1]).then(item.resolve, item.reject);
  });
}

/**
 * Queue the fetch request
 *
 * @param url - The URL to fetch
 * @param requestInit - The request options
 * @returns Promise<Response>
 *
 * @description The replacement fetch function that queues requests while
 * queuing is active. Each queued request is rejected after QUEUE_TIMEOUT_MS
 * to prevent requests from hanging forever.
 */
async function queueFetchRequest(
  url: URL | RequestInfo,
  requestInit?: RequestInit,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const qItem: QueuedFetchRequest = {
      args: [url, requestInit],
      resolve,
      reject,
      timestamp: Date.now(),
    };

    fetchQueue.push(qItem);

    // Timeout protection for individual requests
    setTimeout(() => {
      const index = fetchQueue.indexOf(qItem);
      if (index !== -1) {
        fetchQueue.splice(index, 1);
        reject(new Error("Fetch request timed out in queue"));
      }
    }, QUEUE_TIMEOUT_MS);
  });
}

/**
 * Get the current queue status
 * @returns Object with queue information
 */
export function getQueueStatus() {
  return {
    isQueuing,
    queueLength: fetchQueue.length,
    oldestRequest: fetchQueue.length > 0 ? fetchQueue[0].timestamp : null,
  };
}
