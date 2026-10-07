using System.Globalization;
using System.Text;

namespace dnSpy.Backend.Debugging.CorDebug;

/// <summary>
/// An expression that could not be parsed or evaluated. WPF shows the message and breaks on the
/// breakpoint rather than skipping it, so a typo is noticed instead of silently disabling the stop.
/// </summary>
public sealed class BreakpointExpressionException : Exception {
	public BreakpointExpressionException(string message) : base(message) { }
}

public enum BreakpointValueKind {
	Null,
	Bool,
	Integer,
	Floating,
	String,
	/// <summary>An object the engine will not look inside; only a comparison against null works.</summary>
	Object,
}

/// <summary>
/// A value an expression works with. The runtime hands out far more than this, but the engine can
/// only read what <see cref="ManagedValueFormatter"/> can read — primitives, strings and references —
/// so everything else arrives as <see cref="BreakpointValueKind.Object"/>.
/// </summary>
public readonly struct BreakpointValue {
	public BreakpointValueKind Kind { get; }

	readonly long integer;
	readonly double floating;
	readonly string? text;

	BreakpointValue(BreakpointValueKind kind, long integer, double floating, string? text) {
		Kind = kind;
		this.integer = integer;
		this.floating = floating;
		this.text = text;
	}

	public static readonly BreakpointValue Null = new(BreakpointValueKind.Null, 0, 0, null);

	public static BreakpointValue FromBool(bool value) => new(BreakpointValueKind.Bool, value ? 1 : 0, 0, null);

	public static BreakpointValue FromInteger(long value) => new(BreakpointValueKind.Integer, value, 0, null);

	/// <summary>
	/// A ulong past <see cref="long.MaxValue"/> is kept as a double, which is all the precision a
	/// comparison at that magnitude keeps. Anything smaller stays exact.
	/// </summary>
	public static BreakpointValue FromUnsigned(ulong value) =>
		value <= long.MaxValue ? FromInteger((long)value) : FromFloating(value);

	public static BreakpointValue FromFloating(double value) => new(BreakpointValueKind.Floating, 0, value, null);

	public static BreakpointValue FromString(string value) => new(BreakpointValueKind.String, 0, 0, value);

	public static BreakpointValue FromObject(string description) => new(BreakpointValueKind.Object, 0, 0, description);

	public bool Bool => integer != 0;

	public long Integer => integer;

	public double Floating => Kind == BreakpointValueKind.Integer ? integer : floating;

	public string Text => text ?? string.Empty;

	public bool IsNumeric => Kind is BreakpointValueKind.Integer or BreakpointValueKind.Floating;

	/// <summary>How the value reads, which is also what a <c>WhenChanged</c> condition compares.</summary>
	public string Describe() => Kind switch {
		BreakpointValueKind.Null => "null",
		BreakpointValueKind.Bool => Bool ? "true" : "false",
		BreakpointValueKind.Integer => integer.ToString(CultureInfo.InvariantCulture),
		BreakpointValueKind.Floating => floating.ToString("R", CultureInfo.InvariantCulture),
		BreakpointValueKind.String => "\"" + text + "\"",
		_ => text ?? "{object}",
	};
}

/// <summary>Where a name in an expression gets its value.</summary>
public interface IBreakpointScope {
	/// <summary>Reads a name, or answers false when the scope has no such name.</summary>
	bool TryRead(string name, out BreakpointValue value);
}

/// <summary>A scope with no names at all, which makes every identifier an error.</summary>
public sealed class EmptyBreakpointScope : IBreakpointScope {
	public static readonly EmptyBreakpointScope Instance = new();

	public bool TryRead(string name, out BreakpointValue value) {
		value = BreakpointValue.Null;
		return false;
	}
}

public enum BreakpointOperator {
	Or,
	And,
	Equal,
	NotEqual,
	Less,
	LessOrEqual,
	Greater,
	GreaterOrEqual,
}

/// <summary>
/// A deliberately small expression language: names, literals, comparisons and the boolean
/// connectives. It is not C#.
/// </summary>
/// <remarks>
/// WPF compiles breakpoint conditions with Roslyn against a full expression evaluator; this engine
/// has none (<c>"evaluate"</c> is answered with <c>MethodNotFound</c>), so conditions are served by
/// this subset instead. It covers what conditions are actually written as — <c>i == 5</c>,
/// <c>name == "x"</c>, <c>count &gt; 10 &amp;&amp; done</c> — and refuses the rest loudly. Field
/// access, calls and assignment are all absent: reading an object's fields needs metadata the runtime
/// does not hand over (see <see cref="ManagedValueFormatter"/>).
/// <para>
/// The same evaluator serves both the condition, whose names are the frame's arguments and locals,
/// and the filter, whose names are the five the debugger knows about itself. Only the scope differs.
/// </para>
/// </remarks>
public abstract class BreakpointExpression {
	/// <summary>Parses an expression, or throws <see cref="BreakpointExpressionException"/>.</summary>
	public static BreakpointExpression Parse(string text) => new Parser(text).ParseExpression();

	// Either a parsed expression or the message its parse failed with; a condition on a hot line is
	// checked on every iteration and neither outcome should be recomputed each time.
	static readonly System.Collections.Concurrent.ConcurrentDictionary<string, object> cache = new(StringComparer.Ordinal);

	/// <summary>Parses an expression already seen only once, failures included.</summary>
	public static BreakpointExpression ParseCached(string? text) {
		var entry = cache.GetOrAdd(text ?? string.Empty, static value => {
			try {
				return Parse(value);
			}
			catch (BreakpointExpressionException ex) {
				return ex.Message;
			}
		});
		return entry as BreakpointExpression ?? throw new BreakpointExpressionException((string)entry);
	}

	public abstract BreakpointValue Evaluate(IBreakpointScope scope);

	/// <summary>Evaluates to a bool, the way a condition and a filter both need.</summary>
	public bool EvaluateAsBoolean(IBreakpointScope scope) {
		var value = Evaluate(scope);
		if (value.Kind != BreakpointValueKind.Bool)
			throw new BreakpointExpressionException("The expression must evaluate to a boolean.");
		return value.Bool;
	}

	sealed class LiteralExpression : BreakpointExpression {
		readonly BreakpointValue value;
		public LiteralExpression(BreakpointValue value) => this.value = value;
		public override BreakpointValue Evaluate(IBreakpointScope scope) => value;
	}

	sealed class NameExpression : BreakpointExpression {
		readonly string name;
		public NameExpression(string name) => this.name = name;
		public override BreakpointValue Evaluate(IBreakpointScope scope) =>
			scope.TryRead(name, out var value) ? value : throw new BreakpointExpressionException($"There is no variable named '{name}'.");
	}

	sealed class NegateExpression : BreakpointExpression {
		readonly BreakpointExpression operand;
		public NegateExpression(BreakpointExpression operand) => this.operand = operand;
		public override BreakpointValue Evaluate(IBreakpointScope scope) {
			var value = operand.Evaluate(scope);
			return value.Kind switch {
				BreakpointValueKind.Integer => BreakpointValue.FromInteger(-value.Integer),
				BreakpointValueKind.Floating => BreakpointValue.FromFloating(-value.Floating),
				_ => throw new BreakpointExpressionException($"'-' needs a number, not {value.Describe()}."),
			};
		}
	}

	sealed class NotExpression : BreakpointExpression {
		readonly BreakpointExpression operand;
		public NotExpression(BreakpointExpression operand) => this.operand = operand;
		public override BreakpointValue Evaluate(IBreakpointScope scope) {
			var value = operand.Evaluate(scope);
			if (value.Kind != BreakpointValueKind.Bool)
				throw new BreakpointExpressionException($"'!' needs a boolean, not {value.Describe()}.");
			return BreakpointValue.FromBool(!value.Bool);
		}
	}

	sealed class BinaryExpression : BreakpointExpression {
		readonly BreakpointOperator op;
		readonly BreakpointExpression left;
		readonly BreakpointExpression right;

		public BinaryExpression(BreakpointOperator op, BreakpointExpression left, BreakpointExpression right) {
			this.op = op;
			this.left = left;
			this.right = right;
		}

		public override BreakpointValue Evaluate(IBreakpointScope scope) {
			// && and || short-circuit, so the right side is not even read when the left settles it.
			if (op is BreakpointOperator.And or BreakpointOperator.Or) {
				var first = Boolean(left.Evaluate(scope));
				if (op == BreakpointOperator.And ? !first : first)
					return BreakpointValue.FromBool(first);
				return BreakpointValue.FromBool(Boolean(right.Evaluate(scope)));
			}
			var a = left.Evaluate(scope);
			var b = right.Evaluate(scope);
			if (op is BreakpointOperator.Equal or BreakpointOperator.NotEqual) {
				var equal = AreEqual(a, b);
				return BreakpointValue.FromBool(op == BreakpointOperator.Equal ? equal : !equal);
			}
			if (!a.IsNumeric || !b.IsNumeric)
				throw new BreakpointExpressionException($"{a.Describe()} and {b.Describe()} cannot be ordered; only numbers can.");
			var comparison = a.Kind == BreakpointValueKind.Integer && b.Kind == BreakpointValueKind.Integer
				? a.Integer.CompareTo(b.Integer)
				: a.Floating.CompareTo(b.Floating);
			return BreakpointValue.FromBool(op switch {
				BreakpointOperator.Less => comparison < 0,
				BreakpointOperator.LessOrEqual => comparison <= 0,
				BreakpointOperator.Greater => comparison > 0,
				_ => comparison >= 0,
			});
		}

		static bool Boolean(BreakpointValue value) =>
			value.Kind == BreakpointValueKind.Bool
				? value.Bool
				: throw new BreakpointExpressionException($"'&&' and '||' need booleans, not {value.Describe()}.");

		static bool AreEqual(BreakpointValue a, BreakpointValue b) {
			// null is comparable with everything, and equal only to itself. That is what makes the one
			// useful thing an opaque object supports — `value == null` — work.
			if (a.Kind == BreakpointValueKind.Null || b.Kind == BreakpointValueKind.Null)
				return a.Kind == b.Kind;
			if (a.Kind == BreakpointValueKind.Bool && b.Kind == BreakpointValueKind.Bool)
				return a.Bool == b.Bool;
			if (a.IsNumeric && b.IsNumeric) {
				return a.Kind == BreakpointValueKind.Integer && b.Kind == BreakpointValueKind.Integer
					? a.Integer == b.Integer
					: a.Floating.Equals(b.Floating);
			}
			if (a.Kind == BreakpointValueKind.String && b.Kind == BreakpointValueKind.String)
				return string.Equals(a.Text, b.Text, StringComparison.Ordinal);
			throw new BreakpointExpressionException($"{a.Describe()} and {b.Describe()} cannot be compared.");
		}
	}

	// ---------------------------------------------------------------- parsing

	enum TokenKind {
		End, Number, String, Identifier,
		OpenParen, CloseParen,
		Not, Minus, AndAnd, OrOr, EqualEqual, NotEqual, Less, LessOrEqual, Greater, GreaterOrEqual,
	}

	readonly record struct Token(TokenKind Kind, string Text, BreakpointValue Value);

	sealed class Parser {
		readonly string text;
		int position;
		Token current;

		public Parser(string text) {
			this.text = text ?? string.Empty;
			Advance();
		}

		public BreakpointExpression ParseExpression() {
			if (current.Kind == TokenKind.End)
				throw new BreakpointExpressionException("The expression is empty.");
			var expression = ParseOr();
			if (current.Kind != TokenKind.End)
				throw new BreakpointExpressionException($"Unexpected '{current.Text}' at the end of the expression.");
			return expression;
		}

		BreakpointExpression ParseOr() {
			var left = ParseAnd();
			while (current.Kind == TokenKind.OrOr) {
				Advance();
				left = new BinaryExpression(BreakpointOperator.Or, left, ParseAnd());
			}
			return left;
		}

		BreakpointExpression ParseAnd() {
			var left = ParseEquality();
			while (current.Kind == TokenKind.AndAnd) {
				Advance();
				left = new BinaryExpression(BreakpointOperator.And, left, ParseEquality());
			}
			return left;
		}

		BreakpointExpression ParseEquality() {
			var left = ParseRelational();
			while (current.Kind is TokenKind.EqualEqual or TokenKind.NotEqual) {
				var op = current.Kind == TokenKind.EqualEqual ? BreakpointOperator.Equal : BreakpointOperator.NotEqual;
				Advance();
				left = new BinaryExpression(op, left, ParseRelational());
			}
			return left;
		}

		BreakpointExpression ParseRelational() {
			var left = ParseUnary();
			while (current.Kind is TokenKind.Less or TokenKind.LessOrEqual or TokenKind.Greater or TokenKind.GreaterOrEqual) {
				var op = current.Kind switch {
					TokenKind.Less => BreakpointOperator.Less,
					TokenKind.LessOrEqual => BreakpointOperator.LessOrEqual,
					TokenKind.Greater => BreakpointOperator.Greater,
					_ => BreakpointOperator.GreaterOrEqual,
				};
				Advance();
				left = new BinaryExpression(op, left, ParseUnary());
			}
			return left;
		}

		BreakpointExpression ParseUnary() {
			if (current.Kind == TokenKind.Not) {
				Advance();
				return new NotExpression(ParseUnary());
			}
			if (current.Kind == TokenKind.Minus) {
				Advance();
				return new NegateExpression(ParseUnary());
			}
			return ParsePrimary();
		}

		BreakpointExpression ParsePrimary() {
			switch (current.Kind) {
				case TokenKind.Number:
				case TokenKind.String: {
					var value = current.Value;
					Advance();
					return new LiteralExpression(value);
				}
				case TokenKind.Identifier: {
					var name = current.Text;
					Advance();
					return name switch {
						"true" => new LiteralExpression(BreakpointValue.FromBool(true)),
						"false" => new LiteralExpression(BreakpointValue.FromBool(false)),
						"null" => new LiteralExpression(BreakpointValue.Null),
						_ => new NameExpression(name),
					};
				}
				case TokenKind.OpenParen: {
					Advance();
					var inner = ParseOr();
					if (current.Kind != TokenKind.CloseParen)
						throw new BreakpointExpressionException("A '(' is not closed.");
					Advance();
					return inner;
				}
				case TokenKind.End:
					throw new BreakpointExpressionException("The expression ends where a value was expected.");
				default:
					throw new BreakpointExpressionException($"Unexpected '{current.Text}'.");
			}
		}

		void Advance() => current = ReadToken();

		Token ReadToken() {
			while (position < text.Length && char.IsWhiteSpace(text[position]))
				position++;
			if (position >= text.Length)
				return new Token(TokenKind.End, string.Empty, BreakpointValue.Null);
			var c = text[position];
			if (char.IsDigit(c))
				return ReadNumber();
			if (c == '_' || char.IsLetter(c))
				return ReadIdentifier();
			if (c == '"')
				return ReadString();
			if (c == '\'')
				return ReadChar();
			position++;
			switch (c) {
				case '(': return new Token(TokenKind.OpenParen, "(", BreakpointValue.Null);
				case ')': return new Token(TokenKind.CloseParen, ")", BreakpointValue.Null);
				case '-': return new Token(TokenKind.Minus, "-", BreakpointValue.Null);
				case '&':
					if (Take('&'))
						return new Token(TokenKind.AndAnd, "&&", BreakpointValue.Null);
					break;
				case '|':
					if (Take('|'))
						return new Token(TokenKind.OrOr, "||", BreakpointValue.Null);
					break;
				case '=':
					if (Take('='))
						return new Token(TokenKind.EqualEqual, "==", BreakpointValue.Null);
					break;
				case '!':
					return Take('=')
						? new Token(TokenKind.NotEqual, "!=", BreakpointValue.Null)
						: new Token(TokenKind.Not, "!", BreakpointValue.Null);
				case '<':
					return Take('=')
						? new Token(TokenKind.LessOrEqual, "<=", BreakpointValue.Null)
						: new Token(TokenKind.Less, "<", BreakpointValue.Null);
				case '>':
					return Take('=')
						? new Token(TokenKind.GreaterOrEqual, ">=", BreakpointValue.Null)
						: new Token(TokenKind.Greater, ">", BreakpointValue.Null);
			}
			throw new BreakpointExpressionException($"'{c}' is not part of this expression language.");
		}

		bool Take(char expected) {
			if (position >= text.Length || text[position] != expected)
				return false;
			position++;
			return true;
		}

		Token ReadNumber() {
			var start = position;
			if (text[position] == '0' && position + 1 < text.Length && (text[position + 1] is 'x' or 'X')) {
				position += 2;
				var digitStart = position;
				while (position < text.Length && Uri.IsHexDigit(text[position]))
					position++;
				if (position == digitStart)
					throw new BreakpointExpressionException("'0x' is not followed by any hex digits.");
				var hex = text[digitStart..position];
				if (!ulong.TryParse(hex, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out var hexValue))
					throw new BreakpointExpressionException($"'0x{hex}' is too large.");
				return new Token(TokenKind.Number, text[start..position], BreakpointValue.FromUnsigned(hexValue));
			}
			while (position < text.Length && char.IsDigit(text[position]))
				position++;
			var isFloating = position < text.Length && text[position] == '.';
			if (isFloating) {
				position++;
				while (position < text.Length && char.IsDigit(text[position]))
					position++;
			}
			var literal = text[start..position];
			if (isFloating) {
				if (!double.TryParse(literal, NumberStyles.Float, CultureInfo.InvariantCulture, out var floating))
					throw new BreakpointExpressionException($"'{literal}' is not a number.");
				return new Token(TokenKind.Number, literal, BreakpointValue.FromFloating(floating));
			}
			if (!long.TryParse(literal, NumberStyles.Integer, CultureInfo.InvariantCulture, out var integer))
				throw new BreakpointExpressionException($"'{literal}' is too large.");
			return new Token(TokenKind.Number, literal, BreakpointValue.FromInteger(integer));
		}

		Token ReadIdentifier() {
			var start = position;
			while (position < text.Length && (text[position] == '_' || char.IsLetterOrDigit(text[position])))
				position++;
			return new Token(TokenKind.Identifier, text[start..position], BreakpointValue.Null);
		}

		Token ReadString() {
			position++;
			var builder = new StringBuilder();
			while (true) {
				if (position >= text.Length)
					throw new BreakpointExpressionException("A string is not closed.");
				var c = text[position++];
				if (c == '"')
					return new Token(TokenKind.String, builder.ToString(), BreakpointValue.FromString(builder.ToString()));
				builder.Append(c == '\\' ? ReadEscape() : c);
			}
		}

		/// <summary>A char literal is a number, so <c>c == 'x'</c> and <c>c == 65</c> both work.</summary>
		Token ReadChar() {
			position++;
			if (position >= text.Length)
				throw new BreakpointExpressionException("A character literal is not closed.");
			var c = text[position] == '\\' ? Skip() : text[position++];
			if (position >= text.Length || text[position] != '\'')
				throw new BreakpointExpressionException("A character literal is not closed.");
			position++;
			return new Token(TokenKind.Number, c.ToString(), BreakpointValue.FromInteger(c));

			char Skip() {
				position++;
				return ReadEscape();
			}
		}

		char ReadEscape() {
			if (position >= text.Length)
				throw new BreakpointExpressionException("A '\\' ends the expression.");
			var c = text[position++];
			return c switch {
				'n' => '\n',
				'r' => '\r',
				't' => '\t',
				'0' => '\0',
				'\\' => '\\',
				'"' => '"',
				'\'' => '\'',
				_ => throw new BreakpointExpressionException($"'\\{c}' is not an escape this expression language knows."),
			};
		}
	}
}
