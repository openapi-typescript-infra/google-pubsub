import { metrics } from '@opentelemetry/api';
import type { ServiceExpress } from '@openapi-typescript-infra/service';
import { pino } from 'pino';

export const topic = 'test-topic';
export const gcpProjectId = 'fake-project';

export const fakeApp = {
  locals: {
    logger: pino(),
    name: 'my-service',
    gcpProjectId,
    meter: metrics.getMeter('my-service'),
  },
} as unknown as ServiceExpress;
