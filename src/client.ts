import type { ClientConfig, PublishOptions, Topic } from '@google-cloud/pubsub';
import { PubSub } from '@google-cloud/pubsub';
import type {
  ServiceExpress,
  AnyServiceLocals,
  ConfigurationSchema,
  ServiceLocals,
} from '@openapi-typescript-infra/service';

const pubsubClientsByProjectId: Record<string, PubSub> = {};

interface UndocumentedClientConfig extends ClientConfig {
  'grpc.keepalive_timeout_ms'?: number;
  'grpc.keepalive_time_ms'?: number;
}

type PublicClientConfig = Omit<UndocumentedClientConfig, 'projectId'>;

/**
 * Get the app-wide pubsub client. This is a singleton per GCP project
 * because there is little point in multiple. If you want multiple, just
 * make your own.
 */
export function getPubSubClient<
  SLocals extends AnyServiceLocals = ServiceLocals<ConfigurationSchema>,
>(app: ServiceExpress<SLocals>, config: PublicClientConfig = {}) {
  const projectId = (app.locals as unknown as { gcpProjectId: string }).gcpProjectId;
  if (!pubsubClientsByProjectId[projectId]) {
    const fullConfig: UndocumentedClientConfig = Object.assign(
      {
        'grpc.keepalive_timeout_ms': 10000,
        'grpc.keepalive_time_ms': 30000,
        enableOpenTelemetryTracing: true,
      },
      config,
      { projectId },
    );
    pubsubClientsByProjectId[projectId] = new PubSub(fullConfig);
  }
  return pubsubClientsByProjectId[projectId];
}

export async function closePubSubClient(app: ServiceExpress<AnyServiceLocals>) {
  const projectId = (app.locals as unknown as { gcpProjectId: string }).gcpProjectId;
  if (pubsubClientsByProjectId[projectId]) {
    const client = pubsubClientsByProjectId[projectId];
    delete pubsubClientsByProjectId[projectId];
    await client.close();
  }
}

type MessageOptions = Omit<Parameters<Topic['publishMessage']>[0], 'json'>;

/**
 * Generate a typed message publisher for the given topics.
 *
 * @example
 *  const pubsub = createPublisher<{ topic1: MessageType1, topic2: MessageType2 }>(app);
 *  pubsub.publish('topic1', somethingOfMessageType1);
 */
export function createPublisher<T extends { [K in keyof T]: unknown }>(
  app: ServiceExpress<AnyServiceLocals>,
  config?: PublicClientConfig,
  topicOptions?: Record<keyof T, PublishOptions>,
) {
  const client = getPubSubClient(app, config);
  return {
    publish<K extends keyof T & string>(topic: K, message: T[K], options?: MessageOptions) {
      return client
        .topic(topic, topicOptions?.[topic])
        .publishMessage({ ...options, json: message });
    },
  };
}
