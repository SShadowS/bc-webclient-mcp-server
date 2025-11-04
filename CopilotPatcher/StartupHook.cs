// CRITICAL: This class MUST be at the root namespace (no "namespace" declaration)
// for .NET runtime to discover it via DOTNET_STARTUP_HOOKS

using System;
using System.IO;

/// <summary>
/// Entry point for .NET Startup Hooks.
/// MUST be at root namespace with exact signature: public static void Initialize()
/// </summary>
public class StartupHook
{
    private static readonly string LogPath = Path.Combine(
        AppContext.BaseDirectory,
        "CopilotPatcher.log"
    );

    public static void Initialize()
    {
        try
        {
            // Only run in BC service process
            if (!AppContext.BaseDirectory.Contains("Microsoft Dynamics NAV"))
            {
                Log("[CopilotPatcher] Not in BC directory, skipping");
                return; // Not BC, skip
            }

            Log("[CopilotPatcher] ========================================");
            Log("[CopilotPatcher] Startup hook activated");
            Log($"[CopilotPatcher] Base directory: {AppContext.BaseDirectory}");
            Log($"[CopilotPatcher] Runtime: {System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription}");

            // Setup AssemblyResolve to manually load 0Harmony.dll from base directory
            AppDomain.CurrentDomain.AssemblyResolve += (sender, args) =>
            {
                try
                {
                    // Only handle Harmony assembly
                    if (!args.Name.StartsWith("0Harmony,"))
                        return null;

                    Log($"[CopilotPatcher] Resolving assembly: {args.Name}");

                    // Try to load from base directory
                    var harmonyPath = Path.Combine(AppContext.BaseDirectory, "0Harmony.dll");
                    if (File.Exists(harmonyPath))
                    {
                        Log($"[CopilotPatcher] Loading Harmony from: {harmonyPath}");
                        return System.Reflection.Assembly.LoadFrom(harmonyPath);
                    }

                    // Try to load from CopilotPatcher subfolder
                    var subfolderPath = Path.Combine(AppContext.BaseDirectory, "CopilotPatcher", "0Harmony.dll");
                    if (File.Exists(subfolderPath))
                    {
                        Log($"[CopilotPatcher] Loading Harmony from subfolder: {subfolderPath}");
                        return System.Reflection.Assembly.LoadFrom(subfolderPath);
                    }

                    Log($"[CopilotPatcher] Could not find 0Harmony.dll in any location");
                    return null;
                }
                catch (Exception ex)
                {
                    Log($"[CopilotPatcher] AssemblyResolve error: {ex.Message}");
                    return null;
                }
            };

            CopilotPatcher.CopilotApiPatcher.Apply();

            Log("[CopilotPatcher] Patching setup completed");
            Log("[CopilotPatcher] ========================================");
        }
        catch (Exception ex)
        {
            Log($"[CopilotPatcher] FATAL ERROR: {ex.Message}");
            Log($"[CopilotPatcher] Stack: {ex.StackTrace}");
            // Don't throw - let BC continue even if patching fails
        }
    }

    private static void Log(string message)
    {
        try
        {
            var entry = $"{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff} {message}\n";
            File.AppendAllText(LogPath, entry);
        }
        catch
        {
            // Ignore logging errors
        }
    }
}
