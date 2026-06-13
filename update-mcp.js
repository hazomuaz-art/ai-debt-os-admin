const fs = require('fs');
const path = 'C:\\Users\\moham\\.gemini\\config\\mcp_config.json';

try {
  let configStr = fs.readFileSync(path, 'utf8');
  let config = JSON.parse(configStr);

  if (!config.mcpServers) {
    config.mcpServers = {};
  }

  config.mcpServers['n8n'] = {
    "command": "npx",
    "args": ["-y", "n8n-mcp"],
    "env": {
      "N8N_API_KEY": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwZjIzYzcwYy1hOGQ3LTRmNGQtOWRiZi0zM2JjZTMzMWE2N2UiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiNDFhODgwODctYTk5ZC00MGI5LWFjZjQtN2UzN2JlNGQzMDE3IiwiaWF0IjoxNzgxMjc0NjYzfQ.b41KaV8zGSoG3x0kj29ImBGMvjmdXZZzbhv9KTEpcMo",
      "N8N_API_URL": "http://72.62.30.109:32768/api/v1"
    }
  };

  fs.writeFileSync(path, JSON.stringify(config, null, 2), 'utf8');
  console.log('Successfully updated mcp_config.json');
} catch (e) {
  console.error('Failed to update config:', e.message);
}
