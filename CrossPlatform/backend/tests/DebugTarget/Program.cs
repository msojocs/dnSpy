using System.Runtime.CompilerServices;

namespace DebugTarget;

internal static class Program {
	static void Main(string[] args) {
		if (args.Contains("--wait", StringComparer.Ordinal)) {
			Console.WriteLine("READY");
			Console.Out.Flush();
			while (true)
				Thread.Sleep(100);
		}
		var left = 20;
		var right = 22;
		var result = Calculate(left, right);
		Console.WriteLine(result);
	}

	[MethodImpl(MethodImplOptions.NoInlining)]
	static int Calculate(int left, int right) {
		var sum = left + right;
		return sum;
	}
}
