using dnSpy.Backend.Debugging.CorDebug;
using Xunit;

namespace dnSpy.Backend.Tests;

/// <summary>
/// Covers the gate order a breakpoint hit goes through, which is the port of WPF's
/// <c>BreakpointBreakChecker.ShouldBreak</c>. The order is the behaviour: a filter and a condition are
/// gates that a failing hit is not counted by, the count is then raised unconditionally, and only
/// after that does the hit count itself decide.
/// </summary>
public sealed class BreakpointBreakDecisionTests {
	/// <summary>A stop with no debuggee behind it: named values, and a trace that renders its parts.</summary>
	sealed class Runtime : IBreakpointHitRuntime, ITracepointContext, IBreakpointScope {
		readonly Dictionary<string, BreakpointValue> values = new(StringComparer.Ordinal);

		public Runtime Set(string name, BreakpointValue value) {
			values[name] = value;
			return this;
		}

		public IBreakpointScope FilterScope => this;
		public IBreakpointScope ConditionScope => this;
		public string RenderTrace(TracepointMessage message) => message.Render(this);

		public bool TryRead(string name, out BreakpointValue value) => values.TryGetValue(name, out value);

		public string? AppDomainId => "1";
		public string? BreakpointAddress => "0x06000001+0x0";
		public string? ManagedThreadId => "1";
		public string? ProcessId => "0x1234";
		public string? ProcessName => "app.dll";
		public string? ThreadId => "0xABC";
		public string? ThreadName => "Main Thread";
		public string? FrameAddress(int index) => "address";
		public string? FrameCaller(int index) => "caller";
		public string? FrameFunction(int index) => "Program.Main()";
		public string? FrameModule(int index) => "app.dll";
		public string? FrameOffset(int index) => "0x00000000";
		public string? FrameToken(int index) => "0x06000001";

		public string? Evaluate(string expression) =>
			BreakpointExpression.ParseCached(expression).Evaluate(this).Describe();
	}

	static BreakpointDecision Hit(BreakpointSettings settings, BreakpointHitState state, Runtime? runtime = null) =>
		BreakpointBreakDecision.Evaluate(true, settings, state, runtime ?? new Runtime());

	[Fact]
	public void ADisabledBreakpointNeverBreaks() {
		var state = new BreakpointHitState();

		var decision = BreakpointBreakDecision.Evaluate(false, BreakpointSettings.None, state, new Runtime());

		Assert.False(decision.ShouldBreak);
		Assert.Equal(0, state.HitCount);
	}

	[Fact]
	public void APlainBreakpointBreaksAndCounts() {
		var state = new BreakpointHitState();

		var decision = Hit(BreakpointSettings.None, state);

		Assert.True(decision.ShouldBreak);
		Assert.Equal(1, state.HitCount);
		Assert.True(decision.HitCountChanged);
	}

	// ---------------------------------------------------------------- filter

	[Fact]
	public void AFilterThatDoesNotMatchSkipsTheHitWithoutCountingIt() {
		var state = new BreakpointHitState();
		var settings = new BreakpointSettings { Filter = "ProcessId == 0x9999" };
		var runtime = new Runtime().Set("ProcessId", BreakpointValue.FromInteger(0x1234));

		var decision = Hit(settings, state, runtime);

		Assert.False(decision.ShouldBreak);
		Assert.Equal(0, state.HitCount);
		Assert.False(decision.HitCountChanged);
	}

	[Fact]
	public void AFilterThatMatchesLetsTheHitThrough() {
		var state = new BreakpointHitState();
		var settings = new BreakpointSettings { Filter = "ProcessId == 0x1234 && ThreadName == \"Main Thread\"" };
		var runtime = new Runtime()
			.Set("ProcessId", BreakpointValue.FromInteger(0x1234))
			.Set("ThreadName", BreakpointValue.FromString("Main Thread"));

		Assert.True(Hit(settings, state, runtime).ShouldBreak);
		Assert.Equal(1, state.HitCount);
	}

	[Fact]
	public void AFilterThatCannotBeEvaluatedBreaksAndSaysWhy() {
		var state = new BreakpointHitState();
		var settings = new BreakpointSettings { Filter = "Nonsense ===" };

		var decision = Hit(settings, state);

		Assert.True(decision.ShouldBreak);
		Assert.NotNull(decision.ErrorMessage);
		Assert.Contains("Nonsense", decision.ErrorMessage, StringComparison.Ordinal);
		// The hit was never counted, because the gate it failed at is before the counter.
		Assert.Equal(0, state.HitCount);
	}

	// ---------------------------------------------------------------- condition

	[Fact]
	public void AConditionThatIsFalseSkipsTheHitWithoutCountingIt() {
		var state = new BreakpointHitState();
		var settings = new BreakpointSettings { Condition = new BreakpointCondition(BreakpointConditionKind.IsTrue, "i == 5") };
		var runtime = new Runtime().Set("i", BreakpointValue.FromInteger(1));

		var decision = Hit(settings, state, runtime);

		Assert.False(decision.ShouldBreak);
		Assert.Equal(0, state.HitCount);
	}

	[Fact]
	public void AConditionThatIsTrueBreaks() {
		var state = new BreakpointHitState();
		var settings = new BreakpointSettings { Condition = new BreakpointCondition(BreakpointConditionKind.IsTrue, "i == 5") };
		var runtime = new Runtime().Set("i", BreakpointValue.FromInteger(5));

		Assert.True(Hit(settings, state, runtime).ShouldBreak);
		Assert.Equal(1, state.HitCount);
	}

	[Fact]
	public void AConditionThatCannotBeEvaluatedBreaksAndSaysWhy() {
		var state = new BreakpointHitState();
		var settings = new BreakpointSettings { Condition = new BreakpointCondition(BreakpointConditionKind.IsTrue, "missing == 5") };

		var decision = Hit(settings, state);

		Assert.True(decision.ShouldBreak);
		Assert.NotNull(decision.ErrorMessage);
		Assert.Contains("missing", decision.ErrorMessage, StringComparison.Ordinal);
	}

	[Fact]
	public void WhenChangedDoesNotBreakOnTheFirstHit() {
		var state = new BreakpointHitState();
		var settings = new BreakpointSettings { Condition = new BreakpointCondition(BreakpointConditionKind.WhenChanged, "i") };
		var runtime = new Runtime().Set("i", BreakpointValue.FromInteger(1));

		// There is nothing to have changed from yet, so the first hit only records the value.
		Assert.False(Hit(settings, state, runtime).ShouldBreak);
		Assert.Equal(0, state.HitCount);
		Assert.True(state.HasConditionValue);
	}

	[Fact]
	public void WhenChangedBreaksOnlyWhenTheValueIsDifferent() {
		var state = new BreakpointHitState();
		var settings = new BreakpointSettings { Condition = new BreakpointCondition(BreakpointConditionKind.WhenChanged, "i") };
		var runtime = new Runtime().Set("i", BreakpointValue.FromInteger(1));

		Assert.False(Hit(settings, state, runtime).ShouldBreak);
		// The same value again: nothing changed.
		Assert.False(Hit(settings, state, runtime).ShouldBreak);

		runtime.Set("i", BreakpointValue.FromInteger(2));
		Assert.True(Hit(settings, state, runtime).ShouldBreak);
		Assert.Equal(1, state.HitCount);

		// And it settles again at the new value.
		Assert.False(Hit(settings, state, runtime).ShouldBreak);
	}

	// ---------------------------------------------------------------- hit count

	[Fact]
	public void EqualsBreaksOnlyOnTheNamedHit() {
		var state = new BreakpointHitState();
		var settings = new BreakpointSettings { HitCount = new BreakpointHitCount(BreakpointHitCountKind.Equals, 3) };

		Assert.False(Hit(settings, state).ShouldBreak);
		Assert.False(Hit(settings, state).ShouldBreak);
		Assert.True(Hit(settings, state).ShouldBreak);
		Assert.False(Hit(settings, state).ShouldBreak);
	}

	[Fact]
	public void MultipleOfBreaksEveryNthHit() {
		var state = new BreakpointHitState();
		var settings = new BreakpointSettings { HitCount = new BreakpointHitCount(BreakpointHitCountKind.MultipleOf, 3) };

		Assert.False(Hit(settings, state).ShouldBreak);
		Assert.False(Hit(settings, state).ShouldBreak);
		Assert.True(Hit(settings, state).ShouldBreak);
		Assert.False(Hit(settings, state).ShouldBreak);
		Assert.False(Hit(settings, state).ShouldBreak);
		Assert.True(Hit(settings, state).ShouldBreak);
	}

	[Theory]
	[InlineData(0)]
	[InlineData(-1)]
	public void MultipleOfNothingIsAnErrorTheUserIsToldAbout(int count) {
		var state = new BreakpointHitState();
		var settings = new BreakpointSettings { HitCount = new BreakpointHitCount(BreakpointHitCountKind.MultipleOf, count) };

		var decision = Hit(settings, state);

		Assert.True(decision.ShouldBreak);
		Assert.Equal($"Invalid hit count value: {count}", decision.ErrorMessage);
	}

	[Fact]
	public void GreaterThanOrEqualsBreaksOnEveryHitFromTheNamedOne() {
		var state = new BreakpointHitState();
		var settings = new BreakpointSettings { HitCount = new BreakpointHitCount(BreakpointHitCountKind.GreaterThanOrEquals, 2) };

		Assert.False(Hit(settings, state).ShouldBreak);
		Assert.True(Hit(settings, state).ShouldBreak);
		Assert.True(Hit(settings, state).ShouldBreak);
	}

	[Fact]
	public void AHitTheCountSkipsStillCountsAndIsReported() {
		var state = new BreakpointHitState();
		var settings = new BreakpointSettings { HitCount = new BreakpointHitCount(BreakpointHitCountKind.Equals, 3) };

		var decision = Hit(settings, state);

		Assert.False(decision.ShouldBreak);
		Assert.Equal(1, state.HitCount);
		// The pane shows "(current hit count: N)", so the client is told even when nothing stopped.
		Assert.True(decision.HitCountChanged);
	}

	// ---------------------------------------------------------------- trace

	[Fact]
	public void ATracepointPrintsAndKeepsRunning() {
		var state = new BreakpointHitState();
		var settings = new BreakpointSettings { Trace = new BreakpointTrace("$FUNCTION hit", Continue: true) };

		var decision = Hit(settings, state);

		Assert.False(decision.ShouldBreak);
		Assert.Equal("Program.Main() hit", decision.TraceMessage);
		Assert.Equal(1, state.HitCount);
	}

	[Fact]
	public void ATracepointThatDoesNotContinueBothPrintsAndStops() {
		var state = new BreakpointHitState();
		var settings = new BreakpointSettings { Trace = new BreakpointTrace("stopping", Continue: false) };

		var decision = Hit(settings, state);

		Assert.True(decision.ShouldBreak);
		Assert.Equal("stopping", decision.TraceMessage);
	}

	[Fact]
	public void ATracepointReadsTheFramesVariables() {
		var state = new BreakpointHitState();
		var settings = new BreakpointSettings { Trace = new BreakpointTrace("i={i}", Continue: true) };
		var runtime = new Runtime().Set("i", BreakpointValue.FromInteger(7));

		Assert.Equal("i=7", Hit(settings, state, runtime).TraceMessage);
	}

	// ---------------------------------------------------------------- the gates together

	[Fact]
	public void TheConditionGatesTheCountSoTheHitCountIsOfMatchingHits() {
		var state = new BreakpointHitState();
		var settings = new BreakpointSettings {
			Condition = new BreakpointCondition(BreakpointConditionKind.IsTrue, "i > 0"),
			HitCount = new BreakpointHitCount(BreakpointHitCountKind.Equals, 2),
		};
		var runtime = new Runtime().Set("i", BreakpointValue.FromInteger(0));

		// Three hits the condition rejects, none of which the counter sees.
		for (var attempt = 0; attempt < 3; attempt++)
			Assert.False(Hit(settings, state, runtime).ShouldBreak);
		Assert.Equal(0, state.HitCount);

		runtime.Set("i", BreakpointValue.FromInteger(1));
		Assert.False(Hit(settings, state, runtime).ShouldBreak);
		Assert.True(Hit(settings, state, runtime).ShouldBreak);
	}

	[Fact]
	public void ATracepointIsOnlyPrintedWhenEveryGateBeforeItPasses() {
		var state = new BreakpointHitState();
		var settings = new BreakpointSettings {
			HitCount = new BreakpointHitCount(BreakpointHitCountKind.Equals, 2),
			Trace = new BreakpointTrace("hit", Continue: true),
		};

		Assert.Null(Hit(settings, state).TraceMessage);
		Assert.Equal("hit", Hit(settings, state).TraceMessage);
	}

	// ---------------------------------------------------------------- settings shape

	[Fact]
	public void SettingsWithNothingInThemAreDefault() {
		Assert.True(BreakpointSettings.None.IsDefault);
		Assert.False(new BreakpointSettings { Filter = "x" }.IsDefault);
		Assert.False(new BreakpointSettings { Labels = ["a"] }.IsDefault);
	}

	[Fact]
	public void OnlySettingsThatNameAVariableNeedTheFramesNames() {
		Assert.False(BreakpointSettings.None.ReadsVariables);
		Assert.False(new BreakpointSettings { Filter = "ProcessId == 1" }.ReadsVariables);
		Assert.False(new BreakpointSettings { Trace = new BreakpointTrace("$FUNCTION", true) }.ReadsVariables);
		Assert.True(new BreakpointSettings { Condition = new BreakpointCondition(BreakpointConditionKind.IsTrue, "i == 1") }.ReadsVariables);
		Assert.True(new BreakpointSettings { Trace = new BreakpointTrace("i={i}", true) }.ReadsVariables);
	}
}
