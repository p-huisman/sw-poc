import {
  getQueueStatus,
  startFetchQueuing,
  stopFetchQueuing,
} from "./fetch-queue";

describe("fetch-queue", () => {
  it("replaces window.fetch while queuing and restores it afterwards", () => {
    const original = window.fetch;
    startFetchQueuing();
    expect(window.fetch).not.toBe(original);
    expect(getQueueStatus().isQueuing).toBeTrue();
    stopFetchQueuing(true);
    expect(window.fetch).toBe(original);
    expect(getQueueStatus().isQueuing).toBeFalse();
  });

  it("queues requests while active and rejects them when the queue is removed", async () => {
    startFetchQueuing();
    const pending = window.fetch("https://example.com/never-sent");
    expect(getQueueStatus().queueLength).toBe(1);
    stopFetchQueuing(true);
    await expectAsync(pending).toBeRejectedWithError(/cancelled/);
    expect(getQueueStatus().queueLength).toBe(0);
  });

  it("flushes queued requests through the original fetch on stop", async () => {
    startFetchQueuing();
    // /dist/p-auth.spec.js is served by the test dev server (it is the
    // script the test page itself was loaded from)
    const pending = window.fetch("/dist/p-auth.spec.js");
    stopFetchQueuing();
    const response = await pending;
    expect(response.ok).toBeTrue();
  });

  it("rejects queued requests that exceed the queue timeout", async () => {
    jasmine.clock().install();
    try {
      startFetchQueuing();
      const pending = window.fetch("https://example.com/timeout");
      const assertion = expectAsync(pending).toBeRejectedWithError(/timed out/);
      jasmine.clock().tick(30001);
      await assertion;
      expect(getQueueStatus().queueLength).toBe(0);
    } finally {
      stopFetchQueuing(true);
      jasmine.clock().uninstall();
    }
  });

  it("starting twice is a no-op with a warning", () => {
    startFetchQueuing();
    spyOn(console, "warn");
    startFetchQueuing();
    expect(console.warn).toHaveBeenCalled();
    stopFetchQueuing(true);
  });
});
