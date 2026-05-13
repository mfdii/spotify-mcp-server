# Spotify MCP Server - OpenShift Edition

This is a fork of [spotify-mcp-server](https://github.com/marcelmarais/spotify-mcp-server) configured for OpenShift deployment with HTTP wrapper support.

## What's Different

This fork adds:

1. **HTTP Wrapper** (`docker/http-wrapper.cjs`)
   - Wraps stdio-based MCP server for REST API access
   - Express.js server with health/ready probes
   - Compatible with n8n and other HTTP-based integrations

2. **Container Support** (`Dockerfile`)
   - Multi-stage build for optimized image size
   - TypeScript compilation in builder stage
   - Non-root user for security

3. **Kubernetes/OpenShift Manifests** (`k8s/`)
   - Deployment with resource limits and security context
   - Service for cluster networking
   - Route for external access (OpenShift)
   - BuildConfig for source-to-image builds
   - ImageStream for image management

## Quick Start

See [DEPLOYMENT.md](./DEPLOYMENT.md) for complete deployment instructions.

```bash
# Clone and navigate
git clone https://github.com/YOUR_USERNAME/spotify-mcp-server
cd spotify-mcp-server

# Create namespace
oc new-project spotify-mcp

# Authenticate locally and create config secret
# 1. Copy example: cp spotify-config.example.json spotify-config.json
# 2. Add your Client ID/Secret from https://developer.spotify.com/dashboard
# 3. Run: npm run auth
# 4. Create secret from authenticated config:
oc create secret generic spotify-config \
  --from-file=spotify-config.json=./spotify-config.json

# Update k8s/*.yaml files with your namespace/repository

# Deploy
oc apply -f k8s/
```

## API Endpoints

Once deployed:

- `GET /health` - Health check
- `GET /ready` - Readiness probe
- `GET /api/tools` - List available Spotify tools
- `POST /api/tools/:toolName` - Execute a tool
- `GET /api/spotify/current-playback` - Get playback state
- `POST /api/spotify/search` - Search Spotify

## Architecture

```
┌─────────────┐     HTTP      ┌──────────────┐     stdio     ┌─────────────┐
│   n8n or    │──────────────▶│HTTP Wrapper  │◀─────────────▶│  MCP Server │
│   Client    │   REST API    │(Express.js)  │   JSON-RPC    │  (Node.js)  │
└─────────────┘               └──────────────┘               └─────────────┘
                                     │
                                     │ spawns
                                     ▼
                              ┌──────────────┐
                              │   Spotify    │
                              │     API      │
                              └──────────────┘
```

## Development vs Production

### Development (stdio mode)
```bash
npm install
npm run build
node build/index.js
```

### Production (HTTP mode with Docker)
```bash
docker build -t spotify-mcp-server .
docker run -p 8080:8080 \
  -e SPOTIFY_CLIENT_ID=... \
  -e SPOTIFY_CLIENT_SECRET=... \
  spotify-mcp-server
```

### Production (OpenShift)
See [DEPLOYMENT.md](./DEPLOYMENT.md)

## Upstream

This fork tracks: https://github.com/marcelmarais/spotify-mcp-server

To sync upstream changes:
```bash
git remote add upstream https://github.com/marcelmarais/spotify-mcp-server
git fetch upstream
git merge upstream/main
```

## License

Same as upstream repository.
