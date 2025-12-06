#!/bin/bash

# Build script for Databricks Notebook Studio VS Code extension

set -e

echo "Installing dependencies..."
npm install

echo "Building extension..."
npm run package

echo "Creating VSIX package..."
./node_modules/.bin/vsce package --allow-missing-repository

echo ""
echo "Done! VSIX file created:"
ls -la *.vsix

echo ""
echo "To install in VS Code:"
echo "  1. Cmd+Shift+P -> 'Extensions: Install from VSIX...'"
echo "  2. Select the .vsix file"
