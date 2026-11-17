import { startServerFromEnvironment } from './index.js';

process.env.NODE_ENV = 'production';
await startServerFromEnvironment();
