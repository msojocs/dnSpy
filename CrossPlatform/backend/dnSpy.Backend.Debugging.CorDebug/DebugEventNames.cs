namespace dnSpy.Backend.Debugging.CorDebug;

/// <summary>Debug event names, mirroring the vocabulary the client already understands.</summary>
internal static class DebugEventNames {
	public const string Stopped = "stopped";
	public const string Continued = "continued";
	public const string Output = "output";
	public const string Exited = "exited";
	public const string Terminated = "terminated";
	public const string Breakpoint = "breakpoint";
	public const string Process = "process";
}

/// <summary>Why the process stopped, as reported in a <c>stopped</c> event.</summary>
internal static class StopReasons {
	public const string Breakpoint = "breakpoint";
	public const string Step = "step";
	public const string Pause = "pause";
	public const string Entry = "entry";
	public const string Exception = "exception";
}
