/**
 * Intercept fetch requests and queue them
 */

interface QueuedFetchRequest {
  args: [URL | RequestInfo, RequestInit?];
  resolve: (value: Response) => void;
  reject: (reason: Error) => void;
}

// Save the original fetch function
const originalFetch = fetch;

// Queue for the fetch requests
const fetchQueue: QueuedFetchRequest[] = [];

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
  window.fetch = originalFetch;
  if (removeQueue) {
    while (fetchQueue.length > 0) {
      fetchQueue.pop();
    }
  }
  const queue = fetchQueue.splice(0, fetchQueue.length);
  queue.forEach((item: any) => {
    if (item.args) {
      originalFetch(item.args[0], item.args[1])
        .then((response: any) => {
          item.resolve(response);
        })
        .catch((error) => {
          item.reject(error);
        });
    }
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
  const qItem: any = {
    args: [url, requestInit],
  };
  const promise = new Promise((resolve, reject) => {
    qItem.resolve = resolve;
    qItem.reject = reject;
  });
  fetchQueue.push(qItem);
  return promise as Promise<Response>;
}
