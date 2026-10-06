using System.Runtime.CompilerServices;

namespace DebugTarget;
internal static class Program {
	[ModuleInitializer] internal static void InitializeModule() { }
	static void Main(string[] args) {
		if (args.Contains("--wait", StringComparer.Ordinal)) {
			Console.WriteLine("READY");
			Console.Out.Flush();
			while (true)
				Thread.Sleep(100);
		}
		var left = 2;
		var right = 21;
		var result = Calculate(left, right);
		Console.WriteLine(result);
		Console.WriteLine(AddAsync(left, right).GetAwaiter().GetResult());
	}
	// The accumulator is a real local rather than a single-use temporary: the decompiler inlines a
	// variable that is assigned once, and a debuggee whose locals all disappear cannot exercise the
	// Locals window. 2 * 21 keeps the answer the tests expect.
	[MethodImpl(MethodImplOptions.NoInlining)]
	static int Calculate(int left, int right) {
		var sum = 0;
		for (var i = 0; i < right; i++)
			sum += left;

		return sum;
	}

	// The compiler splits this one into a state machine, so the frame a breakpoint inside it stops on is
	// a generated MoveNext. What the debugger has to walk is the two statements the user wrote, not the
	// plumbing between them: a step over the first has to cross the suspension and land on the second.
	[MethodImpl(MethodImplOptions.NoInlining)]
	static async Task<int> AddAsync(int left, int right) {
		var sum = left + right;
		await Task.Yield();
		return sum;
	}
}
