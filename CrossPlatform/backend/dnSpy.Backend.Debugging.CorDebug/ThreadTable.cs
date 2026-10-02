using System.Globalization;
using System.Runtime.InteropServices;
using ICorDebugSharp;
using ICorDebugSharp.Extensions;

namespace dnSpy.Backend.Debugging.CorDebug;

/// <summary>
/// Tracks the threads the runtime reports through <c>CreateThread</c>/<c>ExitThread</c>.
/// Lookups are by the runtime's thread id, which is what the client uses in stack trace requests.
/// </summary>
internal sealed class ThreadTable {
	readonly object gate = new();
	readonly Dictionary<int, ICorDebugThread> threads = new();

	public void Add(ICorDebugThread thread) {
		if (TryGetId(thread) is not int id)
			return;
		lock (gate)
			threads[id] = thread;
	}

	public void Remove(ICorDebugThread thread) {
		if (TryGetId(thread) is not int id)
			return;
		lock (gate)
			threads.Remove(id);
	}

	public IReadOnlyList<(int Id, ICorDebugThread Thread)> Snapshot() {
		lock (gate)
			return threads.OrderBy(pair => pair.Key).Select(pair => (pair.Key, pair.Value)).ToArray();
	}

	public ICorDebugThread? Find(int id) {
		lock (gate)
			return threads.TryGetValue(id, out var thread) ? thread : null;
	}

	public void Clear() {
		lock (gate)
			threads.Clear();
	}

	public static string Describe(int id) => $"Thread {id.ToString(CultureInfo.InvariantCulture)}";

	/// <summary>Reads the runtime thread id, or <c>null</c> if the thread has already gone away.</summary>
	internal static int? TryGetId(ICorDebugThread thread) {
		try {
			return thread.Id;
		}
		catch (Exception ex) when (ex is COMException or InvalidCastException or InvalidOperationException or NotSupportedException) {
			return null;
		}
	}
}
