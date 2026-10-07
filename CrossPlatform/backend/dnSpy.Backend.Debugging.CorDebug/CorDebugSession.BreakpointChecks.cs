using ICorDebugSharp;
using ICorDebugSharp.Extensions;

namespace dnSpy.Backend.Debugging.CorDebug;

/// <summary>
/// The half of a session that decides whether a breakpoint hit actually stops the debuggee: the
/// scopes a condition and a filter read, and the stop a tracepoint message describes.
/// </summary>
/// <remarks>
/// All of this runs on the dispatcher, inside the runtime's callback, so nothing here may touch the
/// decompiler — that is why a condition's variable names are resolved when the breakpoint is set
/// instead (see <c>ResolveVariableSlotsAsync</c>) and why a frame names itself from its metadata.
/// </remarks>
internal sealed partial class CorDebugSession {
	/// <summary>The names a breakpoint filter knows, which are the debugger's, not the debuggee's.</summary>
	sealed class EnvironmentScope : IBreakpointScope {
		readonly CorDebugSession session;
		readonly ICorDebugThread thread;

		public EnvironmentScope(CorDebugSession session, ICorDebugThread thread) {
			this.session = session;
			this.thread = thread;
		}

		public bool TryRead(string name, out BreakpointValue value) {
			var threadId = ThreadTable.TryGetId(thread);
			switch (name) {
				case "MachineName":
					value = BreakpointValue.FromString(Environment.MachineName);
					return true;
				case "ProcessId":
					value = BreakpointValue.FromInteger(session.TargetProcessId);
					return true;
				case "ProcessName":
					value = BreakpointValue.FromString(session.ProcessName ?? string.Empty);
					return true;
				case "ThreadId":
					value = threadId is null ? BreakpointValue.Null : BreakpointValue.FromInteger(threadId.Value);
					return true;
				case "ThreadName":
					value = threadId is null ? BreakpointValue.Null : BreakpointValue.FromString(ThreadTable.Describe(threadId.Value));
					return true;
				default:
					value = BreakpointValue.Null;
					return false;
			}
		}
	}

	/// <summary>
	/// One breakpoint hit, as its condition, filter and trace message see it. Frames are walked only
	/// as deep as something actually asks for, because a condition on a hot line is checked on every
	/// iteration and the whole stack is almost never what it wants.
	/// </summary>
	sealed class HitRuntime : IBreakpointHitRuntime, ITracepointContext, IBreakpointScope {
		readonly CorDebugSession session;
		readonly BreakpointEntry entry;
		readonly ICorDebugThread thread;
		ICorDebugFrame[]? frames;
		int walkedCount;

		public HitRuntime(CorDebugSession session, BreakpointEntry entry, ICorDebugThread thread) {
			this.session = session;
			this.entry = entry;
			this.thread = thread;
		}

		public IBreakpointScope FilterScope => new EnvironmentScope(session, thread);

		public IBreakpointScope ConditionScope => this;

		public string RenderTrace(TracepointMessage message) => message.Render(this);

		// ------------------------------------------------ the condition's scope

		/// <summary>
		/// Reads a name out of the stopped frame. The slots were named when the breakpoint was set, so
		/// the lookup here is a dictionary hit and a value read — no decompilation on the dispatcher.
		/// </summary>
		public bool TryRead(string name, out BreakpointValue value) {
			value = BreakpointValue.Null;
			if (!entry.VariableSlots.TryGetValue(name, out var slot))
				return false;
			if (Frame(0) is not ICorDebugILFrame frame)
				return false;
			try {
				var values = slot.IsArgument ? frame.Arguments : frame.LocalVariables;
				var index = 0;
				foreach (var candidate in values) {
					if (index++ != slot.Index)
						continue;
					value = session.Formatter.ReadValue(candidate);
					return true;
				}
				return false;
			}
			catch (Exception ex) when (ModuleTable.IsComFailure(ex)) {
				return false;
			}
		}

		// ------------------------------------------------ the tracepoint's context

		public string? AppDomainId {
			get {
				try {
					return thread.AppDomain?.Id.ToString(System.Globalization.CultureInfo.InvariantCulture);
				}
				catch (Exception ex) when (ModuleTable.IsComFailure(ex)) {
					return null;
				}
			}
		}

		/// <summary>
		/// Where the breakpoint sits. The engine never sees a native address — it places breakpoints by
		/// method and IL offset — so that is what this reports instead.
		/// </summary>
		public string? BreakpointAddress =>
			$"{TracepointMessage.Hex(entry.MetadataToken, 8)}+{TracepointMessage.Hex(entry.BoundIlOffset)}";

		/// <summary>
		/// The managed thread id, which lives in a field of the debuggee's <c>Thread</c> object. Reading
		/// it needs metadata the engine does not have, so <c>$MID</c> has nothing to report.
		/// </summary>
		public string? ManagedThreadId => null;

		public string? ProcessId => TracepointMessage.Hex(session.TargetProcessId);

		public string? ProcessName => session.ProcessName;

		public string? ThreadId => ThreadTable.TryGetId(thread) is int id ? TracepointMessage.Hex(id) : null;

		public string? ThreadName => ThreadTable.TryGetId(thread) is int id ? ThreadTable.Describe(id) : null;

		public string? FrameAddress(int index) =>
			Frame(index) is { } frame ? $"{Name(index, frame)}+{TracepointMessage.Hex(ReadIlOffset(frame))}" : null;

		public string? FrameCaller(int index) => Frame(index) is { } frame ? Name(index, frame) : null;

		public string? FrameFunction(int index) => FrameCaller(index);

		public string? FrameModule(int index) {
			if (Frame(index) is not { } frame)
				return null;
			var (modulePath, _) = FrameIdentity(frame);
			return string.IsNullOrEmpty(modulePath) ? null : modulePath;
		}

		public string? FrameOffset(int index) =>
			Frame(index) is { } frame ? TracepointMessage.Hex(ReadIlOffset(frame), 8) : null;

		public string? FrameToken(int index) {
			if (Frame(index) is not { } frame)
				return null;
			var (_, token) = FrameIdentity(frame);
			return TracepointMessage.Hex(token, 8);
		}

		public string? Evaluate(string expression) {
			// A failure here is the user's expression being wrong, so it travels up as an error rather
			// than printing "???" — that is how a mistyped tracepoint gets noticed.
			var value = BreakpointExpression.ParseCached(expression).Evaluate(this);
			return value.Describe();
		}

		/// <summary>
		/// What a frame is called. Naming it properly means decompiling it, which cannot happen here, so
		/// it reads as module and token — except the frame the breakpoint is in, whose signature the
		/// resolver already handed over when the breakpoint was set.
		/// </summary>
		string Name(int index, ICorDebugFrame frame) {
			if (index == 0 && !string.IsNullOrEmpty(entry.Description))
				return entry.Description;
			var (modulePath, token) = FrameIdentity(frame);
			return string.IsNullOrEmpty(modulePath)
				? $"0x{token:X8}"
				: $"{Path.GetFileName(modulePath)}!0x{token:X8}";
		}

		ICorDebugFrame? Frame(int index) {
			if (index < 0)
				return null;
			// Re-walk only when more frames are wanted than were taken last time, and only when the
			// previous walk stopped at its cap rather than at the bottom of the stack.
			if (frames is null || (index >= walkedCount && frames.Length == walkedCount)) {
				walkedCount = Math.Max(index + 1, walkedCount);
				try {
					frames = WalkFrames(thread, walkedCount).ToArray();
				}
				catch (Exception ex) when (ModuleTable.IsComFailure(ex)) {
					frames = [];
				}
			}
			return index < frames.Length ? frames[index] : null;
		}
	}

	/// <summary>The debuggee's executable name, which <c>$PNAME</c> and a filter both ask for.</summary>
	string? ProcessName {
		get {
			if (!string.IsNullOrEmpty(LaunchProgram))
				return LaunchProgram;
			try {
				return debuggee?.ProcessName;
			}
			catch (InvalidOperationException) {
				return null;
			}
		}
	}

	/// <summary>
	/// Checks a hit against the breakpoint's settings and reports what it decided. Returns true when
	/// the debuggee should stop; a false answer leaves <c>Stop()</c> uncalled, and
	/// <see cref="AfterEventProcessed"/> resumes the process — which is all "print and continue" needs.
	/// </summary>
	bool ShouldBreakOnHit(BreakpointEntry entry, ICorDebugThread thread) {
		if (entry.Settings.IsDefault)
			return entry.Enabled;
		var decision = BreakpointBreakDecision.Evaluate(entry.Enabled, entry.Settings, entry.HitState, new HitRuntime(this, entry, thread));
		if (decision.TraceMessage is not null)
			Emit(DebugEventNames.Output, new { category = "console", output = decision.TraceMessage + "\n" });
		if (decision.ErrorMessage is not null)
			Emit(DebugEventNames.Output, new { category = "stderr", output = decision.ErrorMessage + "\n" });
		if (decision.HitCountChanged)
			EmitBreakpointChanged(entry);
		return decision.ShouldBreak;
	}
}
