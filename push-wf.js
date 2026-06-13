const apiKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwZjIzYzcwYy1hOGQ3LTRmNGQtOWRiZi0zM2JjZTMzMWE2N2UiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiNDFhODgwODctYTk5ZC00MGI5LWFjZjQtN2UzN2JlNGQzMDE3IiwiaWF0IjoxNzgxMjc0NjYzfQ.b41KaV8zGSoG3x0kj29ImBGMvjmdXZZzbhv9KTEpcMo";
const baseUrl = "http://72.62.30.109:32768/api/v1";
const wfId = "hNnn97TdaGUJ5pj3";

async function run() {
  // 1. Fetch Workflow
  const res = await fetch(`${baseUrl}/workflows/${wfId}`, {
    headers: { "X-N8n-Api-Key": apiKey }
  });
  if (!res.ok) {
    console.error("Failed to fetch:", await res.text());
    return;
  }
  
  const wf = await res.json();
  
  // 2. Fix the broken JSON body inside the Evolution API node
  for (let node of wf.nodes) {
    if (node.name === "Evolution API") {
      node.parameters.url = "http://72.62.30.109:32769/message/sendText/ai-debt-mainmobily-instance";
      node.parameters.headerParameters.parameters[0].value = "yW9pHPPCn5btvjeqFr2rUdo0gS8KOebB";
      node.parameters.jsonBody = "={\n  \"number\": \"{{ $json.body.data.phone_number }}\",\n  \"options\": {\n    \"delay\": 1200\n  },\n  \"text\": \"{{ $json.body.data.message }}\"\n}";
    }
  }
  
  // 3. Push it back
  delete wf.id;
  delete wf.createdAt;
  delete wf.updatedAt;
  delete wf.versionId;
  delete wf.activeVersionId;
  delete wf.versionCounter;
  delete wf.triggerCount;
  delete wf.shared;
  delete wf.meta;
  
  const putRes = await fetch(`${baseUrl}/workflows/${wfId}`, {
    method: "PUT",
    headers: { 
      "X-N8n-Api-Key": apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(wf)
  });
  
  if (putRes.ok) {
    console.log("Successfully fixed and pushed the workflow!");
  } else {
    console.error("Failed to push:", await putRes.text());
  }
}

run();
