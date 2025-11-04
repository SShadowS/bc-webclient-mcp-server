using System;
using System.Linq;
using System.Reflection;
using HarmonyLib;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Infrastructure;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace CopilotPatcher
{
    public static class CopilotApiPatcher
    {
        private static bool _patchAttempted = false;
        private static readonly object _lock = new object();

        public static void Apply()
        {
            lock (_lock)
            {
                if (_patchAttempted)
                    return;

                _patchAttempted = true;
            }

            Log("[CopilotPatcher] Attempting to apply patches");

            // Try immediate patch (if assembly already loaded)
            if (!TryPatchNow())
            {
                // Assembly not loaded yet, subscribe to load event
                Log("[CopilotPatcher] Assembly not loaded yet, subscribing to AssemblyLoad event");
                AppDomain.CurrentDomain.AssemblyLoad += OnAssemblyLoad;
            }
        }

        private static void OnAssemblyLoad(object? sender, AssemblyLoadEventArgs args)
        {
            if (args.LoadedAssembly.GetName().Name == "Microsoft.Dynamics.Nav.Service.CopilotApi")
            {
                Log($"[CopilotPatcher] CopilotApi assembly loaded: {args.LoadedAssembly.FullName}");
                TryPatchNow();

                // Unsubscribe after successful patch
                AppDomain.CurrentDomain.AssemblyLoad -= OnAssemblyLoad;
                Log("[CopilotPatcher] Unsubscribed from AssemblyLoad event");
            }
        }

        private static bool TryPatchNow()
        {
            try
            {
                var harmony = new Harmony("onprem.bc.copilot.patch");

                // Find CopilotApiStartup type
                var startupType = AppDomain.CurrentDomain.GetAssemblies()
                    .Where(a => a.GetName().Name == "Microsoft.Dynamics.Nav.Service.CopilotApi")
                    .SelectMany(a => {
                        try { return a.GetTypes(); }
                        catch { return Array.Empty<Type>(); }
                    })
                    .FirstOrDefault(t => t.FullName == "Microsoft.Dynamics.Nav.Service.CopilotApi.Hosts.CopilotApiStartup");

                if (startupType == null)
                {
                    Log("[CopilotPatcher] CopilotApiStartup type not found");
                    return false;
                }

                Log($"[CopilotPatcher] Found CopilotApiStartup: {startupType.FullName}");

                // Patch ConfigureServices
                var configureServicesMethod = startupType.GetMethod(
                    "ConfigureServices",
                    BindingFlags.Public | BindingFlags.Instance,
                    null,
                    new[] { typeof(IServiceCollection) },
                    null
                );

                if (configureServicesMethod != null)
                {
                    var prefixMethod = new HarmonyMethod(
                        typeof(CopilotApiPatcher).GetMethod(
                            nameof(PatchedConfigureServices),
                            BindingFlags.Public | BindingFlags.Static
                        )
                    );
                    harmony.Patch(configureServicesMethod, prefix: prefixMethod);
                    Log("[CopilotPatcher] ConfigureServices patched successfully");
                }
                else
                {
                    Log("[CopilotPatcher] WARNING: ConfigureServices method not found");
                }

                // Patch Configure to skip UseMise
                var configureMethod = startupType.GetMethod(
                    "Configure",
                    BindingFlags.Public | BindingFlags.Instance
                );

                if (configureMethod != null)
                {
                    var configurePrefix = new HarmonyMethod(
                        typeof(CopilotApiPatcher).GetMethod(
                            nameof(PatchedConfigure),
                            BindingFlags.Public | BindingFlags.Static
                        )
                    );
                    harmony.Patch(configureMethod, prefix: configurePrefix);
                    Log("[CopilotPatcher] Configure patched successfully");
                }
                else
                {
                    Log("[CopilotPatcher] WARNING: Configure method not found");
                }

                // Patch AspNetCoreApiHost.ConfigureBuilder to use Kestrel instead of HTTP.sys
                var aspNetCoreApiHostType = AppDomain.CurrentDomain.GetAssemblies()
                    .Where(a => a.GetName().Name == "Microsoft.Dynamics.Nav.Service.AspNetCore")
                    .SelectMany(a => {
                        try { return a.GetTypes(); }
                        catch { return Array.Empty<Type>(); }
                    })
                    .FirstOrDefault(t => t.FullName == "Microsoft.Dynamics.Nav.Service.AspNetCore.AspNetCoreApiHost");

                if (aspNetCoreApiHostType != null)
                {
                    Log($"[CopilotPatcher] Found AspNetCoreApiHost: {aspNetCoreApiHostType.FullName}");

                    var configureBuilderMethod = aspNetCoreApiHostType.GetMethod(
                        "ConfigureBuilder",
                        BindingFlags.NonPublic | BindingFlags.Static
                    );

                    if (configureBuilderMethod != null)
                    {
                        // Use PREFIX patch - conditionally skip original for CopilotApi
                        var configureBuilderPrefix = new HarmonyMethod(
                            typeof(CopilotApiPatcher).GetMethod(
                                nameof(ConfigureBuilderPrefix),
                                BindingFlags.Public | BindingFlags.Static
                            )
                        );
                        harmony.Patch(configureBuilderMethod, prefix: configureBuilderPrefix);
                        Log("[CopilotPatcher] ConfigureBuilder patched successfully (prefix)");
                    }
                    else
                    {
                        Log("[CopilotPatcher] WARNING: ConfigureBuilder method not found");
                    }
                }
                else
                {
                    Log("[CopilotPatcher] WARNING: AspNetCoreApiHost type not found");
                }

                return true;
            }
            catch (Exception ex)
            {
                Log($"[CopilotPatcher] Patch failed: {ex.Message}");
                Log($"[CopilotPatcher] Stack: {ex.StackTrace}");
                return false;
            }
        }

        /// <summary>
        /// Replacement for CopilotApiStartup.ConfigureServices
        /// CRITICAL: Uses "S2SAuthentication" scheme to match BC's DefaultPolicy
        /// </summary>
        public static bool PatchedConfigureServices(
            object __instance,
            IServiceCollection services)
        {
            Log("[CopilotPatcher] PatchedConfigureServices executing");

            try
            {
                Log("[CopilotPatcher] Step 1: Adding Routing");
                // Basic services
                services.AddRouting();

                Log("[CopilotPatcher] Step 2: Getting McpController type");
                // Add MCP controller assembly
                Type mcpControllerType;
                try
                {
                    mcpControllerType = typeof(McpController);
                    Log($"[CopilotPatcher] McpController type: {mcpControllerType.FullName}");
                    Log($"[CopilotPatcher] McpController assembly: {mcpControllerType.Assembly.FullName}");
                }
                catch (Exception ex)
                {
                    Log($"[CopilotPatcher] ERROR getting McpController type: {ex.Message}");
                    Log($"[CopilotPatcher] Stack: {ex.StackTrace}");
                    throw;
                }

                Log("[CopilotPatcher] Step 3: Adding Controllers");
                services.AddControllers()
                    .AddApplicationPart(mcpControllerType.Assembly); // Add MCP controller

                Log("[CopilotPatcher] Step 4: McpController assembly registered with AddApplicationPart");

                // API versioning (same as original)
                services.AddApiVersioning(opt =>
                {
                    opt.ReportApiVersions = true;
                    // Use reflection to create UrlSegmentApiVersionReader
                    var readerType = Type.GetType("Microsoft.AspNetCore.Mvc.Versioning.UrlSegmentApiVersionReader, Microsoft.AspNetCore.Mvc.Versioning");
                    if (readerType != null)
                    {
                        opt.ApiVersionReader = (Microsoft.AspNetCore.Mvc.Versioning.IApiVersionReader)Activator.CreateInstance(readerType)!;
                    }
                });

                // CRITICAL: Use "S2SAuthentication" scheme name to match BC's DefaultPolicy
                // BC's original ConfigureServices line 81-85 creates policy with scheme "S2SAuthentication"
                services.AddAuthentication("S2SAuthentication")
                    .AddScheme<AuthenticationSchemeOptions, OnPremApiKeyAuthHandler>(
                        "S2SAuthentication",
                        options => { }
                    );

                // Authorization policy matching original structure
                services.AddAuthorization(options =>
                {
                    var policy = new AuthorizationPolicyBuilder("S2SAuthentication")
                        .RequireAuthenticatedUser()
                        .Build();

                    options.DefaultPolicy = policy;
                    options.FallbackPolicy = policy;
                });

                Log("[CopilotPatcher] Services configured successfully (S2S replaced with API key auth)");
                return false; // Skip original ConfigureServices
            }
            catch (Exception ex)
            {
                Log($"[CopilotPatcher] ERROR in PatchedConfigureServices: {ex.Message}");
                Log($"[CopilotPatcher] Stack: {ex.StackTrace}");
                return true; // Let original run if we fail
            }
        }

        /// <summary>
        /// Patch Configure to:
        /// 1. Add UsePathBase for Kestrel (which doesn't support path in Listen URL)
        /// 2. Skip UseMise which requires AddMise services
        /// </summary>
        public static bool PatchedConfigure(
            object __instance,
            IApplicationBuilder app)
        {
            Log("[CopilotPatcher] PatchedConfigure executing");

            try
            {
                // CRITICAL: Add path base middleware for Kestrel support
                // CopilotApi is typically at /{serverInstance}/copilot
                // Since Kestrel doesn't support path bases in Listen URLs, we add custom middleware
                try
                {
                    var serverInstance = Environment.GetEnvironmentVariable("SERVERINSTANCE") ?? "BC";
                    var pathBase = $"/{serverInstance}/copilot";

                    // Add custom middleware that strips the path base
                    app.Use(async (context, next) =>
                    {
                        var request = context.Request;
                        var path = request.Path.Value;

                        if (path != null && path.StartsWith(pathBase, StringComparison.OrdinalIgnoreCase))
                        {
                            // Strip the path base and set the new path
                            var newPath = path.Substring(pathBase.Length);
                            if (string.IsNullOrEmpty(newPath))
                                newPath = "/";

                            request.Path = newPath;
                            request.PathBase = pathBase;
                        }

                        await next();
                    });

                    Log($"[CopilotPatcher] Added path base middleware for '{pathBase}'");
                }
                catch (Exception ex)
                {
                    Log($"[CopilotPatcher] WARNING: Failed to add path base middleware: {ex.Message}");
                }

                // Replicate original Configure but skip UseMise
                app.UseRouting();
                app.UseAuthentication();
                app.UseAuthorization();
                // app.UseMise(); // ← SKIP THIS - would throw without AddMise services

                app.UseEndpoints(endpoints =>
                {
                    endpoints.MapControllers();
                });

                Log("[CopilotPatcher] Configure completed successfully (UseMise skipped)");
                return false; // Skip original Configure
            }
            catch (Exception ex)
            {
                Log($"[CopilotPatcher] ERROR in PatchedConfigure: {ex.Message}");
                Log($"[CopilotPatcher] Stack: {ex.StackTrace}");
                return true; // Let original run if we fail
            }
        }

        /// <summary>
        /// Prefix patch for AspNetCoreApiHost.ConfigureBuilder
        /// For CopilotApi: Implements Kestrel configuration and skips original (returns FALSE)
        /// For other APIs: Lets original HTTP.sys configuration run (returns TRUE)
        /// </summary>
        public static bool ConfigureBuilderPrefix(
            ref object __result,
            object builder,
            object hostOptions,
            Type startupType,
            string wildcardBaseAddress)
        {
            Log("[CopilotPatcher] ConfigureBuilderPrefix executing");

            try
            {
                // Only patch CopilotApi - let other APIs use HTTP.sys
                if (startupType == null || !startupType.FullName.Contains("CopilotApi"))
                {
                    Log($"[CopilotPatcher] Passing through to original for: {startupType?.FullName}");
                    return true; // Run original method
                }

                Log($"[CopilotPatcher] CopilotApi detected - startupType: {startupType.FullName}");
                Log($"[CopilotPatcher] Original wildcardBaseAddress: {wildcardBaseAddress}");
                Log("[CopilotPatcher] Implementing Kestrel configuration (skipping original)");

                // Parse the URL to extract port
                var uri = new Uri(wildcardBaseAddress.Replace("+", "localhost"));
                var port = uri.Port;
                var urlWithoutPath = $"{uri.Scheme}://+:{port}";

                Log($"[CopilotPatcher] Extracted port: {port}, urlWithoutPath: {urlWithoutPath}");

                // Get builder type for reflection
                var builderType = builder.GetType();

                // 1. ConfigureServices
                var configureServicesMethod = builderType.GetMethod("ConfigureServices",
                    new[] { typeof(Action<IServiceCollection>) });

                if (configureServicesMethod != null)
                {
                    Action<IServiceCollection> configAction = services =>
                    {
                        // Add AspNetCoreApiHostOptions singleton
                        if (hostOptions != null)
                        {
                            var hostOptionsType = hostOptions.GetType();
                            services.AddSingleton(hostOptionsType, hostOptions);

                            // Also register as base type if derived
                            var baseHostOptionsType = Type.GetType("Microsoft.Dynamics.Nav.Service.AspNetCore.AspNetCoreApiHostOptions, Microsoft.Dynamics.Nav.Service.AspNetCore");
                            if (baseHostOptionsType != null && hostOptionsType != baseHostOptionsType)
                            {
                                services.AddSingleton(baseHostOptionsType, hostOptions);
                            }
                        }

                        // Add NoOpNavDiagnosticStateFactory (CRITICAL: Use AspNetCore.INavDiagnosticStateFactory, not Runtime version)
                        var diagnosticFactoryType = Type.GetType("Microsoft.Dynamics.Nav.Service.AspNetCore.INavDiagnosticStateFactory, Microsoft.Dynamics.Nav.Service.AspNetCore");
                        Log($"[CopilotPatcher] diagnosticFactoryType: {(diagnosticFactoryType != null ? diagnosticFactoryType.FullName : "NULL")}");

                        var noOpFactoryType = Type.GetType("Microsoft.Dynamics.Nav.Service.AspNetCore.NoOpNavDiagnosticStateFactory, Microsoft.Dynamics.Nav.Service.AspNetCore");
                        Log($"[CopilotPatcher] noOpFactoryType: {(noOpFactoryType != null ? noOpFactoryType.FullName : "NULL")}");

                        if (diagnosticFactoryType != null && noOpFactoryType != null)
                        {
                            // CRITICAL: Instance is a FIELD not a PROPERTY - use GetField not GetProperty
                            var instanceField = noOpFactoryType.GetField("Instance", BindingFlags.Public | BindingFlags.Static);
                            Log($"[CopilotPatcher] instanceField: {(instanceField != null ? "FOUND" : "NULL")}");

                            if (instanceField != null)
                            {
                                var instance = instanceField.GetValue(null);
                                Log($"[CopilotPatcher] instance: {(instance != null ? instance.GetType().FullName : "NULL")}");

                                if (instance != null)
                                {
                                    services.AddSingleton(diagnosticFactoryType, instance);
                                    Log("[CopilotPatcher] INavDiagnosticStateFactory singleton registered");
                                }
                            }
                        }
                        else
                        {
                            Log("[CopilotPatcher] ERROR: Failed to resolve INavDiagnosticStateFactory types");
                        }

                        // Add ActionContextAccessor
                        var actionContextAccessorType = Type.GetType("Microsoft.AspNetCore.Mvc.Infrastructure.IActionContextAccessor, Microsoft.AspNetCore.Mvc.Core");
                        var actionContextAccessorImpl = Type.GetType("Microsoft.AspNetCore.Mvc.Infrastructure.ActionContextAccessor, Microsoft.AspNetCore.Mvc.Core");
                        if (actionContextAccessorType != null && actionContextAccessorImpl != null)
                        {
                            services.AddSingleton(actionContextAccessorType, Activator.CreateInstance(actionContextAccessorImpl));
                        }

                        Log("[CopilotPatcher] Services configured");
                    };

                    builder = configureServicesMethod.Invoke(builder, new object[] { configAction });
                    Log("[CopilotPatcher] ConfigureServices applied");
                }

                // 2. UseStartup (extension method in WebHostBuilderExtensions)
                var webHostBuilderExtensionsType = Type.GetType("Microsoft.AspNetCore.Hosting.WebHostBuilderExtensions, Microsoft.AspNetCore.Hosting");
                if (webHostBuilderExtensionsType != null)
                {
                    var useStartupMethod = webHostBuilderExtensionsType.GetMethods(BindingFlags.Public | BindingFlags.Static)
                        .FirstOrDefault(m => m.Name == "UseStartup" &&
                                           m.GetParameters().Length == 2 &&
                                           m.GetParameters()[1].ParameterType == typeof(Type));

                    if (useStartupMethod != null)
                    {
                        builder = useStartupMethod.Invoke(null, new object[] { builder, startupType });
                        Log("[CopilotPatcher] UseStartup applied");
                    }
                    else
                    {
                        Log("[CopilotPatcher] WARNING: UseStartup method not found");
                    }
                }
                else
                {
                    Log("[CopilotPatcher] WARNING: WebHostBuilderExtensions type not found");
                }

                // 3. UseKestrel (instead of UseHttpSys)
                var kestrelExtensionsType = Type.GetType("Microsoft.AspNetCore.Hosting.WebHostBuilderKestrelExtensions, Microsoft.AspNetCore.Server.Kestrel");
                if (kestrelExtensionsType != null)
                {
                    var useKestrelMethod = kestrelExtensionsType.GetMethods(BindingFlags.Public | BindingFlags.Static)
                        .FirstOrDefault(m => m.Name == "UseKestrel" && m.GetParameters().Length == 2);

                    if (useKestrelMethod != null)
                    {
                        // Configure Kestrel options
                        Action<object> kestrelConfig = options =>
                        {
                            try
                            {
                                var optionsType = options.GetType();

                                // Set AllowSynchronousIO = true
                                var allowSyncIOProp = optionsType.GetProperty("AllowSynchronousIO");
                                if (allowSyncIOProp != null)
                                {
                                    allowSyncIOProp.SetValue(options, true);
                                }

                                // Set Limits.MaxRequestBodySize to unlimited
                                var limitsProperty = optionsType.GetProperty("Limits");
                                if (limitsProperty != null)
                                {
                                    var limits = limitsProperty.GetValue(options);
                                    if (limits != null)
                                    {
                                        var maxRequestBodySizeProperty = limits.GetType().GetProperty("MaxRequestBodySize");
                                        if (maxRequestBodySizeProperty != null)
                                        {
                                            maxRequestBodySizeProperty.SetValue(limits, null); // null = unlimited
                                        }
                                    }
                                }

                                Log("[CopilotPatcher] Kestrel options configured");
                            }
                            catch (Exception ex)
                            {
                                Log($"[CopilotPatcher] WARNING: Kestrel configuration error: {ex.Message}");
                            }
                        };

                        builder = useKestrelMethod.Invoke(null, new object[] { builder, kestrelConfig });
                        Log("[CopilotPatcher] UseKestrel applied");
                    }
                }

                // 4. UseUrls WITHOUT path base (extension method in HostingAbstractionsWebHostBuilderExtensions)
                var hostingExtensionsType = Type.GetType("Microsoft.AspNetCore.Hosting.HostingAbstractionsWebHostBuilderExtensions, Microsoft.AspNetCore.Hosting.Abstractions");
                if (hostingExtensionsType != null)
                {
                    var useUrlsMethod = hostingExtensionsType.GetMethods(BindingFlags.Public | BindingFlags.Static)
                        .FirstOrDefault(m => m.Name == "UseUrls" &&
                                           m.GetParameters().Length == 2 &&
                                           m.GetParameters()[1].ParameterType == typeof(string[]));

                    if (useUrlsMethod != null)
                    {
                        builder = useUrlsMethod.Invoke(null, new object[] { builder, new[] { urlWithoutPath } });
                        Log($"[CopilotPatcher] UseUrls applied: {urlWithoutPath}");
                    }
                    else
                    {
                        Log("[CopilotPatcher] WARNING: UseUrls method not found");
                    }
                }
                else
                {
                    Log("[CopilotPatcher] WARNING: HostingAbstractionsWebHostBuilderExtensions type not found");
                }

                __result = builder;
                Log("[CopilotPatcher] ConfigureBuilderPrefix completed - Kestrel configuration applied");
                return false; // Skip original method
            }
            catch (Exception ex)
            {
                Log($"[CopilotPatcher] ERROR in ConfigureBuilderPrefix: {ex.Message}");
                Log($"[CopilotPatcher] Stack: {ex.StackTrace}");
                return true; // Let original run if we fail
            }
        }

        /// <summary>
        /// Configure Kestrel options to match HTTP.sys behavior
        /// </summary>
        public static void ConfigureKestrel(object options)
        {
            try
            {
                var optionsType = options.GetType();

                // Set AllowSynchronousIO = true (equivalent to HTTP.sys)
                var allowSyncIOProp = optionsType.GetProperty("AllowSynchronousIO");
                if (allowSyncIOProp != null)
                {
                    allowSyncIOProp.SetValue(options, true);
                    Log("[CopilotPatcher] Kestrel: AllowSynchronousIO = true");
                }

                // Set Limits.MaxRequestBodySize to unlimited (HTTP.sys default behavior)
                var limitsProperty = optionsType.GetProperty("Limits");
                if (limitsProperty != null)
                {
                    var limits = limitsProperty.GetValue(options);
                    if (limits != null)
                    {
                        var maxRequestBodySizeProperty = limits.GetType().GetProperty("MaxRequestBodySize");
                        if (maxRequestBodySizeProperty != null)
                        {
                            maxRequestBodySizeProperty.SetValue(limits, null); // null = unlimited
                            Log("[CopilotPatcher] Kestrel: MaxRequestBodySize = unlimited");
                        }
                    }
                }

                Log("[CopilotPatcher] Kestrel configuration completed");
            }
            catch (Exception ex)
            {
                Log($"[CopilotPatcher] WARNING: Kestrel configuration failed: {ex.Message}");
            }
        }

        private static void Log(string message)
        {
            try
            {
                var logPath = System.IO.Path.Combine(
                    AppContext.BaseDirectory,
                    "CopilotPatcher.log"
                );
                var entry = $"{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff} {message}\n";
                System.IO.File.AppendAllText(logPath, entry);
            }
            catch
            {
                // Ignore logging errors
            }
        }
    }
}
