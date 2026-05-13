# Spotify MCP Server - OpenShift Deployment Guide

This guide covers deploying the Spotify MCP Server on OpenShift with HTTP wrapper for REST API access.

## Prerequisites

- OpenShift cluster access with `oc` CLI configured
- Spotify Developer credentials (Client ID and Secret)
- Git repository with this code

## Architecture

The deployment consists of:
- **MCP Server**: Stdio-based Model Context Protocol server for Spotify
- **HTTP Wrapper**: Express.js wrapper that exposes MCP via REST API
- **Container**: Multi-stage Docker build with TypeScript compilation

## Quick Start

### 1. Create Namespace

```bash
oc new-project spotify-mcp
# Or use existing namespace
# oc project YOUR_NAMESPACE
```

### 2. Create Spotify Configuration

The Spotify MCP server requires authentication tokens. You need to run the auth flow locally first:

```bash
# In your local clone of the repository
cd spotify-mcp-server

# Copy example config
cp spotify-config.example.json spotify-config.json

# Edit spotify-config.json and add your Spotify Client ID and Secret
# Get these from https://developer.spotify.com/dashboard

# Run the authentication flow
npm install
npm run auth

# Follow the browser prompts to authorize the application
# This will save access and refresh tokens to spotify-config.json
```

Now create the secret from your authenticated config:

```bash
# Create secret from local file
oc create secret generic spotify-config \
  --from-file=spotify-config.json=./spotify-config.json

# Or create manually (update with your actual values)
# See k8s/spotify-config-secret.yaml for template
```

**Optional**: If you prefer environment variables instead of config file:

```bash
oc create secret generic spotify-credentials \
  --from-literal=client-id=YOUR_SPOTIFY_CLIENT_ID \
  --from-literal=client-secret=YOUR_SPOTIFY_CLIENT_SECRET
```

Note: The config file method is preferred as it includes refresh tokens.

### 3. Update Configuration Files

Edit the following files to match your environment:

**k8s/deployment.yaml**:
```yaml
image: image-registry.openshift-image-registry.svc:5000/YOUR_NAMESPACE/spotify-mcp-server:latest
```

**k8s/buildconfig.yaml**:
```yaml
git:
  uri: https://github.com/YOUR_USERNAME/spotify-mcp-server
```

### 4. Deploy Resources

```bash
# Create Spotify config secret (if not already created in step 2)
oc create secret generic spotify-config \
  --from-file=spotify-config.json=./spotify-config.json

# Create ImageStream
oc apply -f k8s/imagestream.yaml

# Create BuildConfig and trigger build
oc apply -f k8s/buildconfig.yaml

# Wait for build to complete
oc logs -f bc/spotify-mcp-server

# Create Service
oc apply -f k8s/service.yaml

# Create Route
oc apply -f k8s/route.yaml

# Create Deployment
oc apply -f k8s/deployment.yaml
```

### 5. Verify Deployment

```bash
# Check pod status
oc get pods -l app=spotify-mcp-server

# Check logs
oc logs -f deployment/spotify-mcp-server

# Get route URL
oc get route spotify-mcp-server -o jsonpath='{.spec.host}'

# Test health endpoint
curl https://$(oc get route spotify-mcp-server -o jsonpath='{.spec.host}')/health
```

## API Endpoints

Once deployed, the following endpoints are available:

### Health & Status
- `GET /health` - Health check
- `GET /ready` - Readiness probe

### MCP Tools
- `GET /api/tools` - List all available Spotify tools
- `POST /api/tools/:toolName` - Execute a specific tool

### Spotify Shortcuts
- `GET /api/spotify/current-playback` - Get current playback state
- `POST /api/spotify/play` - Play/resume playback
- `POST /api/spotify/search` - Search Spotify catalog

## Example Usage

### List Available Tools
```bash
ROUTE_URL=$(oc get route spotify-mcp-server -o jsonpath='{.spec.host}')
curl https://$ROUTE_URL/api/tools | jq .
```

### Search for a Track
```bash
curl -X POST https://$ROUTE_URL/api/spotify/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Bohemian Rhapsody",
    "type": "track"
  }'
```

### Get Current Playback
```bash
curl https://$ROUTE_URL/api/spotify/current-playback | jq .
```

## Building Locally with Docker

```bash
# Build image
docker build -t spotify-mcp-server:latest .

# Run locally
docker run -p 8080:8080 \
  -e SPOTIFY_CLIENT_ID=your_client_id \
  -e SPOTIFY_CLIENT_SECRET=your_client_secret \
  spotify-mcp-server:latest

# Test
curl http://localhost:8080/health
```

## Troubleshooting

### Build Failures

Check build logs:
```bash
oc logs -f bc/spotify-mcp-server
```

Common issues:
- Missing dependencies: Ensure `package.json` is complete
- TypeScript errors: Check `npm run build` output
- Dockerfile syntax: Verify multi-stage build steps

### Pod CrashLoopBackOff

Check pod logs:
```bash
oc logs -f deployment/spotify-mcp-server
```

Common issues:
- Missing Spotify credentials: Verify secret exists and is referenced
- Port conflicts: Ensure PORT=8080 environment variable
- MCP process failures: Check for authentication errors in logs

### HTTP Wrapper Not Starting

The wrapper spawns the MCP server as a child process. Check:
```bash
# Verify build output exists
oc exec deployment/spotify-mcp-server -- ls -la /app/build/

# Check wrapper can find MCP server
oc exec deployment/spotify-mcp-server -- node -e "console.log(require('fs').existsSync('/app/build/index.js'))"
```

### Authentication Errors

Spotify requires OAuth authentication. The MCP server needs valid credentials:

```bash
# Verify config file is mounted
oc exec deployment/spotify-mcp-server -- ls -la /app/spotify-config.json

# Check config file contents (first few chars to verify it exists)
oc exec deployment/spotify-mcp-server -- head -c 50 /app/spotify-config.json

# Verify secret exists
oc get secret spotify-config

# Check secret data
oc get secret spotify-config -o jsonpath='{.data.spotify-config\.json}' | base64 -d | jq .
```

Common issues:
1. **Missing config file**: Verify secret was created and is mounted
2. **Invalid tokens**: Tokens may have expired - run `npm run auth` locally and recreate secret
3. **Permissions**: Config file should be readable by UID 1001 (mode 0400)
4. **Invalid JSON**: Check config file format matches example

## Scaling

```bash
# Scale up
oc scale deployment/spotify-mcp-server --replicas=3

# Scale down
oc scale deployment/spotify-mcp-server --replicas=1
```

Note: Each replica maintains its own MCP server process and Spotify session.

## Updating

### Rebuild from Source
```bash
# Trigger new build
oc start-build spotify-mcp-server

# Follow build
oc logs -f bc/spotify-mcp-server

# Deployment will auto-update with new image
```

### Update from Git
```bash
# Update BuildConfig to point to new commit/tag
oc patch bc/spotify-mcp-server -p '{"spec":{"source":{"git":{"ref":"v1.0.0"}}}}'

# Trigger build
oc start-build spotify-mcp-server
```

## Resource Requirements

Default requests/limits:
- **CPU**: 100m request, 500m limit
- **Memory**: 256Mi request, 512Mi limit

Adjust in `k8s/deployment.yaml` based on usage patterns.

## Security Considerations

1. **Credentials**: Store Spotify credentials in OpenShift secrets, never in code
2. **RBAC**: Limit service account permissions to minimum required
3. **Network**: Use Routes with TLS termination (edge mode)
4. **Container**: Runs as non-root user (UID 1001)
5. **Capabilities**: All Linux capabilities dropped

## Integration with n8n

The HTTP wrapper is designed for n8n workflow integration:

1. Use HTTP Request nodes to call the API
2. Set base URL to your route: `https://your-route-url`
3. Use `/api/tools/:toolName` endpoints for MCP tool execution
4. Parse JSON responses in n8n for workflow logic

Example n8n HTTP Request:
```json
{
  "method": "POST",
  "url": "https://your-route-url/api/tools/searchSpotify",
  "body": {
    "query": "{{ $json.searchQuery }}",
    "type": "track",
    "limit": 10
  }
}
```

## Files Structure

```
spotify-mcp-server/
├── Dockerfile                  # Multi-stage container build
├── docker/
│   └── http-wrapper.cjs       # Express.js HTTP wrapper
├── k8s/
│   ├── deployment.yaml        # Kubernetes Deployment
│   ├── service.yaml           # Kubernetes Service
│   ├── route.yaml             # OpenShift Route
│   ├── imagestream.yaml       # OpenShift ImageStream
│   └── buildconfig.yaml       # OpenShift BuildConfig
├── src/                       # TypeScript MCP server source
└── DEPLOYMENT.md             # This file
```

## Support

For issues:
- MCP Server: Check upstream repository
- OpenShift deployment: Review pod logs and events
- HTTP wrapper: Examine wrapper logs for MCP communication errors
