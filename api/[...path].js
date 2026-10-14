import { createServer } from '../server/src/index.js';

// Vercel invokes this HTTP server for both the REST API and /api/socket.io.
const { httpServer } = createServer();

export default httpServer;
