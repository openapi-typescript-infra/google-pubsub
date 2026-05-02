import pmap from 'p-map';
import { v1, type Message, type SubscriptionOptions } from '@google-cloud/pubsub';
import { PreciseDate } from '@google-cloud/precise-date';
import type {
  AnyServiceLocals,
  ConfigurationSchema,
  ServiceExpress,
  ServiceLocals,
} from '@openapi-typescript-infra/service';

import { closePubSubClient, getPubSubClient } from './client.js';

export const ACK = 'ACK';
const DEFALUT_HEARTBEAT_INTERVAL = 5000;

/**
 * The ack type determines how the handler result is interpreted in
 * terms of acking the message. If ack is 'auto', the message will
 * be acked if the handler does not throw. If ack is 'ACK', the
 * message will be acked only if the handler returns the ACK symbol, else it
 * will be nacked. If ack is 'manual', the handler must ack or nack
 * on its own, we will not get involved (dangerous, obviously).
 *
 * The default is 'auto'.
 */
type AckType = 'auto' | 'ACK' | 'manual';

// Depending on the AckType, the function should have a different return type
type HandlerReturnType<Ack extends AckType> = Ack extends 'ACK'
  ? typeof ACK | Promise<typeof ACK>
  : void | Promise<void>;

export type SesameSubscriptionOptions<HandlerAck extends AckType = 'auto'> = {
  ack?: HandlerAck;
  noLog?: boolean;
} & SubscriptionOptions;

export interface PubSubHandlerContext {
  // Additional fields to be added to the log message, if any
  logFields: Record<string, unknown>;
}

export interface BaseHandler<
  Ack extends AckType,
  SLocals extends AnyServiceLocals = ServiceLocals<ConfigurationSchema>,
> {
  handler: (
    app: ServiceExpress<SLocals>,
    message: Message,
    context: PubSubHandlerContext,
  ) => HandlerReturnType<Ack>;
  debug?: boolean;
  heartbeatInterval?: number;
}

export interface TopicHandler<
  Ack extends AckType,
  SLocals extends AnyServiceLocals = ServiceLocals<ConfigurationSchema>,
> extends BaseHandler<Ack, SLocals> {
  topic: string;
}

export interface SubscriptionHandler<
  Ack extends AckType,
  SLocals extends AnyServiceLocals = ServiceLocals<ConfigurationSchema>,
> extends BaseHandler<Ack, SLocals> {
  subscription: string;
}

function getSubscriptionName<
  SLocals extends AnyServiceLocals = ServiceLocals<ConfigurationSchema>,
  Ack extends AckType = 'auto',
>(name: string, handler: TopicHandler<Ack, SLocals> | SubscriptionHandler<Ack, SLocals>) {
  if ('subscription' in handler && handler.subscription) {
    return handler.subscription;
  }
  if ('topic' in handler && handler.topic) {
    return `${handler.topic}-${process.env.PUBSUB_SUB_SUFFIX || name}`;
  }
  throw new Error('Invalid subscription configuration - missing topic or subscription setting');
}

function topicName(topic: string) {
  const index = topic.indexOf('/topics/');
  if (index === -1) {
    return topic;
  }
  return topic.substring(index + 8);
}

const ONE_E_6 = BigInt(1e6);

function since(date: PreciseDate) {
  const now = new PreciseDate();
  // Get times in nanoseconds
  const timeThen = date.getFullTime();
  const timeNow = now.getFullTime();
  const diffInMilliseconds = (timeNow - timeThen) / ONE_E_6;
  if (
    diffInMilliseconds <= BigInt(Number.MAX_SAFE_INTEGER) &&
    diffInMilliseconds >= BigInt(Number.MIN_SAFE_INTEGER)
  ) {
    return Number(diffInMilliseconds);
  }
  return Number.MAX_SAFE_INTEGER;
}

/**
 * Subscribe to all the topics in the handlerSpecs array with the given ack behavior.
 */
export async function subscribe<
  SLocals extends AnyServiceLocals,
  HandlerAck extends AckType = 'auto',
>(
  app: ServiceExpress<SLocals>,
  options: HandlerAck | SesameSubscriptionOptions<HandlerAck>,
  ...handlerSpecs: (TopicHandler<HandlerAck, SLocals> | SubscriptionHandler<HandlerAck, SLocals>)[]
) {
  const activeCounter = app.locals.meter.createUpDownCounter('pubsub_active_handlers', {
    description: 'The number of active pubsub handlers',
  });
  const requestCounter = app.locals.meter.createCounter('pubsub_handler_requests', {
    description: 'The number of pubsub messages received by the handler ever',
  });
  const errorCounter = app.locals.meter.createCounter('pubsub_handler_errors', {
    description: 'The number of pubsub messages that failed to be acked',
  });
  const durationHistogram = app.locals.meter.createHistogram('pubsub_handler_duration', {
    description: 'The time it takes to process a pubsub message',
    unit: 'ms',
  });
  const totalDurationHistogram = app.locals.meter.createHistogram(
    'pubsub_publish_to_handle_duration',
    {
      description: 'The time it takes to process a pubsub message from publish to handle',
      unit: 'ms',
    },
  );
  const receiptDurationHistogram = app.locals.meter.createHistogram('pubsub_receipt_duration', {
    description: 'The time it takes to receive a pubsub message',
    unit: 'ms',
  });

  const pubsub = getPubSubClient(app);
  const { ack, noLog, ...googleOptions } = typeof options == 'string' ? { ack: options } : options;

  const subscriptions = await pmap(
    handlerSpecs,
    async (spec) => {
      const subscriptionName = getSubscriptionName(app.locals.name, spec);
      const subscription = pubsub.subscription(subscriptionName, googleOptions);
      await subscription.getMetadata();
      return subscription;
    },
    { concurrency: 3 },
  );

  let shuttingDown = false;
  const preLog = !noLog && app.locals.config?.logging?.preLog;

  subscriptions.forEach((subscription, ix) => {
    if (!subscription.metadata?.topic) {
      throw new Error('Could not retrieve metadata for subscription');
    }
    const spec = handlerSpecs[ix];
    const labels = { service: app.locals.name, topic: topicName(subscription.metadata.topic) };
    let messageCount = 0;
    subscription.on('message', (message) => {
      messageCount += 1;
      const start = Date.now();

      if (preLog) {
        app.locals.logger.info(
          {
            t: 'pre',
            msgId: message.id,
          },
          labels.topic,
        );
      }

      let interval: ReturnType<typeof setInterval> | undefined;
      try {
        interval =
          spec.heartbeatInterval !== -1
            ? setInterval(() => {
              app.locals.logger.info(
                {
                  messageId: message.id,
                  sub: subscription.name,
                  durationMs: Date.now() - start,
                },
                'Long-running message',
              );
            }, spec.heartbeatInterval || DEFALUT_HEARTBEAT_INTERVAL)
            : undefined;
        activeCounter.add(1, labels);
        requestCounter.add(1, labels);
        receiptDurationHistogram.record(since(message.publishTime), labels);
        if (spec.debug) {
          app.locals.logger.info(
            { sub: subscription.name, messageId: message.id },
            'Received pubsub message',
          );
        }
      } catch (error) {
        try {
          app.locals.logger.error(error, 'Failed to set context for pubsub message');
        } catch {
          /* Do nothing */
        }
        message.nack();
        return;
      }

      let outcome = 'unknown';
      const context: PubSubHandlerContext = { logFields: {} };

      Promise.resolve()
        .then(() => spec.handler(app, message, context) as Promise<HandlerReturnType<HandlerAck>>)
        .then((result) => {
          outcome = 'ack';
          // This environment variable is used for debugging so you don't have to keep resending messages
          if (process.env.PUBSUB_NO_ACK) {
            app.locals.logger.warn(
              {
                t: 'req',
                msgId: message.id,
                ...context.logFields,
              },
              'PUBSUB_NO_ACK is set, successfully processed message will not be acked',
            );
          } else if (ack === 'auto' || (ack === 'ACK' && result === ACK)) {
            if (!noLog) {
              app.locals.logger.info(
                {
                  t: 'req',
                  a: 'ack',
                  msgId: message.id,
                  ...context.logFields,
                },
                labels.topic,
              );
            }
            message.ack();
          } else if (ack === 'ACK' && result !== ACK) {
            outcome = 'nack';
            if (!noLog) {
              app.locals.logger.info(
                {
                  t: 'req',
                  a: 'nack',
                  msgId: message.id,
                  ...context.logFields,
                },
                labels.topic,
              );
            }
            message.nack();
          }
        })
        .catch((error) => {
          outcome = 'nack';
          try {
            errorCounter.add(1, labels);
            const errorObj =
              error instanceof Error
                ? error
                : new Error(typeof error === 'string' ? error : 'unknown failure');
            app.locals.logger.error(
              Object.assign(errorObj, { sub: subscription.name, msgId: message.id }),
              'Failed to process pubsub message',
            );
          } catch {
            // Do nothing, we tried.
          }
          if (ack !== 'manual') {
            message.nack();
          }
        })
        .finally(() => {
          if (interval !== undefined) {
            clearInterval(interval);
          }
          activeCounter.add(-1, labels);
          durationHistogram.record(Date.now() - start, { ...labels, outcome });
          totalDurationHistogram.record(since(message.publishTime), { ...labels, outcome });
          if (spec.debug) {
            app.locals.logger.info(
              { sub: subscription.name, messageId: message.id, outcome },
              'Processed pubsub message',
            );
          }
        });
    });

    if (spec.debug) {
      subscription.on('debug', (msg) => app.locals.logger.info(msg, `${subscription.name} debug`));
    }

    subscription.on('close', () => {
      if (shuttingDown) {
        app.locals.logger.info({ sub: subscription.name, messageCount }, 'Subscription shutdown');
      } else {
        app.locals.logger.error(
          { sub: subscription.name, messageCount },
          'Subscription closed unexpectedly',
        );
      }
    });

    subscription.on('removeListener', (event) =>
      app.locals.logger.info({ event }, 'Subscription listener removed'),
    );

    subscription.on('error', (e) => app.locals.logger.error(e, 'Subscription error'));
  });

  return {
    pubsub,
    shutdown: async () => {
      shuttingDown = true;
      await Promise.all(subscriptions.map((sub) => sub.close()));
      await closePubSubClient(app);
    },
  };
}

export async function subscribeWithAutoAck<SLocals extends AnyServiceLocals>(
  app: ServiceExpress<SLocals>,
  ...handlerSpecs: (TopicHandler<'auto', SLocals> | SubscriptionHandler<'auto', SLocals>)[]
) {
  return subscribe(app, { ack: 'auto' }, ...handlerSpecs);
}

export async function subscribeWithPositiveACK<SLocals extends AnyServiceLocals>(
  app: ServiceExpress<SLocals>,
  ...handlerSpecs: (TopicHandler<'ACK', SLocals> | SubscriptionHandler<'ACK', SLocals>)[]
) {
  return subscribe(app, { ack: 'ACK' }, ...handlerSpecs);
}

export async function subscribeWithAutoAckWithOptions<SLocals extends AnyServiceLocals>(
  app: ServiceExpress<SLocals>,
  options: SubscriptionOptions,
  ...handlerSpecs: (TopicHandler<'auto', SLocals> | SubscriptionHandler<'auto', SLocals>)[]
) {
  return subscribe(app, { ack: 'auto', ...options }, ...handlerSpecs);
}

export async function subscribeWithPositiveACKWithOptions<SLocals extends AnyServiceLocals>(
  app: ServiceExpress<SLocals>,
  options: SubscriptionOptions,
  ...handlerSpecs: (TopicHandler<'ACK', SLocals> | SubscriptionHandler<'ACK', SLocals>)[]
) {
  return subscribe(app, { ack: 'ACK', ...options }, ...handlerSpecs);
}

export async function peekMessages<SLocals extends AnyServiceLocals>(
  app: ServiceExpress<SLocals>,
  options: { messages?: number; topic: string } | { messages?: number; subscription: string },
) {
  const pubsub = getPubSubClient(app);
  const name =
    'subscription' in options
      ? options.subscription
      : getSubscriptionName(app.locals.name, { topic: options.topic, handler: () => { } });
  const client = new v1.SubscriberClient();
  const projectId = pubsub.projectId;
  const subPath = client.subscriptionPath(projectId, name);
  // fetch one msg, no ack
  const [resp] = await client.pull({
    subscription: subPath,
    maxMessages: options.messages || 1,
    returnImmediately: true,
  });
  const received = resp.receivedMessages;
  if (!received?.length) {
    throw new Error('No messages available');
  }
  return received;
}

export async function getSingleMessage<SLocals extends AnyServiceLocals>(
  app: ServiceExpress<SLocals>,
  topic: string,
) {
  return peekMessages(app, { topic }).then((messages) => messages?.[0]);
}
