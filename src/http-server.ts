#!/usr/bin/env node
/**
 * Spotify MCP Server - HTTP Transport
 * Provides /mcp endpoint for n8n and other HTTP-based MCP clients
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import express from 'express';
import crypto from 'crypto';
import { albumTools } from './albums.js';
import { playTools } from './play.js';
import { playlistTools } from './playlist.js';
import { readTools } from './read.js';

interface Session {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  lastActivity: number;
}

class SpotifyMCPServer {
  private sessionServers = new Map<string, Session>();
  private static SESSION_TTL_MS = 3600000; // 1 hour
  private static MAX_SESSIONS = 100;
  private cleanupInterval?: NodeJS.Timeout;

  private createServer(): McpServer {
    const server = new McpServer({
      name: 'spotify-controller',
      version: '1.0.0',
    });

    // Register all tools
    const allTools = [...readTools, ...playTools, ...albumTools, ...playlistTools];
    allTools.forEach((tool) => {
      server.tool(tool.name, tool.description, tool.schema, tool.handler);
    });

    return server;
  }

  private cleanupSessions(): void {
    const now = Date.now();
    const expired: string[] = [];

    for (const [sessionId, session] of this.sessionServers.entries()) {
      if (now - session.lastActivity > SpotifyMCPServer.SESSION_TTL_MS) {
        expired.push(sessionId);
      }
    }

    for (const sessionId of expired) {
      const session = this.sessionServers.get(sessionId);
      if (session) {
        session.server.close().catch((err) => {
          console.error('Session cleanup error:', { sessionId: sessionId.substring(0, 8), error: err.message });
        });
        this.sessionServers.delete(sessionId);
        console.log('Session expired:', { sessionId: sessionId.substring(0, 8) });
      }
    }

    if (expired.length > 0) {
      console.log('Session cleanup:', { expired: expired.length, active: this.sessionServers.size });
    }
  }

  async run() {
    const app = express();
    app.use(express.json());

    app.get('/health', (_req, res) => {
      res.status(200).json({
        status: 'ok',
        service: 'spotify-mcp-server',
        activeSessions: this.sessionServers.size
      });
    });

    app.get('/ready', (_req, res) => {
      res.status(200).json({ status: 'ready', service: 'spotify-mcp-server' });
    });

    // Ensure proper Accept headers for MCP protocol
    app.use((req, _res, next) => {
      const accept = (req.headers.accept || '').split(',').map((v) => v.trim());
      if (!accept.includes('application/json')) accept.push('application/json');
      if (!accept.includes('text/event-stream')) accept.push('text/event-stream');
      req.headers.accept = accept.join(', ');
      next();
    });

    // MCP endpoint for POST (initialize and tool calls)
    app.post('/mcp', async (req, res) => {
      const sessionId = req.headers['mcp-session-id'] as string;

      // Initialize new session
      if (!sessionId && req.body?.method === 'initialize') {
        if (this.sessionServers.size >= SpotifyMCPServer.MAX_SESSIONS) {
          return res.status(503).json({ error: 'Session capacity reached' });
        }

        const newSessionId = crypto.randomBytes(16).toString('hex');
        const server = this.createServer();
        const transport = new StreamableHTTPServerTransport({
          enableJsonResponse: true,
          sessionIdGenerator: () => newSessionId,
        });

        await server.connect(transport as Transport);
        console.log('Session initialized:', { sessionId: newSessionId.substring(0, 8) });

        this.sessionServers.set(newSessionId, { server, transport, lastActivity: Date.now() });
        res.setHeader('mcp-session-id', newSessionId);
        await transport.handleRequest(req, res, req.body);
      } else if (sessionId) {
        // Use existing session
        const session = this.sessionServers.get(sessionId);
        if (!session) return res.status(404).json({ error: 'Session not found' });
        session.lastActivity = Date.now();
        await session.transport.handleRequest(req, res, req.body);
      } else {
        res.status(400).json({ error: 'Session ID required or initialize method missing' });
      }
    });

    // MCP endpoint for GET (SSE)
    app.get('/mcp', async (req, res) => {
      const sessionId = req.headers['mcp-session-id'] as string;
      if (!sessionId) return res.status(400).json({ error: 'Session ID required' });
      const session = this.sessionServers.get(sessionId);
      if (!session) return res.status(404).json({ error: 'Session not found' });
      session.lastActivity = Date.now();
      await session.transport.handleRequest(req, res);
    });

    const port = parseInt(process.env.PORT || '8080', 10);
    app.listen(port, '0.0.0.0', () => {
      console.log('Spotify MCP Server started:', { port, mode: 'http' });
    });

    // Start session cleanup interval
    this.cleanupInterval = setInterval(() => this.cleanupSessions(), 60000);
    console.log('Session cleanup enabled:', {
      interval: 60000,
      ttl: SpotifyMCPServer.SESSION_TTL_MS,
    });

    // Graceful shutdown
    const shutdown = async () => {
      console.log('Shutdown initiated:', { activeSessions: this.sessionServers.size });

      if (this.cleanupInterval) {
        clearInterval(this.cleanupInterval);
      }

      for (const [sessionId, session] of this.sessionServers.entries()) {
        try {
          await session.server.close();
          console.log('Session closed on shutdown:', { sessionId: sessionId.substring(0, 8) });
        } catch (err: any) {
          console.error('Shutdown error:', { sessionId: sessionId.substring(0, 8), error: err.message });
        }
      }

      this.sessionServers.clear();
      console.log('Shutdown complete');
      process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  }
}

new SpotifyMCPServer().run();
