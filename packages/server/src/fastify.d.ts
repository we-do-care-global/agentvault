import "fastify";

declare module "fastify" {
  interface FastifyRequest {
    /** Wall-clock start of the request, set by the onRequest metrics hook. */
    startTime?: bigint;
  }
}
