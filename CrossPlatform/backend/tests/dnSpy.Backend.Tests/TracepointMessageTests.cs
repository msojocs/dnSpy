using dnSpy.Backend.Debugging.CorDebug;
using Xunit;

namespace dnSpy.Backend.Tests;

/// <summary>
/// Covers the tracepoint message syntax: its escapes, its brace-balanced <c>{expression}</c> holes and
/// its ordered <c>$KEYWORD</c> table, all ported from WPF so a message written there reads the same here.
/// </summary>
public sealed class TracepointMessageTests {
	/// <summary>A stop whose every part answers with the name of the part, so a render is readable.</summary>
	sealed class Context : ITracepointContext {
		public int Frames { get; set; } = 10;

		public string? AppDomainId { get; set; } = "1";
		public string? BreakpointAddress { get; set; } = "0x06000001+0x5";
		public string? ManagedThreadId { get; set; } = "7";
		public string? ProcessId { get; set; } = "0x1234";
		public string? ProcessName { get; set; } = "app.dll";
		public string? ThreadId { get; set; } = "0xABC";
		public string? ThreadName { get; set; } = "Main Thread";

		public string? FrameAddress(int index) => Frame(index, "address");
		public string? FrameCaller(int index) => Frame(index, "caller");
		public string? FrameFunction(int index) => Frame(index, "function");
		public string? FrameModule(int index) => Frame(index, "module");
		public string? FrameOffset(int index) => Frame(index, "offset");
		public string? FrameToken(int index) => Frame(index, "token");

		string? Frame(int index, string label) => index < Frames ? $"{label}{index}" : null;

		public string? Evaluate(string expression) => $"<{expression}>";
	}

	static string Render(string message, Context? context = null) =>
		TracepointMessage.Parse(message).Render(context ?? new Context());

	[Fact]
	public void PlainTextPassesThrough() => Assert.Equal("hello", Render("hello"));

	[Theory]
	[InlineData("\\\\", "\\")]
	[InlineData("\\$", "$")]
	[InlineData("\\{", "{")]
	[InlineData("\\}", "}")]
	[InlineData("\\a", "\a")]
	[InlineData("\\b", "\b")]
	[InlineData("\\f", "\f")]
	[InlineData("\\n", "\n")]
	[InlineData("\\r", "\r")]
	[InlineData("\\t", "\t")]
	[InlineData("\\v", "\v")]
	public void ReadsEveryEscapeTheSyntaxDefines(string message, string expected) =>
		Assert.Equal(expected, Render(message));

	[Fact]
	public void AnUnknownEscapeStaysLiteral() => Assert.Equal("\\q", Render("\\q"));

	[Fact]
	public void EvaluatesAnExpressionInBraces() => Assert.Equal("i is <i>", Render("i is {i}"));

	[Fact]
	public void ABraceInsideAnExpressionBelongsToIt() =>
		Assert.Equal("<a{b}c>", Render("{a{b}c}"));

	[Fact]
	public void AnUnclosedExpressionRunsToTheEnd() => Assert.Equal("<i == 5>", Render("{i == 5"));

	[Fact]
	public void AnEscapedBraceIsNotAnExpression() => Assert.Equal("{i}", Render("\\{i\\}"));

	[Theory]
	[InlineData("$ADDRESS", "address0")]
	[InlineData("$ADDRESS1", "address1")]
	[InlineData("$ADDRESS5", "address5")]
	[InlineData("$ADID", "1")]
	[InlineData("$BPADDR", "0x06000001+0x5")]
	[InlineData("$CALLER", "caller1")]
	[InlineData("$CALLER3", "caller3")]
	[InlineData("$CALLERMODULE", "module1")]
	[InlineData("$CALLERMODULE2", "module2")]
	[InlineData("$CALLEROFFSET", "offset1")]
	[InlineData("$CALLEROFFSET4", "offset4")]
	[InlineData("$CALLERTOKEN", "token1")]
	[InlineData("$CALLERTOKEN5", "token5")]
	[InlineData("$FUNCTION", "function0")]
	[InlineData("$FUNCTION2", "function2")]
	[InlineData("$MID", "7")]
	[InlineData("$PID", "0x1234")]
	[InlineData("$PNAME", "app.dll")]
	[InlineData("$TID", "0xABC")]
	[InlineData("$TNAME", "Main Thread")]
	public void RendersEveryKeyword(string message, string expected) => Assert.Equal(expected, Render(message));

	[Fact]
	public void TheLongestKeywordWinsSoNumberedFormsAreNotSplit() {
		// "$ADDRESS1" must not read as "$ADDRESS" followed by a literal "1".
		Assert.Equal("address1", Render("$ADDRESS1"));
		// And a digit that is not part of a form stays literal.
		Assert.Equal("address09", Render("$ADDRESS9"));
	}

	[Fact]
	public void AnUnknownKeywordStaysLiteral() => Assert.Equal("$FOO", Render("$FOO"));

	[Fact]
	public void ACallStackListsOneFramePerLine() {
		var context = new Context { Frames = 3 };

		var rendered = Render("$CALLSTACK5", context);

		Assert.Equal(
			$"\tcaller0{Environment.NewLine}\tcaller1{Environment.NewLine}\tcaller2{Environment.NewLine}\t",
			rendered);
	}

	[Fact]
	public void ACallStackStopsAtTheCountItNames() {
		var context = new Context { Frames = 100 };

		var lines = Render("$CALLSTACK5", context).Split(Environment.NewLine);

		// Five frames and the trailing tab the renderer leaves for whatever follows.
		Assert.Equal(6, lines.Length);
	}

	[Theory]
	[InlineData("$CALLSTACK", 50)]
	[InlineData("$CALLSTACK5", 5)]
	[InlineData("$CALLSTACK10", 10)]
	[InlineData("$CALLSTACK15", 15)]
	[InlineData("$CALLSTACK20", 20)]
	public void ACallStackAsksForTheFramesItWillShow(string message, int expected) =>
		Assert.Equal(expected, TracepointMessage.Parse(message).MaxFrames);

	[Fact]
	public void AMessageAsksForNoMoreFramesThanItNames() {
		Assert.Equal(0, TracepointMessage.Parse("hello").MaxFrames);
		Assert.Equal(1, TracepointMessage.Parse("$FUNCTION").MaxFrames);
		Assert.Equal(4, TracepointMessage.Parse("$CALLER3").MaxFrames);
		// An expression is read off the top frame, so it needs one even with no frame keyword.
		Assert.Equal(1, TracepointMessage.Parse("{i}").MaxFrames);
	}

	[Fact]
	public void OnlyAMessageWithAnExpressionNeedsTheFramesVariables() {
		Assert.False(TracepointMessage.Parse("$FUNCTION hit").Evaluates);
		Assert.True(TracepointMessage.Parse("i = {i}").Evaluates);
	}

	[Fact]
	public void APartThatCannotBeProducedReadsAsTheErrorMarker() {
		var context = new Context { Frames = 0, ThreadName = null };

		Assert.Equal(TracepointMessage.ErrorText, Render("$FUNCTION", context));
		Assert.Equal(TracepointMessage.ErrorText, Render("$TNAME", context));
	}

	[Fact]
	public void AProcessWithNoNameFallsBackToItsId() {
		var context = new Context { ProcessName = null };

		Assert.Equal("0x1234", Render("$PNAME", context));
	}

	[Fact]
	public void RendersAWholeMessageTheWayAUserWritesOne() {
		Assert.Equal("function0: i=<i>, tid=0xABC\n", Render("$FUNCTION: i={i}, tid=$TID\\n"));
	}

	[Fact]
	public void FormatsHexTheWayEveryNumericKeywordDoes() {
		Assert.Equal("0x1F", TracepointMessage.Hex(31));
		Assert.Equal("0x0000001F", TracepointMessage.Hex(31, 8));
	}
}
