#!/bin/bash
docker exec -i n8n-lzyh-n8n-1 n8n export:workflow --all > workflows.json
node update-wf-payload.js
docker cp workflows_fixed.json n8n-lzyh-n8n-1:/tmp/workflows_fixed.json
docker exec -i n8n-lzyh-n8n-1 n8n import:workflow --input=/tmp/workflows_fixed.json
docker restart n8n-lzyh-n8n-1
