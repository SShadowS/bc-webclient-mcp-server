using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Claims;
using System.Text.Encodings.Web;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace CopilotPatcher
{
    /// <summary>
    /// API key authentication handler for on-premises CopilotApi.
    /// CRITICAL FIXES:
    /// - Uses "S2SAuthentication" scheme (not "OnPremApiKey")
    /// - Includes both "roles" and ClaimTypes.Role claims
    /// - Sets roleType = "roles" on ClaimsIdentity
    /// - Reads API key from environment variable (not hard-coded)
    /// </summary>
    public class OnPremApiKeyAuthHandler : AuthenticationHandler<AuthenticationSchemeOptions>
    {
        private const string ApiKeyHeaderName = "X-Copilot-ApiKey";

        // SECURITY: Read from environment variable, support multiple keys
        private static readonly string[] ValidApiKeys = GetValidApiKeys();

        public OnPremApiKeyAuthHandler(
            IOptionsMonitor<AuthenticationSchemeOptions> options,
            ILoggerFactory logger,
            UrlEncoder encoder,
            ISystemClock clock)
            : base(options, logger, encoder, clock)
        {
        }

        protected override Task<AuthenticateResult> HandleAuthenticateAsync()
        {
            try
            {
                // Check API key header
                if (!Request.Headers.TryGetValue(ApiKeyHeaderName, out var apiKeyValues))
                {
                    return Task.FromResult(
                        AuthenticateResult.Fail($"Missing {ApiKeyHeaderName} header")
                    );
                }

                var providedApiKey = apiKeyValues.FirstOrDefault();
                if (string.IsNullOrWhiteSpace(providedApiKey))
                {
                    return Task.FromResult(
                        AuthenticateResult.Fail($"{ApiKeyHeaderName} header is empty")
                    );
                }

                // Validate against allowed keys
                if (!ValidApiKeys.Contains(providedApiKey))
                {
                    Logger.LogWarning($"Invalid API key attempt from {Request.HttpContext.Connection.RemoteIpAddress}");
                    return Task.FromResult(
                        AuthenticateResult.Fail("Invalid API key")
                    );
                }

                // Create claims
                // CRITICAL: Include BOTH "roles" and ClaimTypes.Role claims
                // CRITICAL: Set roleType = "roles" in ClaimsIdentity constructor
                var claims = new List<Claim>
                {
                    new Claim(ClaimTypes.Name, "OnPremCopilotClient"),
                    new Claim(ClaimTypes.NameIdentifier, "onprem-client"),
                    new Claim("roles", "CopilotService"),          // For [AllowedRoles]
                    new Claim(ClaimTypes.Role, "CopilotService"),  // Standard role claim
                    new Claim("appid", "onprem-app-id")            // Original had appId
                };

                // CRITICAL: Set roleType = "roles" (4th parameter)
                var identity = new ClaimsIdentity(
                    claims,
                    Scheme.Name,
                    ClaimTypes.Name,
                    "roles"  // ← roleType parameter - CRITICAL for [AllowedRoles] to work
                );

                var principal = new ClaimsPrincipal(identity);
                var ticket = new AuthenticationTicket(principal, Scheme.Name);

                Logger.LogInformation($"Successful authentication from {Request.HttpContext.Connection.RemoteIpAddress}");
                return Task.FromResult(AuthenticateResult.Success(ticket));
            }
            catch (Exception ex)
            {
                Logger.LogError(ex, "Error in OnPremApiKeyAuthHandler");
                return Task.FromResult(
                    AuthenticateResult.Fail($"Authentication error: {ex.Message}")
                );
            }
        }

        private static string[] GetValidApiKeys()
        {
            // Read from environment variable, support multiple keys separated by semicolon
            var envKeys = Environment.GetEnvironmentVariable("BC_COPILOT_API_KEYS");

            if (!string.IsNullOrWhiteSpace(envKeys))
            {
                var keys = envKeys.Split(';', StringSplitOptions.RemoveEmptyEntries)
                                  .Select(k => k.Trim())
                                  .Where(k => !string.IsNullOrWhiteSpace(k))
                                  .ToArray();

                if (keys.Length > 0)
                    return keys;
            }

            // Fallback default (CHANGE THIS!)
            return new[] { "default-copilot-key-CHANGE-ME" };
        }
    }
}
