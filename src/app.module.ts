import { Module } from '@nestjs/common';

/**
 * Root NestJS module for Challenge API v6.
 *
 * HTTP behavior remains registered on the existing Express application and is
 * mounted through Nest's Express adapter. This deliberately keeps the public
 * API, Joi validation, middleware ordering, and CommonJS service seams stable
 * while NestJS owns startup and shutdown lifecycle.
 */
@Module({})
export class AppModule {}
