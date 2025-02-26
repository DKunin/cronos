#!/bin/bash

echo "Starting deployment..."

# Go to project directory
cd /var/apps/cronos || exit

# Pull the latest changes from GitHub
git pull origin main

# Install dependencies (optional, if using npm)
npm install

# Restart pm2 process (replace 'your-pm2-process' with your actual process name)
pm2 restart cronos

echo "Deployment complete!"
