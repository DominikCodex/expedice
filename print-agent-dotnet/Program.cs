using Microsoft.Win32;
using System.Diagnostics;
using System.Drawing.Printing;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using System.Windows.Forms;

namespace ExpedicePrintAgentV2;

internal static class Program
{
    private const string AppName = "ExpedicePrintAgentV2";
    private const string InstalledExeName = "ExpedicePrintAgentV2.exe";
    private const string Version = "2.0.0-dotnet";
    private const int MaxRequestBytes = 80 * 1024 * 1024;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        WriteIndented = false
    };

    [STAThread]
    private static int Main(string[] args)
    {
        try
        {
            var executableName = Path.GetFileNameWithoutExtension(Environment.ProcessPath ?? "");
            if (args.Any(arg => arg.Equals("--server", StringComparison.OrdinalIgnoreCase)))
            {
                RunServer();
                return 0;
            }

            if (
                executableName.Contains("Uninstall", StringComparison.OrdinalIgnoreCase) ||
                args.Any(arg => arg.Equals("--uninstall", StringComparison.OrdinalIgnoreCase))
            )
            {
                Uninstall();
                return 0;
            }

            Install();
            return 0;
        }
        catch (Exception error)
        {
            ShowMessage("Expedice Print Agent V2 - chyba", error.Message, error: true);
            return 1;
        }
    }

    private static void Install()
    {
        var installDir = InstallDir();
        var configDir = ConfigDir();
        var currentExe = Environment.ProcessPath ?? throw new InvalidOperationException("Neznam cestu ke spustenemu EXE.");
        var installedExe = Path.Combine(installDir, InstalledExeName);

        StopExistingV2Processes();

        Directory.CreateDirectory(installDir);
        Directory.CreateDirectory(configDir);
        File.Copy(currentExe, installedExe, overwrite: true);
        EnsureConfigFile();

        using var runKey = Registry.CurrentUser.OpenSubKey(
            @"Software\Microsoft\Windows\CurrentVersion\Run",
            writable: true
        ) ?? Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", writable: true);
        runKey.SetValue(AppName, $"\"{installedExe}\" --server");

        Process.Start(new ProcessStartInfo
        {
            FileName = installedExe,
            Arguments = "--server",
            WorkingDirectory = installDir,
            UseShellExecute = false,
            CreateNoWindow = true
        });

        ShowMessage(
            "Expedice Print Agent V2",
            "Instalace V2 je hotova.\n\n" +
            $"Agent je nainstalovan zde:\n{installDir}\n\n" +
            "Ted v aplikaci klikni na Otestovat agenta.\n" +
            "Pokud bezi stara V1 na stejnem PC, nejdriv ji odinstaluj nebo ukonci."
        );
    }

    private static void Uninstall()
    {
        StopExistingV2Processes();

        using var runKey = Registry.CurrentUser.OpenSubKey(
            @"Software\Microsoft\Windows\CurrentVersion\Run",
            writable: true
        );
        runKey?.DeleteValue(AppName, throwOnMissingValue: false);

        var installDir = InstallDir();
        if (Directory.Exists(installDir))
        {
            Directory.Delete(installDir, recursive: true);
        }

        ShowMessage("Expedice Print Agent V2", "Odinstalace V2 je hotova.");
    }

    private static void RunServer()
    {
        EnsureConfigFile();
        var config = LoadConfig();
        var listener = new TcpListener(IPAddress.Loopback, config.Port);
        listener.Start();
        WriteLog($"Started {Version} on 127.0.0.1:{config.Port}");

        while (true)
        {
            var client = listener.AcceptTcpClient();
            _ = Task.Run(() => HandleClient(client));
        }
    }

    private static async Task HandleClient(TcpClient client)
    {
        using (client)
        {
        try
        {
            client.ReceiveTimeout = 15000;
            client.SendTimeout = 15000;

            var config = LoadConfig();
            var request = await ReadRequest(client.GetStream());
            if (request is null)
            {
                return;
            }

            if (request.Method.Equals("OPTIONS", StringComparison.OrdinalIgnoreCase))
            {
                await WriteResponse(client, request, config, 204, "text/plain; charset=utf-8", Array.Empty<byte>());
                return;
            }

            if (request.Method == "GET" && request.Path == "/health")
            {
                await WriteJson(client, request, config, 200, new
                {
                    ok = true,
                    version = Version,
                    runtime = ".NET",
                    sumatraAvailable = FindSumatra(config) is not null,
                    config = PublicConfig(config)
                });
                return;
            }

            if (request.Method == "GET" && request.Path == "/printers")
            {
                await WriteJson(client, request, config, 200, new
                {
                    ok = true,
                    printers = PrinterSettings.InstalledPrinters.Cast<string>().ToArray()
                });
                return;
            }

            if (request.Method == "POST" && request.Path == "/print")
            {
                var printRequest = JsonSerializer.Deserialize<PrintRequest>(request.Body, JsonOptions);
                if (printRequest is null || string.IsNullOrWhiteSpace(printRequest.ContentBase64))
                {
                    await WriteJson(client, request, config, 400, new { error = "Chybi PDF obsah." });
                    return;
                }

                var result = PrintPdf(printRequest, config);
                await WriteJson(client, request, config, 200, result);
                return;
            }

            await WriteJson(client, request, config, 404, new { error = "Not found" });
        }
        catch (Exception error)
        {
            WriteLog(error.ToString());
            try
            {
                var fallbackConfig = LoadConfig();
                await WriteJson(client, null, fallbackConfig, 500, new { error = error.Message });
            }
            catch
            {
                // Nothing else to do for a broken local socket.
            }
        }
        }
    }

    private static PrintResult PrintPdf(PrintRequest request, AgentConfig config)
    {
        var pdfBytes = Convert.FromBase64String(request.ContentBase64);
        var tempDir = Path.Combine(Path.GetTempPath(), AppName);
        Directory.CreateDirectory(tempDir);

        var fileName = SafeFileName(string.IsNullOrWhiteSpace(request.Filename) ? "expedice-label.pdf" : request.Filename);
        if (!fileName.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase))
        {
            fileName += ".pdf";
        }

        var pdfPath = Path.Combine(tempDir, $"{DateTime.Now:yyyyMMdd-HHmmss-fff}-{fileName}");
        File.WriteAllBytes(pdfPath, pdfBytes);

        var printer = ChoosePrinter(request, config);
        var sumatra = FindSumatra(config);
        var usedMode = "windows-shell";

        if (sumatra is not null)
        {
            usedMode = "sumatra";
            var arguments = string.IsNullOrWhiteSpace(printer)
                ? $"-print-to-default -silent \"{pdfPath}\""
                : $"-print-to \"{printer}\" -silent \"{pdfPath}\"";

            using var process = Process.Start(new ProcessStartInfo
            {
                FileName = sumatra,
                Arguments = arguments,
                UseShellExecute = false,
                CreateNoWindow = true
            });
            process?.WaitForExit(20000);
        }
        else
        {
            var startInfo = new ProcessStartInfo
            {
                FileName = pdfPath,
                UseShellExecute = true,
                Verb = string.IsNullOrWhiteSpace(printer) ? "print" : "printto",
                WindowStyle = ProcessWindowStyle.Hidden
            };
            if (!string.IsNullOrWhiteSpace(printer))
            {
                startInfo.Arguments = $"\"{printer}\"";
            }

            Process.Start(startInfo);
        }

        if (!config.KeepPrintedFiles)
        {
            _ = Task.Run(async () =>
            {
                await Task.Delay(TimeSpan.FromSeconds(20));
                TryDelete(pdfPath);
            });
        }

        return new PrintResult(true, usedMode, printer ?? "default", fileName);
    }

    private static string? ChoosePrinter(PrintRequest request, AgentConfig config)
    {
        if (!string.IsNullOrWhiteSpace(request.Printer))
        {
            return request.Printer.Trim();
        }

        if (request.Type.Equals("default", StringComparison.OrdinalIgnoreCase))
        {
            return EmptyToNull(config.Printers.DefaultDocument);
        }

        if (request.Carrier.Equals("dpd", StringComparison.OrdinalIgnoreCase))
        {
            return EmptyToNull(config.Printers.DpdLabel);
        }

        if (
            request.Carrier.Equals("packeta", StringComparison.OrdinalIgnoreCase) ||
            request.Carrier.Equals("zasilkovna", StringComparison.OrdinalIgnoreCase)
        )
        {
            return EmptyToNull(config.Printers.PacketaLabel);
        }

        return null;
    }

    private static async Task<LocalRequest?> ReadRequest(NetworkStream stream)
    {
        var buffer = new byte[8192];
        var received = new List<byte>(8192);
        var headerEnd = -1;

        while (headerEnd < 0)
        {
            var read = await stream.ReadAsync(buffer);
            if (read <= 0)
            {
                return null;
            }

            received.AddRange(buffer.Take(read));
            if (received.Count > MaxRequestBytes)
            {
                throw new InvalidOperationException("Pozadavek je prilis velky.");
            }

            headerEnd = HeaderEndIndex(received);
        }

        var headerText = Encoding.UTF8.GetString(received.Take(headerEnd).ToArray());
        var lines = headerText.Split("\r\n", StringSplitOptions.None);
        var firstLine = lines[0].Split(' ', 3);
        if (firstLine.Length < 2)
        {
            return null;
        }

        var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var line in lines.Skip(1))
        {
            var separator = line.IndexOf(':');
            if (separator > 0)
            {
                headers[line[..separator].Trim()] = line[(separator + 1)..].Trim();
            }
        }

        var contentLength = headers.TryGetValue("Content-Length", out var lengthText) && int.TryParse(lengthText, out var parsed)
            ? parsed
            : 0;

        var bodyStart = headerEnd + 4;
        var body = received.Skip(bodyStart).ToArray();
        while (body.Length < contentLength)
        {
            var read = await stream.ReadAsync(buffer);
            if (read <= 0)
            {
                break;
            }

            received.AddRange(buffer.Take(read));
            if (received.Count > MaxRequestBytes)
            {
                throw new InvalidOperationException("Pozadavek je prilis velky.");
            }

            body = received.Skip(bodyStart).Take(contentLength).ToArray();
        }

        return new LocalRequest(firstLine[0], new Uri("http://local" + firstLine[1]).AbsolutePath, headers, body);
    }

    private static int HeaderEndIndex(List<byte> bytes)
    {
        for (var index = 0; index <= bytes.Count - 4; index++)
        {
            if (bytes[index] == '\r' && bytes[index + 1] == '\n' && bytes[index + 2] == '\r' && bytes[index + 3] == '\n')
            {
                return index;
            }
        }

        return -1;
    }

    private static async Task WriteJson(TcpClient client, LocalRequest? request, AgentConfig config, int statusCode, object payload)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(payload, JsonOptions);
        await WriteResponse(client, request, config, statusCode, "application/json; charset=utf-8", bytes);
    }

    private static async Task WriteResponse(
        TcpClient client,
        LocalRequest? request,
        AgentConfig config,
        int statusCode,
        string contentType,
        byte[] body
    )
    {
        var reason = statusCode switch
        {
            200 => "OK",
            204 => "No Content",
            400 => "Bad Request",
            404 => "Not Found",
            500 => "Internal Server Error",
            _ => "OK"
        };

        var origin = request?.Headers.TryGetValue("Origin", out var originHeader) == true ? originHeader : "";
        var allowOrigin = IsAllowedOrigin(origin, config) ? origin : "";
        var header = new StringBuilder();
        header.Append($"HTTP/1.1 {statusCode} {reason}\r\n");
        header.Append($"Content-Type: {contentType}\r\n");
        header.Append($"Content-Length: {body.Length}\r\n");
        header.Append("Connection: close\r\n");
        header.Append("Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n");
        header.Append("Access-Control-Allow-Headers: Content-Type\r\n");
        header.Append("Access-Control-Allow-Private-Network: true\r\n");
        if (!string.IsNullOrWhiteSpace(allowOrigin))
        {
            header.Append($"Access-Control-Allow-Origin: {allowOrigin}\r\n");
            header.Append("Vary: Origin\r\n");
        }
        header.Append("\r\n");

        var stream = client.GetStream();
        var headerBytes = Encoding.UTF8.GetBytes(header.ToString());
        await stream.WriteAsync(headerBytes);
        if (body.Length > 0)
        {
            await stream.WriteAsync(body);
        }
    }

    private static bool IsAllowedOrigin(string origin, AgentConfig config)
    {
        if (string.IsNullOrWhiteSpace(origin))
        {
            return false;
        }

        if (origin.StartsWith("http://127.0.0.1", StringComparison.OrdinalIgnoreCase) ||
            origin.StartsWith("http://localhost", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        return config.AllowedOrigins.Any(allowed => allowed.Equals(origin, StringComparison.OrdinalIgnoreCase));
    }

    private static object PublicConfig(AgentConfig config)
    {
        return new
        {
            port = config.Port,
            printers = config.Printers
        };
    }

    private static AgentConfig LoadConfig()
    {
        EnsureConfigFile();
        var json = File.ReadAllText(ConfigPath(), Encoding.UTF8);
        return JsonSerializer.Deserialize<AgentConfig>(json, JsonOptions) ?? AgentConfig.Default();
    }

    private static void EnsureConfigFile()
    {
        Directory.CreateDirectory(ConfigDir());
        var path = ConfigPath();
        if (!File.Exists(path))
        {
            File.WriteAllText(path, JsonSerializer.Serialize(AgentConfig.Default(), JsonOptions), Encoding.UTF8);
        }
    }

    private static string? FindSumatra(AgentConfig config)
    {
        var candidates = new[]
        {
            config.SumatraPath,
            Path.Combine(InstallDir(), "bin", "SumatraPDF.exe"),
            Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "ExpedicePrintAgent",
                "bin",
                "SumatraPDF.exe"
            )
        };

        return candidates.FirstOrDefault(path => !string.IsNullOrWhiteSpace(path) && File.Exists(path));
    }

    private static void StopExistingV2Processes()
    {
        var currentId = Environment.ProcessId;
        foreach (var process in Process.GetProcessesByName(Path.GetFileNameWithoutExtension(InstalledExeName)))
        {
            if (process.Id == currentId)
            {
                continue;
            }

            try
            {
                process.Kill(entireProcessTree: true);
                process.WaitForExit(3000);
            }
            catch
            {
                // Best effort only.
            }
        }
    }

    private static void ShowMessage(string title, string message, bool error = false)
    {
        MessageBox.Show(message, title, MessageBoxButtons.OK, error ? MessageBoxIcon.Error : MessageBoxIcon.Information);
    }

    private static void WriteLog(string message)
    {
        try
        {
            Directory.CreateDirectory(ConfigDir());
            File.AppendAllText(
                Path.Combine(ConfigDir(), "agent.log"),
                $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] {message}{Environment.NewLine}",
                Encoding.UTF8
            );
        }
        catch
        {
            // Logging must never break printing.
        }
    }

    private static string SafeFileName(string value)
    {
        foreach (var invalid in Path.GetInvalidFileNameChars())
        {
            value = value.Replace(invalid, '-');
        }

        return value;
    }

    private static string? EmptyToNull(string? value)
    {
        return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    }

    private static void TryDelete(string path)
    {
        try
        {
            if (File.Exists(path))
            {
                File.Delete(path);
            }
        }
        catch
        {
            // Temporary files can be left behind without breaking operations.
        }
    }

    private static string InstallDir()
    {
        return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), AppName);
    }

    private static string ConfigDir()
    {
        return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), AppName);
    }

    private static string ConfigPath()
    {
        return Path.Combine(ConfigDir(), "config.json");
    }
}

internal sealed record LocalRequest(string Method, string Path, Dictionary<string, string> Headers, byte[] Body);

internal sealed record PrintResult(bool Ok, string Mode, string Printer, string Filename);

internal sealed class PrintRequest
{
    public string Type { get; set; } = "carrier_label";
    public string Carrier { get; set; } = "";
    public string Filename { get; set; } = "expedice-label.pdf";
    public string ContentBase64 { get; set; } = "";
    public int Copies { get; set; } = 1;
    public string Printer { get; set; } = "";
}

internal sealed class AgentConfig
{
    public int Port { get; set; } = 8787;
    public List<string> AllowedOrigins { get; set; } = new();
    public PrinterConfig Printers { get; set; } = new();
    public string SumatraPath { get; set; } = "";
    public bool KeepPrintedFiles { get; set; }

    public static AgentConfig Default()
    {
        return new AgentConfig
        {
            Port = 8787,
            AllowedOrigins = new List<string>
            {
                "https://expedice-production.up.railway.app",
                "http://localhost:5000",
                "http://127.0.0.1:5000"
            },
            Printers = new PrinterConfig
            {
                DpdLabel = "Brother QL-1100",
                PacketaLabel = "Brother QL-700",
                DefaultDocument = ""
            },
            SumatraPath = "",
            KeepPrintedFiles = false
        };
    }
}

internal sealed class PrinterConfig
{
    public string DpdLabel { get; set; } = "Brother QL-1100";
    public string PacketaLabel { get; set; } = "Brother QL-700";
    public string DefaultDocument { get; set; } = "";
}
