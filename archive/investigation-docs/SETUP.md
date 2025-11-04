# Quick Setup Guide

## Step-by-Step Setup

### 1. Install Dependencies

```bash
cd bc-poc
npm install
```

This installs:
- `ws` - WebSocket client
- `@azure/msal-node` - Azure AD authentication (optional)
- `uuid` - Request ID generation
- `dotenv` - **Loads your `.env` file**

### 2. Create `.env` File

**Windows (PowerShell)**:
```powershell
Copy-Item .env.example .env
notepad .env
```

**Windows (Command Prompt)**:
```cmd
copy .env.example .env
notepad .env
```

**Linux/Mac**:
```bash
cp .env.example .env
nano .env
```

### 3. Edit `.env` with Your Credentials

Choose **ONE** authentication method:

#### Option A: NavUserPassword (Recommended) ⭐

```env
# Required
BC_BASE_URL=https://your-bc-server.com
BC_USERNAME=your-username
BC_PASSWORD=your-password

# Optional
BC_TENANT_ID=
BC_COMPANY_NAME=
ROLE_CENTER_PAGE_ID=9022
```

**Examples**:

Single-tenant BC:
```env
BC_BASE_URL=https://bc.mycompany.com
BC_USERNAME=john.doe
BC_PASSWORD=MySecurePassword123
```

Multi-tenant BC:
```env
BC_BASE_URL=https://bc.mycompany.com
BC_USERNAME=john.doe
BC_PASSWORD=MySecurePassword123
BC_TENANT_ID=CRONUS
```

#### Option B: OAuth/Azure AD

```env
# Required
BC_BASE_URL=https://businesscentral.dynamics.com
BC_TENANT_ID=12345678-1234-1234-1234-123456789abc
BC_ENVIRONMENT=production
AZURE_CLIENT_ID=abcdef12-3456-7890-abcd-ef1234567890
AZURE_TENANT_ID=12345678-1234-1234-1234-123456789abc
AZURE_AUTHORITY=https://login.microsoftonline.com/12345678-1234-1234-1234-123456789abc

# Optional
BC_COMPANY_NAME=
ROLE_CENTER_PAGE_ID=9022
```

### 4. Save and Run

```bash
npm run dev
```

## How the `.env` File Works

The PoC uses the `dotenv` package to automatically load your `.env` file.

**In the code** (`src/index.ts:2`):
```typescript
import 'dotenv/config';  // This loads your .env file
```

This line reads `.env` and makes the values available as `process.env.BC_USERNAME`, etc.

## Verifying Your Setup

### Test 1: Check Environment Variables

Create a test file to verify `.env` is loading:

**`test-env.js`**:
```javascript
import 'dotenv/config';

console.log('BC_BASE_URL:', process.env.BC_BASE_URL);
console.log('BC_USERNAME:', process.env.BC_USERNAME);
console.log('BC_PASSWORD:', process.env.BC_PASSWORD ? '***' : '(not set)');
```

Run it:
```bash
node test-env.js
```

**Expected Output**:
```
BC_BASE_URL: https://bc.mycompany.com
BC_USERNAME: john.doe
BC_PASSWORD: ***
```

**If you see `undefined`**:
- ✗ Your `.env` file doesn't exist
- ✗ Your `.env` file is in the wrong directory
- ✗ Variable names have typos

### Test 2: Run the PoC

```bash
npm run dev
```

**Success** ✅:
```
╔═══════════════════════════════════════════════════════════╗
║  Business Central WebSocket PoC                          ║
╚═══════════════════════════════════════════════════════════╝

Step 1: Authenticating...
────────────────────────────────────────────────────────────
Using NavUserPassword authentication
✓ Credentials validated
  User: john.doe
```

**Failure** ❌:
```
❌ Configuration not set!

Please set environment variables for one of:
...
```

This means your `.env` file wasn't loaded or variables are missing.

## Common Issues

### Issue 1: "Configuration not set"

**Cause**: `.env` file doesn't exist or has wrong values

**Fix**:
```bash
# Check if .env exists
ls -la .env         # Linux/Mac
dir .env            # Windows

# If missing, create it:
cp .env.example .env

# Edit it:
nano .env           # Linux/Mac
notepad .env        # Windows
```

### Issue 2: `.env` file exists but variables are `undefined`

**Cause**: File is in wrong location or not named exactly `.env`

**Fix**:
```bash
# Verify file location (should be in bc-poc root)
pwd                 # Should show: /path/to/bc-poc
ls -la .env         # Should exist here

# Check file name (must be exactly .env, not .env.txt)
# Windows may hide extensions - check carefully
```

### Issue 3: "dotenv is not defined" or similar error

**Cause**: Dependencies not installed

**Fix**:
```bash
npm install
```

### Issue 4: Values have extra quotes or spaces

**Wrong** ❌:
```env
BC_USERNAME="john.doe"     # Has quotes!
BC_PASSWORD= MyPassword    # Has space before value!
```

**Correct** ✅:
```env
BC_USERNAME=john.doe
BC_PASSWORD=MyPassword
```

The `dotenv` package automatically trims values, but avoid quotes unless needed.

## `.env` File Location

The `.env` file must be in the **project root directory**:

```
bc-poc/
├── .env              ← HERE!
├── .env.example
├── package.json
├── tsconfig.json
├── README.md
└── src/
    ├── index.ts
    ├── BCClient.ts
    └── ...
```

**Not here** ❌:
- `bc-poc/src/.env`
- `bc-poc/dist/.env`
- `C:\bc4ubuntu\Decompiled\.env`

## Environment Variable Priority

If you set variables in **multiple places**, Node.js uses this priority:

1. **Actual environment variables** (highest)
   ```bash
   BC_USERNAME=override npm run dev
   ```

2. **`.env` file** (loaded by dotenv)

3. **Default values in code** (lowest)

Most users should just use `.env` file (option 2).

## Security Notes

⚠️ **Never commit `.env` to git!**

The `.gitignore` file already includes:
```
.env
.env.local
.env.*.local
```

This prevents accidentally committing your passwords.

**Safe to commit**:
- ✅ `.env.example` (template with fake values)

**Never commit**:
- ❌ `.env` (has real passwords)
- ❌ `.env.local`
- ❌ `.env.production`

## Alternative: Set Environment Variables Directly

If you prefer **not** to use `.env` file:

**Windows (PowerShell)**:
```powershell
$env:BC_USERNAME="john.doe"
$env:BC_PASSWORD="MyPassword"
$env:BC_BASE_URL="https://bc.mycompany.com"
npm run dev
```

**Linux/Mac (bash)**:
```bash
export BC_USERNAME=john.doe
export BC_PASSWORD=MyPassword
export BC_BASE_URL=https://bc.mycompany.com
npm run dev
```

**One-liner**:
```bash
BC_USERNAME=john.doe BC_PASSWORD=MyPassword BC_BASE_URL=https://bc.mycompany.com npm run dev
```

## Next Steps

Once your `.env` file is working:

1. **Test connection**: `npm run dev`
2. **Check output**: You should see role center metadata
3. **Explore code**: Start with `src/index.ts`
4. **Read docs**: See `AUTHENTICATION.md` for auth details

## Getting Help

If still stuck:

1. Run `node test-env.js` (create file from above)
2. Check exact error message
3. Verify BC server has `ClientServicesCredentialType=NavUserPassword`
4. Check BC username/password work in web client first
5. Try with simple single-tenant setup first

## Summary

✅ **The `.env` file is the RIGHT place!**

Just make sure:
1. File is named exactly `.env` (not `.env.txt`)
2. File is in project root (`bc-poc/` directory)
3. You ran `npm install` (installs `dotenv` package)
4. Values don't have extra quotes or spaces
5. File uses Unix line endings (LF, not CRLF) - usually not an issue but worth checking if on Windows
