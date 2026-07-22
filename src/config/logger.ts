// Application logger — a single shared Winston instance. Level is driven by
// LOG_LEVEL (default info). Development gets colorized, human-readable lines;
// production emits JSON so log aggregators can parse structured fields.

import winston from 'winston';

const isProduction = process.env.NODE_ENV === 'production';
const level = process.env.LOG_LEVEL || 'info';

// What: Chooses the output format based on environment.
// Does: Pretty, colorized, timestamped lines in dev; structured JSON in production.
// If removed: Logs have no consistent format and production logs are not machine-parseable.
const format = isProduction
    ? winston.format.combine(winston.format.timestamp(), winston.format.json())
    : winston.format.combine(
          winston.format.colorize(),
          winston.format.timestamp({ format: 'HH:mm:ss' }),
          winston.format.printf(({ timestamp, level: lvl, message }) => `${timestamp} ${lvl}: ${message}`)
      );

// What: The single application-wide Winston logger.
// Does: Writes all logs to the console transport at the configured level and format.
// If removed: Every module that imports it breaks; the app loses structured logging.
const logger = winston.createLogger({
    level,
    format,
    transports: [new winston.transports.Console()]
});

export default logger;
