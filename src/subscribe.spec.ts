import { beforeAll, describe, expect, test } from 'vitest';
import { PubSub } from '@google-cloud/pubsub';

import { fakeApp, gcpProjectId, topic } from './test-consts.js';

import { ACK, subscribeWithAutoAck, subscribeWithPositiveACK } from './index.js';

describe('Subscriptions should work', () => {
  beforeAll(async () => {
    const pubsub = new PubSub({ projectId: gcpProjectId });
    await pubsub.createSubscription(topic, `${topic}-my-service`);
  }, 10000);

  test('should ack successful handlers', async () => {
    let receptions = 0;
    let signal: () => void;

    const deliveryPromise = new Promise<boolean>((accept) => {
      signal = () => accept(true);
    });
    const { pubsub, shutdown } = await subscribeWithAutoAck(fakeApp, {
      topic,
      handler(app, message) {
        expect(app.locals.name).toBe('my-service');
        expect(message.data.toString()).toBe('Hello world');
        receptions += 1;
        // when ack is called, the signal will fire
        message.ack = signal;
      },
    });
    expect.soft(pubsub.isEmulator, 'Should be the emulator').toBe(true);
    await pubsub.topic(topic).publishMessage({ data: Buffer.from('Hello world') });
    await deliveryPromise;
    expect(receptions).toBe(1);
    await shutdown();
  });

  test('should nack failed handlers', async () => {
    let signal: () => void;

    const deliveryPromise = new Promise<boolean>((accept) => {
      signal = () => accept(true);
    });
    const { pubsub, shutdown } = await subscribeWithAutoAck(fakeApp, {
      topic,
      handler(app, message) {
        // when nack is called, the signal will fire
        message.nack = signal;
        expect(message.data.toString()).toBe('Goodbye world');
        throw new Error('I failed');
      },
    });
    await pubsub.topic(topic).publishMessage({ data: Buffer.from('Goodbye world') });
    await deliveryPromise;
    await shutdown();
  });

  test('types of handlers', async () => {
    async function ackFn() {
      return new Promise<typeof ACK>((accept) => setTimeout(() => accept(ACK), 1));
    }

    async function autoFn() {
      return new Promise((accept) => setTimeout(() => accept(undefined), 1)) as Promise<void>;
    }

    // This is just to make sure it compiles
    let { shutdown } = await subscribeWithAutoAck(fakeApp, {
      topic,
      handler: autoFn,
    });
    await shutdown();
    ({ shutdown } = await subscribeWithPositiveACK(fakeApp, {
      subscription: `${topic}-my-service`,
      handler: ackFn,
    }));
    await shutdown();
  });
});
