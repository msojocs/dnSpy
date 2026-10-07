using System.Globalization;

namespace dnSpy.Backend.Debugging.CorDebug;

/// <summary>What checking a hit decided: whether to stop, and what to tell the user.</summary>
public readonly record struct BreakpointDecision(
	bool ShouldBreak,
	string? TraceMessage = null,
	string? ErrorMessage = null,
	bool HitCountChanged = false);

/// <summary>Everything checking a hit needs from the stopped debuggee.</summary>
public interface IBreakpointHitRuntime {
	/// <summary>The five names a filter knows: machine, process and thread.</summary>
	IBreakpointScope FilterScope { get; }

	/// <summary>The stopped frame's arguments and locals, which a condition reads.</summary>
	IBreakpointScope ConditionScope { get; }

	string RenderTrace(TracepointMessage message);
}

/// <summary>
/// Decides whether a hit stops the debuggee, which is the port of WPF's
/// <c>BreakpointBreakChecker.ShouldBreak</c>.
/// </summary>
/// <remarks>
/// The order is WPF's and matters: the filter and the condition are gates that a failing hit does not
/// get counted by, the hit count is then raised unconditionally, and only after that does the hit
/// count itself decide. An error anywhere breaks rather than skips — a mistyped condition should be
/// noticed, not silently turn the breakpoint off.
/// <para>
/// Nothing here touches the runtime directly: the state is a plain object and the debuggee arrives as
/// an interface, so the whole decision is testable without a live process.
/// </para>
/// </remarks>
public static class BreakpointBreakDecision {
	public static BreakpointDecision Evaluate(bool enabled, BreakpointSettings settings, BreakpointHitState state, IBreakpointHitRuntime runtime) {
		if (!enabled)
			return new BreakpointDecision(false);

		if (settings.Filter is { Length: > 0 } filter) {
			try {
				if (!BreakpointExpression.ParseCached(filter).EvaluateAsBoolean(runtime.FilterScope))
					return new BreakpointDecision(false);
			}
			catch (BreakpointExpressionException ex) {
				return new BreakpointDecision(true, ErrorMessage: $"Breakpoint filter '{filter}': {ex.Message}");
			}
		}

		if (settings.Condition is { } condition) {
			try {
				if (!CheckCondition(condition, state, runtime))
					return new BreakpointDecision(false);
			}
			catch (BreakpointExpressionException ex) {
				return new BreakpointDecision(true, ErrorMessage: $"Breakpoint condition '{condition.Expression}': {ex.Message}");
			}
		}

		// This counts as a hit even when there is no hit count option, which is what makes the count
		// the pane shows mean "times this breakpoint was reached and wanted".
		state.HitCount++;

		if (settings.HitCount is { } hitCount) {
			var (matches, error) = CheckHitCount(hitCount, state.HitCount);
			if (error is not null)
				return new BreakpointDecision(true, ErrorMessage: error, HitCountChanged: true);
			if (!matches)
				return new BreakpointDecision(false, HitCountChanged: true);
		}

		if (settings.Trace is { } trace) {
			string message;
			try {
				message = runtime.RenderTrace(TracepointMessage.Parse(trace.Message));
			}
			catch (BreakpointExpressionException ex) {
				return new BreakpointDecision(true, ErrorMessage: $"Tracepoint message: {ex.Message}", HitCountChanged: true);
			}
			// Continue means print and keep running: the tracepoint never becomes a stop.
			return new BreakpointDecision(!trace.Continue, TraceMessage: message, HitCountChanged: true);
		}

		return new BreakpointDecision(true, HitCountChanged: true);
	}

	static bool CheckCondition(BreakpointCondition condition, BreakpointHitState state, IBreakpointHitRuntime runtime) {
		var expression = BreakpointExpression.ParseCached(condition.Expression);
		if (condition.Kind == BreakpointConditionKind.IsTrue)
			return expression.EvaluateAsBoolean(runtime.ConditionScope);

		var value = expression.Evaluate(runtime.ConditionScope).Describe();
		// The first hit has nothing to compare against, so it records the value and lets the program
		// run on — the same answer WPF gives when its saved value is still null.
		var changed = state.HasConditionValue && !string.Equals(state.LastConditionValue, value, StringComparison.Ordinal);
		state.LastConditionValue = value;
		state.HasConditionValue = true;
		return changed;
	}

	static (bool Matches, string? Error) CheckHitCount(BreakpointHitCount hitCount, int current) => hitCount.Kind switch {
		BreakpointHitCountKind.Equals => (current == hitCount.Count, null),
		BreakpointHitCountKind.MultipleOf => hitCount.Count <= 0
			? (false, $"Invalid hit count value: {hitCount.Count.ToString(CultureInfo.InvariantCulture)}")
			: (current % hitCount.Count == 0, null),
		BreakpointHitCountKind.GreaterThanOrEquals => (current >= hitCount.Count, null),
		_ => (false, $"Unknown hit count kind: {hitCount.Kind}"),
	};
}
