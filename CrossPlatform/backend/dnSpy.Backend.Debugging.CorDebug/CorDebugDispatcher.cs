using System.Collections.Concurrent;

namespace dnSpy.Backend.Debugging.CorDebug;

/// <summary>
/// Serializes every ICorDebug call onto a single thread. The CLR debugging COM objects are not
/// thread safe, and managed callbacks must never run engine work on the callback thread itself
/// (the runtime blocks while a callback is in flight), so callback handling and client requests
/// both funnel through here.
/// </summary>
internal sealed class CorDebugDispatcher : IDisposable {
	readonly ConcurrentExclusiveSchedulerPair pair = new(TaskScheduler.Default, 1);
	readonly TaskFactory factory;

	public CorDebugDispatcher() => factory = new TaskFactory(pair.ExclusiveScheduler);

	/// <summary>Queues <paramref name="action"/> to run alone. Never canceled once queued.</summary>
	public Task<T> RunAsync<T>(Func<T> action) =>
		factory.StartNew(action, CancellationToken.None, TaskCreationOptions.DenyChildAttach, pair.ExclusiveScheduler);

	public Task RunAsync(Action action) => RunAsync(() => {
		action();
		return true;
	});

	public void Dispose() {
		// Let queued work drain; the session calls this only after the debuggee is gone.
		pair.Complete();
	}
}
