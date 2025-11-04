/**
 * Test CopilotApi with Azure AD Authentication
 */

import fetch from 'node-fetch';

const TENANT_ID = '29c079c8-7296-4cb9-816e-032a9eefc645';
const CLIENT_ID = 'a9558058-3305-45bd-a506-d72a64da47c1';
const CLIENT_SECRET = 'Kse8Q~sWXoMBUE-P_~VFcyz8q3ZbEnXujdbZRahW';
const BC_APP_ID = '53394492-c025-4ad3-b92f-bf37a4049487';

async function getAccessToken(): Promise<string> {
  console.log('🔑 Getting OAuth token from Azure AD...\n');

  const tokenUrl = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`;

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    scope: `api://${BC_APP_ID}/.default`,
    grant_type: 'client_credentials',
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get token: ${response.status} ${error}`);
  }

  const data = await response.json() as { access_token: string };
  console.log(`✓ Got access token (length: ${data.access_token.length})\n`);
  return data.access_token;
}

async function testCopilotApi() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Testing CopilotApi with Azure AD Authentication');
  console.log('═══════════════════════════════════════════════════════════\n');

  try {
    // Step 1: Get OAuth token
    const token = await getAccessToken();

    // Step 2: Test environment information (PlatformSkillsController)
    console.log('🌍 Testing environment information endpoint...');
    const envUrl = 'http://Cronus27:7100/copilot/v2.0/skills/environmentInformation?tenantId=default';
    const envResponse = await fetch(envUrl, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });
    console.log(`  Status: ${envResponse.status} ${envResponse.statusText}`);
    if (envResponse.ok) {
      const envData = await envResponse.json();
      console.log(`  Response:`, JSON.stringify(envData, null, 2));
    } else {
      const errorText = await envResponse.text();
      console.log(`  Error: ${errorText.substring(0, 500)}\n`);
    }

    // Step 3: Test page metadata for Page 21 (Customer Card)
    console.log('📄 Testing page metadata endpoint for Page 21...');
    const pageUrl = 'http://Cronus27:7100/copilot/v2.0/skills/pageMetadata/21?tenantId=default';
    const pageResponse = await fetch(pageUrl, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });
    console.log(`  Status: ${pageResponse.status} ${pageResponse.statusText}`);
    if (pageResponse.ok) {
      const pageData = await pageResponse.json();
      console.log(`  Page Name: ${pageData.name}`);
      console.log(`  Page ID: ${pageData.id}`);
      console.log(`  Page Type: ${pageData.pageType}`);
      console.log(`  Fields: ${pageData.fields?.length || 0}`);
      console.log(`  Full Response:`, JSON.stringify(pageData, null, 2).substring(0, 1000));
    } else {
      const errorText = await pageResponse.text();
      console.log(`  Error: ${errorText.substring(0, 500)}\n`);
    }

    // Step 4: Test page metadata for Page 22 (Customer List)
    console.log('\n📄 Testing page metadata endpoint for Page 22...');
    const page22Url = 'http://Cronus27:7100/copilot/v2.0/skills/pageMetadata/22?tenantId=default';
    const page22Response = await fetch(page22Url, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });
    console.log(`  Status: ${page22Response.status} ${page22Response.statusText}`);
    if (page22Response.ok) {
      const page22Data = await page22Response.json();
      console.log(`  Page Name: ${page22Data.name}`);
      console.log(`  Page ID: ${page22Data.id}`);
      console.log(`  Page Type: ${page22Data.pageType}`);
    } else {
      const errorText = await page22Response.text();
      console.log(`  Error: ${errorText.substring(0, 500)}\n`);
    }

  } catch (error) {
    console.error('❌ Error:', error);
  }

  console.log('═══════════════════════════════════════════════════════════');
}

testCopilotApi().catch(console.error);
