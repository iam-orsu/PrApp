import * as dotenv from 'dotenv';

dotenv.config();

function getEnvVar(name: string, required: boolean = true): string {
  const value = process.env[name];
  if (!value && required) {
    throw new Error(`Environment variable ${name} is required but not set`);
  }
  return value || '';
}

function getEnvNumber(name: string, defaultValue?: number): number {
  const value = process.env[name];
  if (!value) {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(`Environment variable ${name} is required but not set`);
  }
  const num = parseInt(value, 10);
  if (isNaN(num)) {
    throw new Error(`Environment variable ${name} must be a number`);
  }
  return num;
}

export const config = {
  // GitHub App Configuration
  github: {
    appId: getEnvNumber('GITHUB_APP_ID'),
    privateKey: getEnvVar('GITHUB_PRIVATE_KEY'),
    webhookSecret: getEnvVar('GITHUB_WEBHOOK_SECRET'),
  },

  // Deployment Configuration
  deployment: {
    domain: getEnvVar('DOMAIN'),
    letsencryptEmail: getEnvVar('LETSENCRYPT_EMAIL', false),
  },

  // DeepSeek Configuration
  deepseek: {
    apiKey: getEnvVar('DEEPSEEK_API_KEY'),
    model: getEnvVar('DEEPSEEK_MODEL', false) || 'deepseek-chat',
    timeout: getEnvNumber('DEEPSEEK_TIMEOUT', 60000),
  },

  // Database Configuration
  database: {
    url: getEnvVar('DATABASE_URL'),
  },

  // Application Configuration
  app: {
    port: getEnvNumber('PORT', 3000),
    env: getEnvVar('NODE_ENV', false) || 'development',
    logLevel: getEnvVar('LOG_LEVEL', false) || 'info',
    maxConcurrentJobs: getEnvNumber('MAX_CONCURRENT_JOBS', 5),
    maxDiffSize: getEnvNumber('MAX_DIFF_SIZE', 50000),
    debug: (getEnvVar('DEBUG', false) || 'false').toLowerCase() === 'true',
  },
};

export function validateConfig(): void {
  const required = [
    config.github.appId,
    config.github.privateKey,
    config.github.webhookSecret,
    config.deployment.domain,
    config.deepseek.apiKey,
    config.database.url,
  ];

  const missing = required.filter((val) => !val);
  if (missing.length > 0) {
    throw new Error('Missing required environment variables. Check .env file.');
  }
}
