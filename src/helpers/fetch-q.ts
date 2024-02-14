interface FetchQueueItem {
    args: [URL | RequestInfo, RequestInit?];
    resolve: (value: Response) => void;
    reject: (reason: Error) => void;
  }
  
  const originalFetch = window.fetch;
  const fetchQueue: FetchQueueItem[] = [];
  
  const fetchQueueFn = async (
    url: URL | RequestInfo,
    requestInit?: RequestInit
  ): Promise<Response> => {
    const qItem: any = {
      args: [url, requestInit],
    };
    const promise = new Promise((resolve, reject) => {
      qItem.resolve = resolve;
      qItem.reject = reject;
    });
    fetchQueue.push(qItem);
    return promise as Promise<Response>;
  };
  
  window.fetch = fetchQueueFn;
  
  export function fetchQueueAndRestoreOriginalFetch() {
    window.fetch = originalFetch;
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
  