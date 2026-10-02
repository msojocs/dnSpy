using System.Threading.Channels;
using ICorDebugSharp;

namespace dnSpy.Backend.Debugging.CorDebug;

/// <summary>
/// Turns the runtime's managed callbacks into work on the session's dispatcher.
///
/// The runtime blocks while a callback is in flight, so no ICorDebug call may happen on the
/// callback thread: each callback only enqueues a closure. After every event the pump resumes the
/// process unless the session deliberately stopped, because the runtime delivers no further events
/// until the debugger continues — missing a single event stalls the debuggee permanently.
/// </summary>
internal sealed class CorDebugEventPump : IDisposable {
	readonly Channel<Action> actions = Channel.CreateUnbounded<Action>(new UnboundedChannelOptions { SingleReader = true });
	readonly CorDebugManagedCallback callbacks = new();
	readonly CorDebugSession session;
	Task? drain;

	public CorDebugEventPump(CorDebugSession session) {
		this.session = session;
		// Subscribe only the catch-all: the runtime raises events this engine has no interest in
		// (LoadAssembly, NameChange, ...), and every one of them still has to be answered with a
		// Continue. Subscribing the typed events too would only enqueue each event twice.
		callbacks.OnAnyEvent += (_, e) => Enqueue(() => {
			try {
				session.HandleEvent(e);
			}
			catch (Exception ex) when (ModuleTable.IsComFailure(ex)) {
				// The object the event refers to was already collected by the runtime.
			}
			session.AfterEventProcessed();
		});
	}

	/// <summary>The handler to install with <c>SetManagedHandler</c>.</summary>
	public CorDebugManagedCallback Callbacks => callbacks;

	/// <summary>
	/// Starts draining. Call this only once the session has an <c>ICorDebugProcess</c>, otherwise
	/// events delivered during <c>DebugActiveProcess</c> would be resumed before there is anything
	/// to resume them with, and the event stream would stall.
	/// </summary>
	public void Start() => drain ??= Task.Run(DrainAsync);

	async Task DrainAsync() {
		while (await actions.Reader.WaitToReadAsync().ConfigureAwait(false)) {
			while (actions.Reader.TryRead(out var action)) {
				await session.Dispatcher.RunAsync(action).ConfigureAwait(false);
			}
		}
	}

	void Enqueue(Action action) => actions.Writer.TryWrite(action);

	public void Dispose() {
		actions.Writer.TryComplete();
		try {
			drain?.Wait(TimeSpan.FromSeconds(2));
		}
		catch (AggregateException) {
			// The debuggee is gone; a failed drain has nothing left to report.
		}
	}
}
