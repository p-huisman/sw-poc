/**
 * Intercept fetch requests and queue them
 */

interface QueuedFetchRequest {
  args: [URL | RequestInfo, RequestInit?];
  resolve: (value: Response) => void;
  reject: (reason: Error) => void;
  timestamp: number;
}

// Save the original fetch function
const originalFetch = fetch;

// Queue for the fetch requests
const fetchQueue: QueuedFetchRequest[] = [];

// Track if queuing is active to prevent double initialization
let isQueuing = false;

// Timeout for queued requests (30 seconds)
const QUEUE_TIMEOUT_MS = 30000;

/**
 * Start queuing the fetch requests
 * @returns Promise<void>
 * @async
 * @example
 * ```
 * await startFetchQueuing();
 * ```
 * @see stopFetchQueuing
 *
 * @description This function replaces the original fetch function with a new one that queues the requests
 */
export async function startFetchQueuing(): Promise<void> {
  if (isQueuing) {
    console.warn('[fetch-queue] Already queuing fetch requests');
    return;
  }
  isQueuing = true;
  window.fetch = queueFetchRequest;
}

/**
 * Stop queuing the fetch requests
 * @param removeQueue - remove the queue before restoring the original fetch function
 * @returns Promise<void>
 * @async
 * @example
 * ```
 * await stopFetchQueuing();
 * ```
 * @see startFetchQueuing
 *
 * @description This function restores the original fetch function and processes the queued requests
 */
export async function stopFetchQueuing(removeQueue = false): Promise<void> {
  if (!isQueuing) {
    console.warn('[fetch-queue] Not currently queuing fetch requests');
    return;
  }
  
  isQueuing = false;
  window.fetch = originalFetch;
  
  if (removeQueue) {
    // Properly reject all queued promises to prevent memory leaks
    while (fetchQueue.length > 0) {
      const item = fetchQueue.pop();
      if (item) {
        item.reject(new Error('Fetch request cancelled during queue cleanup'));
      }
    }
    return;
  }
  
  const queue = fetchQueue.splice(0, fetchQueue.length);
  
  // Process queued requests with proper error handling
  queue.forEach((item) => {
    if (!item.args || !item.resolve || !item.reject) {
      console.error('[fetch-queue] Invalid queued item:', item);
      return;
    }
    
    // Check for timeout
    const now = Date.now();
    if (now - item.timestamp > QUEUE_TIMEOUT_MS) {
      item.reject(new Error('Fetch request timed out in queue'));
      return;
    }
    
    originalFetch(item.args[0], item.args[1])
      .then((response) => {
        item.resolve(response);
      })
      .catch((error) => {
        item.reject(error);
      });
  });
}

/**
 * Queue the fetch request
 * @param url - The URL to fetch
 * @param requestInit - The request options
 * @returns Promise<Response>
 *
 * @description This original fetch function is replaced with this one that queues the requests
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
    
    // Add timeout protection for individual requests
    setTimeout(() => {
      const index = fetchQueue.indexOf(qItem);
      if (index !== -1) {
        fetchQueue.splice(index, 1);
        reject(new Error('Fetch request timed out in queue'));
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

/**
 * Clean up stale requests that have been in the queue too long
 * @returns Number of requests cleaned up
 */
export function cleanupStaleRequests(): number {
  const now = Date.now();
  let cleanedCount = 0;
  
  for (let i = fetchQueue.length - 1; i >= 0; i--) {
    const item = fetchQueue[i];
    if (now - item.timestamp > QUEUE_TIMEOUT_MS) {
      fetchQueue.splice(i, 1);
      item.reject(new Error('Fetch request timed out in queue'));
      cleanedCount++;
    }
  }
  
  return cleanedCount;
}
