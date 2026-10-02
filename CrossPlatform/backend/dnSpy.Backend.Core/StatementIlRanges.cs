using ICSharpCode.Decompiler.CSharp.Syntax;
using ICSharpCode.Decompiler.IL;

namespace dnSpy.Backend.Core;

/// <summary>
/// The IL offset a decompiled statement's own code starts at, keyed by the body that holds it.
/// </summary>
/// <remarks>
/// <see cref="CSharpDecompiler.CreateSequencePoints"/> does not report that offset: it hands out points that
/// tile the method's IL, pulling the start of a statement backwards onto the nearest offset where the
/// evaluation stack is empty (SequencePointBuilder.GetSequencePoints). Every offset that belongs to no
/// statement — the load and branch a loop ends with, say — is therefore charged to the statement that
/// follows it, and the <c>return</c> under a loop reports the offset of the loop's condition. A breakpoint
/// set there runs the loop again instead of the line the user clicked, and a step uses it as a target.
/// The IL ranges the printed tree was annotated with still hold each statement's own start, which is what
/// this reads: the same ranges dnSpy's WPF decompiler builds its source statements from.
/// </remarks>
static class StatementIlRanges {
	/// <summary>
	/// The starts of every instruction the tree was annotated with, per body, in ascending order.
	/// </summary>
	public static Dictionary<ILFunction, List<int>> Collect(SyntaxTree syntaxTree) {
		var starts = new Dictionary<ILFunction, List<int>>();
		// An instruction belongs to the first node that reaches it, like ILSpy's own mappedInstructions set.
		var claimed = new HashSet<ILInstruction>();
		foreach (var node in syntaxTree.DescendantsAndSelf) {
			foreach (var instruction in node.Annotations.OfType<ILInstruction>())
				Collect(instruction, starts, claimed);
		}
		foreach (var offsets in starts.Values)
			offsets.Sort();
		return starts;
	}

	static void Collect(ILInstruction instruction, Dictionary<ILFunction, List<int>> starts, HashSet<ILInstruction> claimed) {
		if (!claimed.Add(instruction))
			return;
		var parent = instruction.Parent;
		// A function is the body itself and a block is where the IL of its own instructions lives, so
		// neither starts a statement. Everything else contributes the start of its own code, and the
		// sub-instructions it is made of add theirs below.
		if (parent is not null && !instruction.ILRangeIsEmpty && instruction is not BlockContainer)
			Add(starts, parent.Ancestors.OfType<ILFunction>().FirstOrDefault(), instruction.StartILOffset);
		if (instruction is ILFunction)
			return;
		foreach (var child in instruction.Children)
			Collect(child, starts, claimed);
	}

	static void Add(Dictionary<ILFunction, List<int>> starts, ILFunction? function, int offset) {
		if (function is null)
			return;
		if (!starts.TryGetValue(function, out var offsets))
			starts.Add(function, offsets = []);
		offsets.Add(offset);
	}

	/// <summary>
	/// The offset inside <paramref name="endOffset"/> that the statement starts at, or the offset the
	/// sequence point gave when the tree said nothing about it.
	/// </summary>
	public static int StartWithin(List<int>? starts, int offset, int endOffset) {
		if (starts is null)
			return offset;
		var index = starts.BinarySearch(offset);
		if (index < 0)
			index = ~index;
		return index < starts.Count && starts[index] < endOffset ? starts[index] : offset;
	}
}
