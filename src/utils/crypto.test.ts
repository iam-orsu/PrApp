import * as crypto from 'crypto';
import { validateWebhookSignature } from '../github/webhook';

describe('Webhook Signature Validation', () => {
  it('should accept valid signatures', () => {
    const secret = 'test-secret';
    const payload = 'test-payload';

    const hash = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

    const signature = `sha256=${hash}`;

    // Mock the config temporarily
    const originalSecret = process.env.GITHUB_WEBHOOK_SECRET;
    process.env.GITHUB_WEBHOOK_SECRET = secret;

    try {
      const result = validateWebhookSignature(payload, signature);
      expect(result).toBe(true);
    } finally {
      process.env.GITHUB_WEBHOOK_SECRET = originalSecret;
    }
  });

  it('should reject invalid signatures', () => {
    const secret = 'test-secret';
    const payload = 'test-payload';

    const originalSecret = process.env.GITHUB_WEBHOOK_SECRET;
    process.env.GITHUB_WEBHOOK_SECRET = secret;

    try {
      const result = validateWebhookSignature(
        payload,
        'sha256=invalid-signature'
      );
      expect(result).toBe(false);
    } finally {
      process.env.GITHUB_WEBHOOK_SECRET = originalSecret;
    }
  });

  it('should reject malformed signatures', () => {
    const originalSecret = process.env.GITHUB_WEBHOOK_SECRET;
    process.env.GITHUB_WEBHOOK_SECRET = 'test-secret';

    try {
      const result = validateWebhookSignature('payload', 'invalid-format');
      expect(result).toBe(false);
    } finally {
      process.env.GITHUB_WEBHOOK_SECRET = originalSecret;
    }
  });
});
