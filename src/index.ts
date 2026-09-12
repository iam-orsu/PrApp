import express from 'express';
import { config, validateConfig } from './utils/config';
import { logger } from './utils/logger';
import { initDatabase } from './db/models';
import { handleWebhook } from './routes/webhook';

async function main() {
  try {
    // Validate configuration
    validateConfig();
    logger.info('Configuration validated');

    // Initialize database
    initDatabase(config.database.url);
    logger.info('Database initialized');

    // Initialize Express
    const app = express();

    // CRITICAL: Store raw body before any parsing for webhook signature verification
    app.use(express.raw({ type: 'application/json' }));
    app.use((req: any, res, next) => {
      // Store raw body for webhook signature verification
      if (req.headers['x-github-delivery']) {
        req.rawBody = req.body;
      }
      next();
    });
    app.use(express.json());

    // Health check
    app.get('/health', (req, res) => {
      res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
      });
    });

    // Webhook endpoint
    app.post('/webhook', handleWebhook);

    // 404 handler
    app.use((req, res) => {
      res.status(404).json({ error: 'Not found' });
    });

    // Error handler — must have exactly 4 params for Express to recognize it
    app.use(
      (err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
        logger.error('Unhandled error', err);
        res.status(500).json({
          error: 'Internal server error',
          message: config.app.debug ? err.message : undefined,
        });
      }
    );

    // Start server
    const port = config.app.port;
    app.listen(port, () => {
      logger.info(`Server running on port ${port}`);
      logger.info(`Domain: ${config.deployment.domain}`);
      logger.info(`Environment: ${config.app.env}`);
    });
  } catch (error) {
    logger.error('Fatal startup error', error);
    process.exit(1);
  }
}

main();
