// Type declarations for modules without types
declare module '@fastify/cors' {
  import { FastifyPluginAsync } from 'fastify';
  interface CorsOptions {
    origin?: string | string[] | ((origin: string, cb: (err: Error | null, allow: boolean) => void) => void);
    credentials?: boolean;
    methods?: string[];
    allowedHeaders?: string[];
    exposedHeaders?: string[];
    maxAge?: number;
  }
  const plugin: FastifyPluginAsync<CorsOptions>;
  export default plugin;
}

declare module '@fastify/helmet' {
  import { FastifyPluginAsync } from 'fastify';
  interface HelmetOptions {
    contentSecurityPolicy?: boolean | object;
    crossOriginEmbedderPolicy?: boolean | object;
    crossOriginOpenerPolicy?: boolean | object;
    crossOriginResourcePolicy?: boolean | object;
    dnsPrefetchControl?: boolean | object;
    frameguard?: boolean | object;
    hidePoweredBy?: boolean | object;
    hsts?: boolean | object;
    ieNoOpen?: boolean | object;
    noSniff?: boolean | object;
    permittedCrossDomainPolicies?: boolean | object;
    referrerPolicy?: boolean | object;
    xssFilter?: boolean | object;
  }
  const plugin: FastifyPluginAsync<HelmetOptions>;
  export default plugin;
}

declare module '@fastify/rate-limit' {
  import { FastifyPluginAsync } from 'fastify';
  interface RateLimitOptions {
    max?: number;
    timeWindow?: number | string;
    keyGenerator?: (request: any) => string;
    allowList?: string[];
    ban?: number;
    cache?: number;
    skipOnError?: boolean;
    addHeaders?: boolean;
    disableCache?: boolean;
  }
  const plugin: FastifyPluginAsync<RateLimitOptions>;
  export default plugin;
}