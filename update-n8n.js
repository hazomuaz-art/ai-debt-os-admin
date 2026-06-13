const email = 'hazomuaz@gmail.com';
const password = 'Mahmmed12@';
const baseUrl = 'http://72.62.30.109:32768/rest';

async function run() {
  // 1. Login
  console.log('Logging in...');
  const loginRes = await fetch(baseUrl + '/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emailOrLdapLoginId: email, password })
  });
  
  if (!loginRes.ok) {
    console.error('Login failed:', await loginRes.text());
    return;
  }
  
  const loginData = await loginRes.json();
  const cookie = loginRes.headers.get('set-cookie');
  
  // 2. Get Workflows
  console.log('Fetching workflows...');
  const wfRes = await fetch(baseUrl + '/workflows', {
    headers: { 'Cookie': cookie }
  });
  const workflowsData = await wfRes.json();
  const workflows = workflowsData.data || workflowsData;
  
  const targetWfSummary = workflows.find(w => w.name === 'AI Debt OS: WhatsApp Outbound');
  
  if (!targetWfSummary) {
    console.error('Workflow not found');
    return;
  }
  
  console.log('Found workflow ID:', targetWfSummary.id);
  const singleWfRes = await fetch(baseUrl + '/workflows/' + targetWfSummary.id, { headers: { 'Cookie': cookie } });
  const targetWf = await singleWfRes.json();
  
  // 3. Update the node
  let updated = false;
  for (const node of targetWf.nodes) {
    if (node.name === 'Evolution API' || node.type === 'n8n-nodes-base.httpRequest') {
      if (node.parameters && node.parameters.jsonBody) {
        node.parameters.jsonBody = '={\n  \"number\": \"{{ $json.body.to }}\",\n  \"options\": {\n    \"delay\": 1200\n  },\n  \"text\": \"{{ $json.body.message }}\"\n}';
        updated = true;
      }
    }
  }
  
  if (!updated) {
    console.error('Node not found to update');
    return;
  }
  
  // 4. Save workflow
  console.log('Saving workflow...');
  const saveRes = await fetch(baseUrl + '/workflows/' + targetWf.id, {
    method: 'PUT',
    headers: { 
      'Cookie': cookie,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(targetWf)
  });
  
  if (saveRes.ok) {
    console.log('Workflow successfully updated!');
  } else {
    console.error('Failed to save workflow:', await saveRes.text());
  }
}

run();
