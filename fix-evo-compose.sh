#!/bin/bash
cd /docker/evolution-api-yfbk
sed -i 's/- "8080"/- "32769:8080"/g' docker-compose.yml
docker compose down
docker compose up -d
