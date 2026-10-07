using dnSpy.Backend.Debugging.CorDebug;
using Xunit;

namespace dnSpy.Backend.Tests;

/// <summary>
/// Covers the restricted expression language breakpoint conditions and filters are written in. It is
/// a subset of C# on purpose, so the tests are as much about what it refuses as about what it answers.
/// </summary>
public sealed class BreakpointExpressionTests {
	/// <summary>A scope whose names are whatever the test put in it.</summary>
	sealed class Scope : IBreakpointScope {
		readonly Dictionary<string, BreakpointValue> values = new(StringComparer.Ordinal);

		public Scope Set(string name, BreakpointValue value) {
			values[name] = value;
			return this;
		}

		public bool TryRead(string name, out BreakpointValue value) => values.TryGetValue(name, out value);
	}

	static bool Eval(string expression, IBreakpointScope? scope = null) =>
		BreakpointExpression.Parse(expression).EvaluateAsBoolean(scope ?? EmptyBreakpointScope.Instance);

	static BreakpointValue Value(string expression, IBreakpointScope? scope = null) =>
		BreakpointExpression.Parse(expression).Evaluate(scope ?? EmptyBreakpointScope.Instance);

	[Theory]
	[InlineData("1 == 1", true)]
	[InlineData("1 != 1", false)]
	[InlineData("2 > 1", true)]
	[InlineData("2 >= 2", true)]
	[InlineData("1 < 2", true)]
	[InlineData("2 <= 1", false)]
	[InlineData("true", true)]
	[InlineData("!false", true)]
	[InlineData("-3 < 0", true)]
	[InlineData("1.5 > 1", true)]
	public void EvaluatesTheOperatorsAConditionIsWrittenWith(string expression, bool expected) =>
		Assert.Equal(expected, Eval(expression));

	[Fact]
	public void AndBindsTighterThanOr() {
		var scope = new Scope()
			.Set("a", BreakpointValue.FromInteger(1))
			.Set("b", BreakpointValue.FromInteger(0))
			.Set("c", BreakpointValue.FromInteger(0));

		// Read as `a == 1 || (b == 2 && c == 3)`, which is true; the other grouping would be false.
		Assert.True(Eval("a == 1 || b == 2 && c == 3", scope));
	}

	[Fact]
	public void ParenthesesOverrideThePrecedence() {
		var scope = new Scope()
			.Set("a", BreakpointValue.FromInteger(1))
			.Set("b", BreakpointValue.FromInteger(0))
			.Set("c", BreakpointValue.FromInteger(0));

		Assert.False(Eval("(a == 1 || b == 2) && c == 3", scope));
	}

	[Fact]
	public void ShortCircuitsSoTheUnreadSideIsNeverEvaluated() {
		// The right side names nothing the scope knows, which would throw if it were evaluated.
		Assert.False(Eval("false && missing == 1"));
		Assert.True(Eval("true || missing == 1"));
	}

	[Fact]
	public void ReadsHexadecimalLiteralsTheWayAFilterIsWritten() {
		var scope = new Scope().Set("ProcessId", BreakpointValue.FromInteger(0x1234));

		Assert.True(Eval("ProcessId == 0x1234", scope));
	}

	[Fact]
	public void ComparesStringsByTheirContents() {
		var scope = new Scope().Set("ThreadName", BreakpointValue.FromString("Main Thread"));

		Assert.True(Eval("ThreadName == \"Main Thread\"", scope));
		Assert.False(Eval("ThreadName == \"Worker\"", scope));
	}

	[Fact]
	public void ReadsEscapesInAString() {
		Assert.Equal("a\tb\n\"c\"", Value("\"a\\tb\\n\\\"c\\\"\"").Text);
	}

	[Fact]
	public void ACharacterLiteralIsItsCodePoint() {
		var scope = new Scope().Set("c", BreakpointValue.FromInteger('x'));

		Assert.True(Eval("c == 'x'", scope));
		Assert.True(Eval("c == 120", scope));
	}

	[Fact]
	public void AnOpaqueObjectCanOnlyBeComparedWithNull() {
		var scope = new Scope().Set("value", BreakpointValue.FromObject("{object}"));

		Assert.False(Eval("value == null", scope));
		Assert.True(Eval("value != null", scope));
		Assert.Throws<BreakpointExpressionException>(() => Eval("value == 1", scope));
	}

	[Fact]
	public void ANullReferenceIsEqualOnlyToNull() {
		var scope = new Scope().Set("value", BreakpointValue.Null);

		Assert.True(Eval("value == null", scope));
		Assert.False(Eval("value == 0", scope));
	}

	[Fact]
	public void AnUnknownNameIsAnError() {
		var error = Assert.Throws<BreakpointExpressionException>(() => Eval("missing == 1"));

		Assert.Contains("missing", error.Message, StringComparison.Ordinal);
	}

	[Theory]
	[InlineData("")]
	[InlineData("1 ==")]
	[InlineData("(1 == 1")]
	[InlineData("1 == 1)")]
	[InlineData("\"unclosed")]
	[InlineData("1 + 1")]
	[InlineData("a.b == 1")]
	[InlineData("Foo()")]
	public void RefusesWhatTheLanguageDoesNotCover(string expression) =>
		Assert.Throws<BreakpointExpressionException>(() => BreakpointExpression.Parse(expression));

	[Fact]
	public void AConditionMustProduceABoolean() {
		// `i` on its own is the mistake a user makes when they meant `i == 5`.
		var scope = new Scope().Set("i", BreakpointValue.FromInteger(5));

		Assert.Throws<BreakpointExpressionException>(() => Eval("i", scope));
	}

	[Fact]
	public void OrderingNonNumbersIsAnError() {
		var scope = new Scope().Set("name", BreakpointValue.FromString("a"));

		Assert.Throws<BreakpointExpressionException>(() => Eval("name < \"b\"", scope));
	}

	[Fact]
	public void TheCacheRemembersAFailureAsWellAsAnExpression() {
		// Both are asked for twice, because a condition on a hot line is parsed once and checked often.
		Assert.True(BreakpointExpression.ParseCached("1 == 1").EvaluateAsBoolean(EmptyBreakpointScope.Instance));
		Assert.True(BreakpointExpression.ParseCached("1 == 1").EvaluateAsBoolean(EmptyBreakpointScope.Instance));

		Assert.Throws<BreakpointExpressionException>(() => BreakpointExpression.ParseCached("1 =="));
		Assert.Throws<BreakpointExpressionException>(() => BreakpointExpression.ParseCached("1 =="));
	}

	[Fact]
	public void DescribesValuesTheWayAWhenChangedConditionComparesThem() {
		Assert.Equal("null", BreakpointValue.Null.Describe());
		Assert.Equal("true", BreakpointValue.FromBool(true).Describe());
		Assert.Equal("5", BreakpointValue.FromInteger(5).Describe());
		Assert.Equal("1.5", BreakpointValue.FromFloating(1.5).Describe());
		Assert.Equal("\"x\"", BreakpointValue.FromString("x").Describe());
	}

	[Fact]
	public void AnUnsignedValuePastLongStaysComparable() {
		var scope = new Scope().Set("value", BreakpointValue.FromUnsigned(ulong.MaxValue));

		Assert.True(Eval("value > 0", scope));
	}
}
