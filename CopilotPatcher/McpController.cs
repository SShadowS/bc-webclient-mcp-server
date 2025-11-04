using System;
using System.Collections.Generic;
using System.Linq;
using System.Linq.Expressions;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace CopilotPatcher
{
    /// <summary>
    /// MCP (Model Context Protocol) Controller for Business Central
    ///
    /// Provides simplified, session-independent access to BC page metadata and record data.
    /// Uses API key authentication and creates temporary sessions internally.
    ///
    /// Note: Uses reflection to access internal BC types at runtime.
    /// </summary>
    [ApiController]
    [ApiVersion("2.0")]
    [Route("v{version:apiVersion}/mcp")]
    [Authorize]
    public class McpController : Controller
    {
        private static Type? _navEnvironmentType;
        private static Type? _navTenantType;
        private static Type? _navSessionType;
        private static Type? _navCancellationTokenType;
        private static Type? _tenantSessionHandlerType;
        private static Type? _copilotMetadataSearchType;
        private static Type? _copilotDataProviderType;
        private static Type? _copilotDataSearchProviderType;
        private static Type? _pageMetadataResponseType;
        private static Type? _objectTypeType;
        private static Type? _alCopilotCapabilityType;
        private static Type? _languageSettingType;

        private static readonly object _initLock = new object();
        private static bool _typesInitialized = false;

        private static void EnsureTypesInitialized()
        {
            if (_typesInitialized) return;

            lock (_initLock)
            {
                if (_typesInitialized) return;

                var assemblies = AppDomain.CurrentDomain.GetAssemblies();

                // Search ALL assemblies for NavEnvironment, NavTenant, NavSession
                // They might be in Nav.Types, Nav.Server, or Nav.Service
                foreach (var assembly in assemblies)
                {
                    var assemblyName = assembly.GetName().Name;
                    if (!assemblyName?.Contains("Dynamics") == true) continue;

                    if (_navEnvironmentType == null)
                        _navEnvironmentType = assembly.GetType("Microsoft.Dynamics.Nav.Runtime.NavEnvironment");

                    if (_navTenantType == null)
                        _navTenantType = assembly.GetType("Microsoft.Dynamics.Nav.Runtime.NavTenant");

                    if (_navSessionType == null)
                        _navSessionType = assembly.GetType("Microsoft.Dynamics.Nav.Runtime.NavSession");

                    if (_navCancellationTokenType == null)
                        _navCancellationTokenType = assembly.GetType("Microsoft.Dynamics.Nav.Types.NavCancellationToken");

                    if (_objectTypeType == null)
                        _objectTypeType = assembly.GetType("Microsoft.Dynamics.Nav.Types.ObjectType");

                    if (_languageSettingType == null)
                        _languageSettingType = assembly.GetType("Microsoft.Dynamics.Nav.Types.LanguageSetting");

                    if (_tenantSessionHandlerType == null)
                        _tenantSessionHandlerType = assembly.GetType("Microsoft.Dynamics.Nav.Runtime.ITenantSessionHandler");
                }

                // Find CopilotApi types in Microsoft.Dynamics.Nav.Service.CopilotApi
                var copilotApiAssembly = assemblies.FirstOrDefault(a => a.GetName().Name == "Microsoft.Dynamics.Nav.Service.CopilotApi");
                if (copilotApiAssembly != null)
                {
                    _copilotMetadataSearchType = copilotApiAssembly.GetType("Microsoft.Dynamics.Nav.Service.CopilotApi.Search.Metadata.CopilotMetadataSearch");
                    _copilotDataProviderType = copilotApiAssembly.GetType("Microsoft.Dynamics.Nav.Service.CopilotApi.Search.CompanyData.CopilotDataProvider");
                    _copilotDataSearchProviderType = copilotApiAssembly.GetType("Microsoft.Dynamics.Nav.Service.CopilotApi.Search.CompanyData.CopilotDataSearchProvider");
                    _pageMetadataResponseType = copilotApiAssembly.GetType("Microsoft.Dynamics.Nav.Service.CopilotApi.Models.PageMetadataResponse");
                    _alCopilotCapabilityType = copilotApiAssembly.GetType("Microsoft.Dynamics.Nav.Service.CopilotApi.AL.ALCopilotCapability");
                }

                _typesInitialized = true;
            }
        }

        private object GetNavEnvironmentInstance()
        {
            EnsureTypesInitialized();

            if (_navEnvironmentType == null)
                throw new InvalidOperationException("NavEnvironment type not found");

            var instanceProp = _navEnvironmentType.GetProperty("Instance", BindingFlags.Public | BindingFlags.Static);
            if (instanceProp == null)
                throw new InvalidOperationException("NavEnvironment.Instance property not found");

            var instance = instanceProp.GetValue(null);
            if (instance == null)
                throw new InvalidOperationException("NavEnvironment.Instance is null - BC may not be fully initialized");

            return instance;
        }

        private bool TryGetTenant(string tenantId, out object tenant)
        {
            var navEnv = GetNavEnvironmentInstance();
            var tenantsProperty = _navEnvironmentType?.GetProperty("Tenants");
            var tenants = tenantsProperty?.GetValue(navEnv);

            var tryGetMethod = tenants?.GetType().GetMethod("TryGetTenantById");
            // TryGetTenantById(string tenantId, out NavTenant tenant, bool includeSystemTenant, bool includeFailed, bool includeDisposed)
            // Try with includeSystemTenant=true to allow system tenants
            var parameters = new object?[] { tenantId, null, true, false, false };
            var result = (bool)(tryGetMethod?.Invoke(tenants, parameters) ?? false);
            tenant = parameters[1]!;

            return result;
        }

        /// <summary>
        /// Creates a properly-typed delegate wrapper using Expression Trees.
        /// Required because RunTenantActionInSystemSessionAsync expects Func&lt;NavTenant, NavSession, ValueTask&gt;
        /// but we can only work with Func&lt;object, object, ValueTask&gt; due to internal types.
        /// </summary>
        private static Delegate CreateWrapperDelegate(
            Func<object, object, ValueTask> action,
            Type param1Type,
            Type param2Type)
        {
            // Define parameters for the new delegate: (NavTenant t, NavSession s)
            var tenantParam = Expression.Parameter(param1Type, "t");
            var sessionParam = Expression.Parameter(param2Type, "s");

            // Create constant to hold reference to original action
            var actionConstant = Expression.Constant(action);

            // Create body: action.Invoke((object)t, (object)s)
            var invokeExpression = Expression.Invoke(
                actionConstant,
                Expression.Convert(tenantParam, typeof(object)),
                Expression.Convert(sessionParam, typeof(object))
            );

            // Define the exact delegate type: Func<NavTenant, NavSession, ValueTask>
            Type delegateType = typeof(Func<,,>).MakeGenericType(
                param1Type,
                param2Type,
                typeof(ValueTask)
            );

            // Build and compile the lambda expression
            var wrapperLambda = Expression.Lambda(delegateType, invokeExpression, tenantParam, sessionParam);
            return wrapperLambda.Compile();
        }

        /// <summary>
        /// Search for pages by name/description
        /// </summary>
        /// <remarks>
        /// GET /mcp/pages/search?tenantId=default&query=Customer&pageTypes=List&pageTypes=Card&top=10
        /// </remarks>
        [HttpGet("pages/search")]
        public async Task<IActionResult> SearchPages(
            [FromQuery] string tenantId,
            [FromQuery] string query,
            [FromQuery] string[] pageTypes,
            [FromQuery] int top = 10)
        {
            if (string.IsNullOrEmpty(tenantId) || string.IsNullOrEmpty(query))
            {
                return BadRequest(new { error = "tenantId and query are required" });
            }

            try
            {
                EnsureTypesInitialized();

                if (!TryGetTenant(tenantId, out var tenant))
                {
                    return NotFound(new { error = $"Tenant '{tenantId}' not found" });
                }

                object? results = null;

                // Call tenant.RunTenantActionInSystemSessionAsync
                var runActionMethod = _tenantSessionHandlerType?.GetMethod("RunTenantActionInSystemSessionAsync");
                if (runActionMethod == null)
                {
                    return StatusCode(500, new { error = "RunTenantActionInSystemSessionAsync method not found" });
                }

                // Define lambda with object parameters
                Func<object, object, ValueTask> action = (t, session) =>
                {
                    // NavCancellationToken is a value type (struct) - use default value
                    var cancellationToken = Activator.CreateInstance(_navCancellationTokenType!);

                    // Get ObjectType.Page enum value
                    var pageValue = Enum.ToObject(_objectTypeType!, 0); // Page = 0

                    // Call CopilotMetadataSearch.SearchObjectsAccessibleToSessionAsync
                    var searchMethod = _copilotMetadataSearchType?.GetMethod(
                        "SearchObjectsAccessibleToSessionAsync",
                        new Type[] {
                            _navSessionType!,
                            _objectTypeType!,
                            typeof(string[]),
                            typeof(string[]),
                            typeof(int),
                            _alCopilotCapabilityType!,
                            _navCancellationTokenType!
                        }
                    );

                    if (searchMethod == null)
                    {
                        throw new InvalidOperationException("SearchObjectsAccessibleToSessionAsync method not found");
                    }

                    // Invoke - returns Task<IList<IMetadataSearchResponse>>
                    var searchTask = searchMethod.Invoke(null, new object?[] {
                        session,
                        pageValue,
                        pageTypes,
                        new[] { query },
                        top,
                        null, // capability
                        cancellationToken
                    })!;

                    // Wait for the task synchronously using reflection to avoid type issues
                    var waitMethod = searchTask.GetType().GetMethod("Wait", Type.EmptyTypes);
                    waitMethod!.Invoke(searchTask, null);

                    // Get result using reflection
                    var resultProperty = searchTask.GetType().GetProperty("Result");
                    results = resultProperty!.GetValue(searchTask);

                    return ValueTask.CompletedTask;
                };

                // Create properly-typed wrapper delegate using Expression Trees
                var wrapperDelegate = CreateWrapperDelegate(action, _navTenantType!, _navSessionType!);

                var outerCancellationToken = Activator.CreateInstance(_navCancellationTokenType!);

                // Invoke RunTenantActionInSystemSessionAsync with properly-typed delegate
                var valueTaskResult = (ValueTask)runActionMethod.Invoke(tenant, new object?[] {
                    wrapperDelegate,  // Use properly-typed wrapper delegate
                    true,  // throwExceptions
                    false, // useCurrentCulture
                    false, // allowAppsDisabledMode
                    null,  // language (LanguageSetting - null for default)
                    outerCancellationToken
                })!;

                await valueTaskResult;

                return Ok(results);
            }
            catch (Exception ex)
            {
                return BadRequest(new { error = ex.Message, type = ex.GetType().Name, stackTrace = ex.ToString() });
            }
        }

        /// <summary>
        /// Get page metadata by ID
        /// </summary>
        /// <remarks>
        /// GET /mcp/pages/22?tenantId=default
        /// </remarks>
        [HttpGet("pages/{pageId}")]
        public async Task<IActionResult> GetPageMetadata(
            int pageId,
            [FromQuery] string tenantId)
        {
            if (string.IsNullOrEmpty(tenantId) || pageId <= 0)
            {
                return BadRequest(new { error = "tenantId and valid pageId are required" });
            }

            try
            {
                EnsureTypesInitialized();

                if (!TryGetTenant(tenantId, out var tenant))
                {
                    return NotFound(new { error = $"Tenant '{tenantId}' not found" });
                }

                object? metadata = null;

                var runActionMethod = _tenantSessionHandlerType?.GetMethod("RunTenantActionInSystemSessionAsync");
                var actionDelegateType = typeof(Func<,,>).MakeGenericType(_navTenantType!, _navSessionType!, typeof(Task));

                Func<object, object, Task> action = async (t, session) =>
                {
                    // Call PageMetadataResponse.Create
                    var createMethod = _pageMetadataResponseType?.GetMethod("Create", BindingFlags.Public | BindingFlags.Static);
                    metadata = createMethod?.Invoke(null, new object[] { session, pageId });
                    await Task.CompletedTask;
                };

                var actionDelegate = Delegate.CreateDelegate(actionDelegateType, action.Target, action.Method);

                var taskResult = (Task)runActionMethod!.Invoke(tenant, new object?[] {
                    actionDelegate,
                    true,
                    null
                })!;

                await taskResult;

                return Ok(metadata);
            }
            catch (TargetInvocationException ex) when (ex.InnerException?.GetType().Name == "NavPermissionException")
            {
                return StatusCode(403, new { error = ex.InnerException.Message, type = "PermissionDenied" });
            }
            catch (Exception ex)
            {
                return BadRequest(new { error = ex.Message, type = ex.GetType().Name });
            }
        }

        /// <summary>
        /// Health check endpoint
        /// </summary>
        [HttpGet("health")]
        [AllowAnonymous]
        public IActionResult Health()
        {
            return Ok(new
            {
                status = "healthy",
                service = "Business Central MCP API",
                version = "1.0.0",
                timestamp = DateTime.UtcNow
            });
        }

        /// <summary>
        /// Debug endpoint to inspect CopilotMetadataSearch methods
        /// </summary>
        [HttpGet("debug/metadata-search")]
        public IActionResult DebugMetadataSearch()
        {
            try
            {
                EnsureTypesInitialized();

                if (_copilotMetadataSearchType == null)
                {
                    return Ok(new { error = "CopilotMetadataSearch type not found" });
                }

                var methods = _copilotMetadataSearchType.GetMethods(BindingFlags.Public | BindingFlags.Static)
                    .Where(m => m.Name.Contains("Search"))
                    .Select(m => new
                    {
                        Name = m.Name,
                        ReturnType = m.ReturnType.FullName,
                        Parameters = m.GetParameters().Select(p => new
                        {
                            Name = p.Name,
                            Type = p.ParameterType.FullName,
                            IsOut = p.IsOut,
                            IsRef = p.ParameterType.IsByRef
                        }).ToList()
                    })
                    .ToList();

                return Ok(new
                {
                    typeName = _copilotMetadataSearchType.FullName,
                    assembly = _copilotMetadataSearchType.Assembly.GetName().Name,
                    methods
                });
            }
            catch (Exception ex)
            {
                return BadRequest(new { error = ex.Message, stack = ex.StackTrace });
            }
        }

        /// <summary>
        /// Debug endpoint to inspect Tenants collection methods
        /// </summary>
        [HttpGet("debug/tenants")]
        public IActionResult DebugTenants()
        {
            try
            {
                EnsureTypesInitialized();
                var navEnv = GetNavEnvironmentInstance();
                var tenantsProperty = _navEnvironmentType?.GetProperty("Tenants");
                var tenants = tenantsProperty?.GetValue(navEnv);

                if (tenants == null)
                {
                    return Ok(new { error = "Tenants property returned null" });
                }

                var tenantsType = tenants.GetType();
                var methods = tenantsType.GetMethods(BindingFlags.Public | BindingFlags.Instance)
                    .Where(m => m.Name.Contains("Tenant") || m.Name.Contains("Get"))
                    .Select(m => new
                    {
                        Name = m.Name,
                        ReturnType = m.ReturnType.FullName,
                        Parameters = m.GetParameters().Select(p => new
                        {
                            Name = p.Name,
                            Type = p.ParameterType.FullName,
                            IsOut = p.IsOut,
                            IsRef = p.ParameterType.IsByRef
                        }).ToList()
                    })
                    .ToList();

                return Ok(new
                {
                    tenantsTypeName = tenantsType.FullName,
                    tenantsAssembly = tenantsType.Assembly.GetName().Name,
                    methods
                });
            }
            catch (Exception ex)
            {
                return BadRequest(new { error = ex.Message, stack = ex.StackTrace });
            }
        }

        /// <summary>
        /// Debug endpoint to inspect NavCancellationToken constructors
        /// </summary>
        [HttpGet("debug/nav-cancellation-token")]
        public IActionResult DebugNavCancellationToken()
        {
            try
            {
                EnsureTypesInitialized();

                if (_navCancellationTokenType == null)
                {
                    return Ok(new { error = "NavCancellationToken type not found" });
                }

                var constructors = _navCancellationTokenType.GetConstructors(BindingFlags.Public | BindingFlags.Instance)
                    .Select(c => new
                    {
                        Parameters = c.GetParameters().Select(p => new
                        {
                            Name = p.Name,
                            Type = p.ParameterType.FullName,
                            IsOptional = p.IsOptional,
                            DefaultValue = p.HasDefaultValue ? p.DefaultValue : null
                        }).ToList()
                    })
                    .ToList();

                var staticProperties = _navCancellationTokenType.GetProperties(BindingFlags.Public | BindingFlags.Static)
                    .Select(p => new { Name = p.Name, Type = p.PropertyType.FullName })
                    .ToList();

                var staticMethods = _navCancellationTokenType.GetMethods(BindingFlags.Public | BindingFlags.Static)
                    .Where(m => !m.Name.StartsWith("get_") && !m.Name.StartsWith("set_") && !m.Name.StartsWith("op_"))
                    .Select(m => new { Name = m.Name, ReturnType = m.ReturnType.FullName })
                    .ToList();

                return Ok(new
                {
                    typeName = _navCancellationTokenType.FullName,
                    assembly = _navCancellationTokenType.Assembly.GetName().Name,
                    isValueType = _navCancellationTokenType.IsValueType,
                    constructors,
                    staticProperties,
                    staticMethods
                });
            }
            catch (Exception ex)
            {
                return BadRequest(new { error = ex.Message, stack = ex.StackTrace });
            }
        }

        /// <summary>
        /// Debug endpoint to inspect ITenantSessionHandler methods
        /// </summary>
        [HttpGet("debug/tenant-session-handler")]
        public IActionResult DebugTenantSessionHandler()
        {
            try
            {
                EnsureTypesInitialized();

                if (_tenantSessionHandlerType == null)
                {
                    return Ok(new { error = "ITenantSessionHandler type not found" });
                }

                var methods = _tenantSessionHandlerType.GetMethods(BindingFlags.Public | BindingFlags.Instance)
                    .Where(m => m.Name.Contains("RunTenantAction"))
                    .Select(m => new
                    {
                        Name = m.Name,
                        ReturnType = m.ReturnType.FullName,
                        Parameters = m.GetParameters().Select(p => new
                        {
                            Name = p.Name,
                            Type = p.ParameterType.FullName,
                            IsOut = p.IsOut,
                            IsRef = p.ParameterType.IsByRef
                        }).ToList()
                    })
                    .ToList();

                return Ok(new
                {
                    typeName = _tenantSessionHandlerType.FullName,
                    assembly = _tenantSessionHandlerType.Assembly.GetName().Name,
                    methods
                });
            }
            catch (Exception ex)
            {
                return BadRequest(new { error = ex.Message, stack = ex.StackTrace });
            }
        }

        /// <summary>
        /// Debug endpoint to list loaded assemblies
        /// </summary>
        [HttpGet("debug/assemblies")]
        public IActionResult DebugAssemblies()
        {
            var assemblies = AppDomain.CurrentDomain.GetAssemblies();
            var bcAssemblies = assemblies
                .Where(a => a.GetName().Name?.Contains("Dynamics") == true || a.GetName().Name?.Contains("Nav") == true)
                .Select(a => new
                {
                    Name = a.GetName().Name,
                    Version = a.GetName().Version?.ToString(),
                    Location = a.IsDynamic ? "(dynamic)" : a.Location
                })
                .ToList();

            // Find Nav.Types assembly and list relevant types
            var navTypesAssembly = assemblies.FirstOrDefault(a => a.GetName().Name == "Microsoft.Dynamics.Nav.Types");
            var navTypesTypes = navTypesAssembly?.GetTypes()
                .Where(t => t.FullName?.Contains("Runtime") == true || t.Name?.Contains("Environment") == true || t.Name?.Contains("Tenant") == true || t.Name?.Contains("Session") == true)
                .Select(t => t.FullName)
                .ToList() ?? new List<string>();

            EnsureTypesInitialized();

            return Ok(new
            {
                totalAssemblies = assemblies.Length,
                bcAssemblies,
                navTypesTypes = navTypesTypes.Take(20).ToList(),
                typesFound = new
                {
                    navEnvironmentType = _navEnvironmentType?.FullName ?? "(not found)",
                    navEnvironmentAssembly = _navEnvironmentType?.Assembly.GetName().Name ?? "(not found)",
                    navTenantType = _navTenantType?.FullName ?? "(not found)",
                    navTenantAssembly = _navTenantType?.Assembly.GetName().Name ?? "(not found)",
                    navSessionType = _navSessionType?.FullName ?? "(not found)",
                    navSessionAssembly = _navSessionType?.Assembly.GetName().Name ?? "(not found)",
                    copilotMetadataSearchType = _copilotMetadataSearchType?.FullName ?? "(not found)",
                    copilotMetadataSearchAssembly = _copilotMetadataSearchType?.Assembly.GetName().Name ?? "(not found)"
                }
            });
        }
    }
}
