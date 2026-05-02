import { describe, expect, test, vi } from 'vitest';
import { metrics } from '@opentelemetry/api';
import type { ServiceExpress } from '@openapi-typescript-infra/service';
import * as exports from '@google-cloud/pubsub';

import { createPublisher } from './client.js';

const gcpProjectId = 'fake-project';

const makeFakeApp = (name: string = gcpProjectId): ServiceExpress => {
  return {
    locals: {
      name: 'my-service',
      gcpProjectId: name,
      meter: metrics.getMeter('my-service'),
    },
  } as unknown as ServiceExpress;
};

interface Topics {
  'test-topic': { hello: string };
  'fake-topic': { goodbye: string };
}

describe('pubsub client', async () => {
  test('should know good topics from bad', async () => {
    const publisher = createPublisher<Topics>(makeFakeApp());
    expect(publisher).toBeTruthy();
    expect(publisher.publish).to.be.a('function');

    await publisher.publish('test-topic', { hello: 'world' });
    await expect(() => publisher.publish('fake-topic', { goodbye: 'world' })).rejects.toThrow(
      'NOT_FOUND',
    );
  });

  test('createPublisher should accept a config argument', async () => {
    const PubSubSpy = vi.spyOn(exports, 'PubSub').mockImplementation(function (this: unknown) {
      return {};
    } as never);
    createPublisher<Topics>(makeFakeApp('newInstance'), { 'grpc.keepalive_time_ms': 100 });
    expect(PubSubSpy).toHaveBeenCalledWith(
      expect.objectContaining({ 'grpc.keepalive_time_ms': 100, projectId: 'newInstance' }),
    );
    PubSubSpy.mockRestore();
  });
});
