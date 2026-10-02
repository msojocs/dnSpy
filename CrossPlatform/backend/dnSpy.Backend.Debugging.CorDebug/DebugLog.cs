using System.Text.Json;

namespace dnSpy.Backend.Debugging.CorDebug;

/// <summary>
/// Diagnostics for the debug engine. Shares the host's JSON-lines format on stderr so the client
/// reads engine failures the same way it reads host failures.
/// </summary>
internal static class DebugLog {
	static readonly object Gate = new();

	public static void Info(string message, object? data = null) => Write("info", message, data);

	public static void Error(string message, Exception exception) => Write("error", message, new {
		exception = exception.GetType().FullName,
		exception.Message,
		exception.StackTrace,
	});

	static void Write(string level, string message, object? data) {
		var line = JsonSerializer.Serialize(new {
			timestamp = DateTimeOffset.UtcNow,
			level,
			message,
			data,
		});
		lock (Gate)
			Console.Error.WriteLine(line);
	}
}
