/**
 * HTTP Wrapper for Spotify MCP Server
 *
 * Wraps the stdio-based Spotify MCP server for HTTP/REST access
 */

const express = require('express');
const { spawn } = require('child_process');
const app = express();
const port = process.env.PORT || 8080;

app.use(express.json());

let mcpProcess = null;
let isReady = false;

/**
 * Start persistent MCP process
 */
function startMCPProcess() {
    if (mcpProcess) {
        return;
    }

    console.log('Starting Spotify MCP server process...');
    mcpProcess = spawn('node', ['/app/build/index.js'], {
        stdio: ['pipe', 'pipe', 'pipe']
    });

    let initBuffer = '';

    mcpProcess.stdout.on('data', (data) => {
        initBuffer += data.toString();
        // Look for initialization message
        if (initBuffer.includes('MCP') || initBuffer.includes('server')) {
            isReady = true;
            console.log('Spotify MCP server is ready');
        }
    });

    mcpProcess.stderr.on('data', (data) => {
        console.error('MCP stderr:', data.toString());
        isReady = true; // Assume ready even if stderr
    });

    mcpProcess.on('close', (code) => {
        console.log(`MCP process exited with code ${code}`);
        mcpProcess = null;
        isReady = false;
        // Restart after 1 second
        setTimeout(startMCPProcess, 1000);
    });

    mcpProcess.on('error', (error) => {
        console.error('MCP process error:', error);
        mcpProcess = null;
        isReady = false;
    });

    // Give it a moment to initialize
    setTimeout(() => {
        isReady = true;
    }, 2000);
}

/**
 * Execute MCP command via stdio
 */
async function executeMCPCommand(method, params = {}) {
    return new Promise((resolve, reject) => {
        if (!mcpProcess) {
            reject(new Error('MCP process not running'));
            return;
        }

        const requestId = Date.now();
        const request = {
            jsonrpc: '2.0',
            id: requestId,
            method,
            params
        };

        let responseBuffer = '';
        let timeout;

        const responseHandler = (data) => {
            responseBuffer += data.toString();
            const lines = responseBuffer.split('\n');

            for (const line of lines) {
                if (!line.trim()) continue;

                try {
                    const response = JSON.parse(line);
                    if (response.id === requestId) {
                        clearTimeout(timeout);
                        mcpProcess.stdout.removeListener('data', responseHandler);

                        if (response.error) {
                            reject(new Error(response.error.message || 'MCP error'));
                        } else {
                            resolve(response.result);
                        }
                        return;
                    }
                } catch (e) {
                    // Not valid JSON, continue buffering
                }
            }
        };

        mcpProcess.stdout.on('data', responseHandler);

        // 30 second timeout
        timeout = setTimeout(() => {
            mcpProcess.stdout.removeListener('data', responseHandler);
            reject(new Error('MCP command timeout'));
        }, 30000);

        try {
            mcpProcess.stdin.write(JSON.stringify(request) + '\n');
        } catch (error) {
            clearTimeout(timeout);
            mcpProcess.stdout.removeListener('data', responseHandler);
            reject(error);
        }
    });
}

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: mcpProcess ? 'healthy' : 'degraded',
        service: 'spotify-mcp-server-http-wrapper',
        processRunning: !!mcpProcess
    });
});

// Readiness check
app.get('/ready', (req, res) => {
    if (isReady && mcpProcess) {
        res.json({ status: 'ready' });
    } else {
        res.status(503).json({ status: 'not ready', processRunning: !!mcpProcess });
    }
});

// List available tools
app.get('/api/tools', async (req, res) => {
    try {
        const result = await executeMCPCommand('tools/list', {});
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Execute tool
app.post('/api/tools/:toolName', async (req, res) => {
    try {
        const { toolName } = req.params;
        const params = req.body;

        const result = await executeMCPCommand('tools/call', {
            name: toolName,
            arguments: params
        });

        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Spotify-specific endpoints for convenience
app.get('/api/spotify/current-playback', async (req, res) => {
    try {
        const result = await executeMCPCommand('tools/call', {
            name: 'getCurrentPlayback',
            arguments: {}
        });
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/spotify/play', async (req, res) => {
    try {
        const result = await executeMCPCommand('tools/call', {
            name: 'play',
            arguments: req.body
        });
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/spotify/search', async (req, res) => {
    try {
        const { query, type } = req.body;
        const result = await executeMCPCommand('tools/call', {
            name: 'searchSpotify',
            arguments: { query, type: type || 'track' }
        });
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Start MCP process on wrapper startup
startMCPProcess();

app.listen(port, '0.0.0.0', () => {
    console.log(`Spotify MCP HTTP wrapper listening on port ${port}`);
    console.log(`Health check: http://localhost:${port}/health`);
    console.log(`API documentation: http://localhost:${port}/api/tools`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down...');
    if (mcpProcess) {
        mcpProcess.kill();
    }
    process.exit(0);
});
