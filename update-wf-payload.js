const fs = require('fs');
const wfs = JSON.parse(fs.readFileSync('workflows.json', 'utf8'));
wfs.forEach(wf => {
  if (wf.nodes) {
    wf.nodes.forEach(node => {
      if (node.name === "Evolution API") {
        node.parameters.url = "http://72.62.30.109:32769/message/sendText/ai-debt-mainmobily-instance";
        if (node.parameters.headerParameters && node.parameters.headerParameters.parameters) {
          node.parameters.headerParameters.parameters[0].value = "yW9pHPPCn5btvjeqFr2rUdo0gS8KOebB";
        }
        node.parameters.jsonBody = "={\n  \"number\": \"{{ $json.body.data.phone_number }}\",\n  \"options\": {\n    \"delay\": 1200\n  },\n  \"text\": \"{{ $json.body.data.message }}\"\n}";
      }
    });
  }
});
fs.writeFileSync('workflows_fixed.json', JSON.stringify(wfs, null, 2));
