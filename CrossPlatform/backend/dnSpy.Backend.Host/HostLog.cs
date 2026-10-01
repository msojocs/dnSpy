using System.Text.Json;

namespace dnSpy.Backend.Host;

internal static class HostLog {
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
