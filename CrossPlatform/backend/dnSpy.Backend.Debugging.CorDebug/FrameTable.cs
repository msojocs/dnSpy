using ICorDebugSharp;

namespace dnSpy.Backend.Debugging.CorDebug;

/// <summary>
/// One frame of a stopped thread, kept alive for as long as the client can still ask about it.
/// </summary>
internal sealed class FrameEntry {
	public FrameEntry(int id, ICorDebugFrame frame, int threadId) {
		Id = id;
		Frame = frame;
		ThreadId = threadId;
	}

	public int Id { get; }

	public ICorDebugFrame Frame { get; }

	public int ThreadId { get; }

	/// <summary>
	/// The handle the client was given for this frame's locals, handed out once so that asking for
	/// the scopes twice does not leak a second handle.
	/// </summary>
	public int LocalsReference { get; set; }
}

/// <summary>
/// The frames of the current stop, in the order the client sees them.
/// </summary>
/// <remarks>
/// An ICorDebug frame is a COM object with no identity of its own and no validity once the process
/// runs again, so the table is rebuilt at every stop and cleared on the way out. Ids keep counting
/// up across stops: the client remembers the frame it last selected, and a recycled id would make
/// that selection resolve to an unrelated frame.
/// </remarks>
internal sealed class FrameTable {
	readonly object gate = new();
	readonly Dictionary<int, FrameEntry> frames = new();
	int sequence;

	public FrameEntry Add(ICorDebugFrame frame, int threadId) {
		lock (gate) {
			var entry = new FrameEntry(++sequence, frame, threadId);
			frames[entry.Id] = entry;
			return entry;
		}
	}

	public FrameEntry? Find(int id) {
		lock (gate)
			return frames.TryGetValue(id, out var entry) ? entry : null;
	}

	public void Clear() {
		lock (gate)
			frames.Clear();
	}
}
