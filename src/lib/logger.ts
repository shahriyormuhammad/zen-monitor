import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: [
      'wbApiToken',
      '*.wbApiToken',
      'token',
      '*.token',
      'password',
      '*.password',
      'secret',
      '*.secret',
      'encryptionKey',
      '*.encryptionKey',
    ],
    censor: '[REDACTED]',
  },
  base: { service: 'enterprise-wb-analytics' },
});
