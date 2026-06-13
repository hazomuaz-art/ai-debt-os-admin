#!/bin/bash
cd /docker/n8n-lzyh
sed -i 's/- "5678"/- "5678:5678"/g' docker-compose.yml
docker compose down
docker compose up -d
