namespace dnSpy.Backend.Debugging.CorDebug;

/// <summary>How a breakpoint's condition decides, matching WPF's <c>DbgCodeBreakpointConditionKind</c>.</summary>
public enum BreakpointConditionKind {
	/// <summary>Break when the expression evaluates to true.</summary>
	IsTrue,
	/// <summary>Break when the expression's value differs from the one the last hit saw.</summary>
	WhenChanged,
}

/// <summary>How a breakpoint's hit count decides, matching WPF's <c>DbgCodeBreakpointHitCountKind</c>.</summary>
public enum BreakpointHitCountKind {
	Equals,
	MultipleOf,
	GreaterThanOrEquals,
}

public sealed record BreakpointCondition(BreakpointConditionKind Kind, string Expression);

public sealed record BreakpointHitCount(BreakpointHitCountKind Kind, int Count);

/// <summary>A tracepoint: what to print, and whether the debuggee keeps running afterwards.</summary>
public sealed record BreakpointTrace(string Message, bool Continue);

/// <summary>
/// The per-breakpoint options a hit is checked against, the port's answer to WPF's
/// <c>DbgCodeBreakpointSettings</c>. <c>IsEnabled</c> is not here because the entry already carries it.
/// </summary>
public sealed record BreakpointSettings {
	public static readonly BreakpointSettings None = new();

	public BreakpointCondition? Condition { get; init; }

	public BreakpointHitCount? HitCount { get; init; }

	/// <summary>An expression over the debugger's own environment, not over the debuggee's code.</summary>
	public string? Filter { get; init; }

	public BreakpointTrace? Trace { get; init; }

	/// <summary>Free-form tags. They carry no behaviour; the client groups and shows them.</summary>
	public IReadOnlyList<string> Labels { get; init; } = Array.Empty<string>();

	public bool IsDefault =>
		Condition is null && HitCount is null && Filter is null && Trace is null && Labels.Count == 0;

	/// <summary>
	/// Whether anything here reads the debuggee's variables. Resolving their names goes through the
	/// decompiler, which must happen when the breakpoint is set rather than when it is hit, so this is
	/// what decides whether that work is done at all.
	/// </summary>
	public bool ReadsVariables =>
		Condition is not null || (Trace is not null && TracepointMessage.Parse(Trace.Message).Evaluates);
}

/// <summary>
/// What a breakpoint remembers between hits. It lives on the entry rather than in the settings so
/// that replacing the settings — the client re-sends the whole set on every change — does not reset
/// the count, which is what WPF's separate hit-count service achieves.
/// </summary>
public sealed class BreakpointHitState {
	/// <summary>Hits that got past the filter and the condition, which is what WPF counts.</summary>
	public int HitCount { get; set; }

	/// <summary>The condition's value at the previous hit, for <see cref="BreakpointConditionKind.WhenChanged"/>.</summary>
	public string? LastConditionValue { get; set; }

	/// <summary>Whether <see cref="LastConditionValue"/> has ever been written; null is a real value.</summary>
	public bool HasConditionValue { get; set; }
}
