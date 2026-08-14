import pino from 'pino';

const isDevelopment = process.env.NODE_ENV !== 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isDevelopment ? 'debug' : 'info'),
  // Never log credentials, tokens or the raw Authorization header.
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', '*.token', '*.accessToken'],
    censor: '[redacted]',
  },
  ...(isDevelopment
    ? {
        transport: {
          target: 'pino-pretty',
          // SYS: renders the local clock; without it dev logs read as UTC and confuse debugging.
          options: { translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
        },
      }
    : {}),
});
