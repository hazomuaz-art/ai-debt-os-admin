const fs = require('fs');
const content = {
  "mcpServers": {
    "firebase-mcp-server": {
      "$typeName": "exa.cascade_plugins_pb.CascadePluginCommandTemplate",
      "command": "npx",
      "args": [
        "-y",
        "firebase-tools@latest",
        "mcp"
      ],
      "env": {}
    },
    "github-mcp-server": {
      "$typeName": "exa.cascade_plugins_pb.CascadePluginCommandTemplate",
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "-e",
        "GITHUB_PERSONAL_ACCESS_TOKEN",
        "ghcr.io/github/github-mcp-server"
      ],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "${process.env.GITHUB_PERSONAL_ACCESS_TOKEN || ""}"
      }
    },
    "supabase": {
      "serverUrl": "https://mcp.supabase.com/mcp"
    },
    "n8n": {
      "command": "npx",
      "args": [
        "-y",
        "n8n-mcp"
      ],
      "env": {
        "N8N_API_URL": "http://72.62.30.109:32768/api/v1",
        "N8N_API_KEY": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwZjIzYzcwYy1hOGQ3LTRmNGQtOWRiZi0zM2JjZTMzMWE2N2UiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiNDFhODgwODctYTk5ZC00MGI5LWFjZjQtN2UzN2JlNGQzMDE3IiwiaWF0IjoxNzgxMjc0NjYzfQ.b41KaV8zGSoG3x0kj29ImBGMvjmdXZZzbhv9KTEpcMo"
      }
    },
    "evolution-api-mcp": {
      "command": "npx",
      "args": [
        "-y",
        "@codespar/mcp-evolution-api"
      ],
      "env": {
        "EVOLUTION_API_URL": "http://72.62.30.109:32769",
        "EVOLUTION_API_KEY": "yW9pHPPCn5btvjeqFr2rUdo0gS8KOebB",
        "EVOLUTION_API_INSTANCE": "ai-debt-mainmobily-instance"
      }
    }
  }
};

fs.writeFileSync('C:\\Users\\moham\\.gemini\\config\\mcp_config.json', JSON.stringify(content, null, 2));
console.log('Fixed successfully!');
