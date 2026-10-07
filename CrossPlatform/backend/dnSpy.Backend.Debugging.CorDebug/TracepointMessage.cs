using System.Collections.Concurrent;
using System.Globalization;
using System.Text;

namespace dnSpy.Backend.Debugging.CorDebug;

public enum TracepointMessageKind {
	Text,
	EvaluatedExpression,
	Address,
	AppDomainId,
	BreakpointAddress,
	Caller,
	CallerModule,
	CallerOffset,
	CallerToken,
	CallStack,
	Function,
	ManagedId,
	ProcessId,
	ProcessName,
	ThreadId,
	ThreadName,
}

/// <summary>One piece of a parsed tracepoint message: literal text, a <c>$KEYWORD</c> or a <c>{expression}</c>.</summary>
public readonly record struct TracepointMessagePart(TracepointMessageKind Kind, string? Text, int Number);

/// <summary>
/// A tracepoint message, parsed once and rendered on every hit. Ported from WPF's
/// <c>TracepointMessageParser</c> and <c>TracepointMessageCreator</c>, keeping its escapes, its
/// brace-balanced <c>{expression}</c> syntax and its ordered first-match keyword table.
/// </summary>
public sealed class TracepointMessage {
	/// <summary>How many frames <c>$CALLSTACK</c> without a number shows.</summary>
	const int DefaultCallStackCount = 50;

	/// <summary>What a part that cannot be produced reads as, the same marker WPF uses.</summary>
	public const string ErrorText = "???";

	static readonly ConcurrentDictionary<string, TracepointMessage> cache = new(StringComparer.Ordinal);

	// NOTE: order matters, the first match wins. Mirrors the table in WPF's TracepointMessageParser,
	// which is also the table the settings dialog's help text describes.
	static readonly (string Name, TracepointMessageKind Kind, int Number)[] keywords = [
		("ADDRESS5", TracepointMessageKind.Address, 5),
		("ADDRESS4", TracepointMessageKind.Address, 4),
		("ADDRESS3", TracepointMessageKind.Address, 3),
		("ADDRESS2", TracepointMessageKind.Address, 2),
		("ADDRESS1", TracepointMessageKind.Address, 1),
		("ADDRESS", TracepointMessageKind.Address, 0),
		("ADID", TracepointMessageKind.AppDomainId, 0),
		("BPADDR", TracepointMessageKind.BreakpointAddress, 0),
		("CALLERMODULE5", TracepointMessageKind.CallerModule, 5),
		("CALLERMODULE4", TracepointMessageKind.CallerModule, 4),
		("CALLERMODULE3", TracepointMessageKind.CallerModule, 3),
		("CALLERMODULE2", TracepointMessageKind.CallerModule, 2),
		("CALLERMODULE1", TracepointMessageKind.CallerModule, 1),
		("CALLERMODULE", TracepointMessageKind.CallerModule, 1),
		("CALLEROFFSET5", TracepointMessageKind.CallerOffset, 5),
		("CALLEROFFSET4", TracepointMessageKind.CallerOffset, 4),
		("CALLEROFFSET3", TracepointMessageKind.CallerOffset, 3),
		("CALLEROFFSET2", TracepointMessageKind.CallerOffset, 2),
		("CALLEROFFSET1", TracepointMessageKind.CallerOffset, 1),
		("CALLEROFFSET", TracepointMessageKind.CallerOffset, 1),
		("CALLERTOKEN5", TracepointMessageKind.CallerToken, 5),
		("CALLERTOKEN4", TracepointMessageKind.CallerToken, 4),
		("CALLERTOKEN3", TracepointMessageKind.CallerToken, 3),
		("CALLERTOKEN2", TracepointMessageKind.CallerToken, 2),
		("CALLERTOKEN1", TracepointMessageKind.CallerToken, 1),
		("CALLERTOKEN", TracepointMessageKind.CallerToken, 1),
		("CALLSTACK20", TracepointMessageKind.CallStack, 20),
		("CALLSTACK15", TracepointMessageKind.CallStack, 15),
		("CALLSTACK10", TracepointMessageKind.CallStack, 10),
		("CALLSTACK5", TracepointMessageKind.CallStack, 5),
		("CALLSTACK", TracepointMessageKind.CallStack, DefaultCallStackCount),
		("CALLER5", TracepointMessageKind.Caller, 5),
		("CALLER4", TracepointMessageKind.Caller, 4),
		("CALLER3", TracepointMessageKind.Caller, 3),
		("CALLER2", TracepointMessageKind.Caller, 2),
		("CALLER1", TracepointMessageKind.Caller, 1),
		("CALLER", TracepointMessageKind.Caller, 1),
		("FUNCTION5", TracepointMessageKind.Function, 5),
		("FUNCTION4", TracepointMessageKind.Function, 4),
		("FUNCTION3", TracepointMessageKind.Function, 3),
		("FUNCTION2", TracepointMessageKind.Function, 2),
		("FUNCTION1", TracepointMessageKind.Function, 1),
		("FUNCTION", TracepointMessageKind.Function, 0),
		("MID", TracepointMessageKind.ManagedId, 0),
		("PID", TracepointMessageKind.ProcessId, 0),
		("PNAME", TracepointMessageKind.ProcessName, 0),
		("TID", TracepointMessageKind.ThreadId, 0),
		("TNAME", TracepointMessageKind.ThreadName, 0),
	];

	static readonly char[] specialChars = ['\\', '$', '{', '}'];

	public IReadOnlyList<TracepointMessagePart> Parts { get; }

	/// <summary>How many stack frames the message needs, so only those are walked.</summary>
	public int MaxFrames { get; }

	/// <summary>Whether the message has a <c>{expression}</c> in it, which needs the frame's variables.</summary>
	public bool Evaluates { get; }

	TracepointMessage(IReadOnlyList<TracepointMessagePart> parts) {
		Parts = parts;
		var frames = 0;
		var evaluates = false;
		foreach (var part in parts) {
			switch (part.Kind) {
				case TracepointMessageKind.EvaluatedExpression:
					evaluates = true;
					break;
				case TracepointMessageKind.CallStack:
					frames = Math.Max(frames, part.Number);
					break;
				case TracepointMessageKind.Address:
				case TracepointMessageKind.Caller:
				case TracepointMessageKind.CallerModule:
				case TracepointMessageKind.CallerOffset:
				case TracepointMessageKind.CallerToken:
				case TracepointMessageKind.Function:
					frames = Math.Max(frames, part.Number + 1);
					break;
			}
		}
		// An expression is evaluated against the top frame, so it needs one even when nothing else does.
		MaxFrames = evaluates ? Math.Max(frames, 1) : frames;
		Evaluates = evaluates;
	}

	/// <summary>
	/// Parses a message, reusing the result for a message already seen. A tracepoint in a hot loop is
	/// rendered on every iteration, and re-parsing it each time would be the expensive half.
	/// </summary>
	public static TracepointMessage Parse(string? text) =>
		cache.GetOrAdd(text ?? string.Empty, static value => new TracepointMessage(ParseParts(value)));

	static List<TracepointMessagePart> ParseParts(string text) {
		var parts = new List<TracepointMessagePart>();
		var pending = new StringBuilder();
		var position = 0;

		void Flush() {
			if (pending.Length == 0)
				return;
			parts.Add(new TracepointMessagePart(TracepointMessageKind.Text, pending.ToString(), 0));
			pending.Clear();
		}

		while (position < text.Length) {
			var index = text.IndexOfAny(specialChars, position);
			if (index < 0) {
				pending.Append(text, position, text.Length - position);
				break;
			}
			pending.Append(text, position, index - position);
			position = index;
			switch (text[position]) {
				case '\\': {
					var escaped = position + 1 < text.Length ? Unescape(text[position + 1]) : null;
					if (escaped is null)
						goto default;
					pending.Append(escaped.Value);
					position += 2;
					break;
				}
				case '$': {
					var keyword = keywords.FirstOrDefault(candidate => MatchesAt(text, position + 1, candidate.Name));
					if (keyword.Name is null)
						goto default;
					position += 1 + keyword.Name.Length;
					Flush();
					parts.Add(new TracepointMessagePart(keyword.Kind, null, keyword.Number));
					break;
				}
				case '{': {
					var after = position + 1;
					var expression = ReadExpression(text, ref after);
					Flush();
					parts.Add(new TracepointMessagePart(TracepointMessageKind.EvaluatedExpression, expression, 0));
					position = after;
					break;
				}
				default:
					pending.Append(text[position++]);
					break;
			}
		}
		Flush();
		return parts;
	}

	static char? Unescape(char c) => c switch {
		'\\' or '$' or '{' or '}' => c,
		'a' => '\a',
		'b' => '\b',
		'f' => '\f',
		'n' => '\n',
		'r' => '\r',
		't' => '\t',
		'v' => '\v',
		_ => null,
	};

	static bool MatchesAt(string text, int index, string candidate) =>
		index + candidate.Length <= text.Length && string.CompareOrdinal(text, index, candidate, 0, candidate.Length) == 0;

	/// <summary>Reads to the matching '}', so a nested brace inside the expression stays inside it.</summary>
	static string ReadExpression(string text, ref int position) {
		var builder = new StringBuilder();
		var depth = 1;
		while (position < text.Length) {
			var c = text[position++];
			if (c == '}') {
				if (depth <= 1)
					break;
				depth--;
			}
			else if (c == '{')
				depth++;
			builder.Append(c);
		}
		return builder.ToString();
	}

	// ---------------------------------------------------------------- rendering

	public string Render(ITracepointContext context) {
		var output = new StringBuilder();
		foreach (var part in Parts) {
			switch (part.Kind) {
				case TracepointMessageKind.Text:
					output.Append(part.Text);
					break;
				case TracepointMessageKind.EvaluatedExpression:
					output.Append(Or(context.Evaluate(part.Text ?? string.Empty)));
					break;
				case TracepointMessageKind.Address:
					output.Append(Or(context.FrameAddress(part.Number)));
					break;
				case TracepointMessageKind.AppDomainId:
					output.Append(Or(context.AppDomainId));
					break;
				case TracepointMessageKind.BreakpointAddress:
					output.Append(Or(context.BreakpointAddress));
					break;
				case TracepointMessageKind.Caller:
					output.Append(Or(context.FrameCaller(part.Number)));
					break;
				case TracepointMessageKind.CallerModule:
					output.Append(Or(context.FrameModule(part.Number)));
					break;
				case TracepointMessageKind.CallerOffset:
					output.Append(Or(context.FrameOffset(part.Number)));
					break;
				case TracepointMessageKind.CallerToken:
					output.Append(Or(context.FrameToken(part.Number)));
					break;
				case TracepointMessageKind.CallStack:
					for (var frame = 0; frame < part.Number; frame++) {
						var text = context.FrameCaller(frame);
						if (text is null)
							break;
						output.Append('\t').Append(text).Append(Environment.NewLine);
					}
					output.Append('\t');
					break;
				case TracepointMessageKind.Function:
					output.Append(Or(context.FrameFunction(part.Number)));
					break;
				case TracepointMessageKind.ManagedId:
					output.Append(Or(context.ManagedThreadId));
					break;
				case TracepointMessageKind.ProcessId:
					output.Append(Or(context.ProcessId));
					break;
				case TracepointMessageKind.ProcessName:
					// A process with no filename falls back to its id, which is what WPF does.
					output.Append(Or(context.ProcessName ?? context.ProcessId));
					break;
				case TracepointMessageKind.ThreadId:
					output.Append(Or(context.ThreadId));
					break;
				case TracepointMessageKind.ThreadName:
					output.Append(Or(context.ThreadName));
					break;
			}
		}
		return output.ToString();
	}

	static string Or(string? text) => string.IsNullOrEmpty(text) ? ErrorText : text;

	/// <summary>Formats a number the way every hexadecimal keyword in a message does.</summary>
	public static string Hex(long value, int digits = 0) =>
		"0x" + value.ToString(digits > 0 ? "X" + digits.ToString(CultureInfo.InvariantCulture) : "X", CultureInfo.InvariantCulture);
}

/// <summary>
/// Everything a tracepoint message can ask about the stop it is being printed for. The renderer takes
/// it as an interface so the message syntax can be tested without a live debuggee.
/// </summary>
public interface ITracepointContext {
	string? AppDomainId { get; }

	string? BreakpointAddress { get; }

	string? ManagedThreadId { get; }

	string? ProcessId { get; }

	string? ProcessName { get; }

	string? ThreadId { get; }

	string? ThreadName { get; }

	/// <summary>The frame with its instruction pointer, which is what <c>$ADDRESS</c> shows.</summary>
	string? FrameAddress(int index);

	/// <summary>The frame's name, which is what <c>$CALLER</c> and <c>$CALLSTACK</c> show.</summary>
	string? FrameCaller(int index);

	/// <summary>The frame's name with its parameter types, which is what <c>$FUNCTION</c> shows.</summary>
	string? FrameFunction(int index);

	string? FrameModule(int index);

	string? FrameOffset(int index);

	string? FrameToken(int index);

	/// <summary>Evaluates a <c>{expression}</c>, answering null when it cannot be read.</summary>
	string? Evaluate(string expression);
}
