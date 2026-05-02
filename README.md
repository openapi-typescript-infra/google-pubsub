# google-pubsub

A set of (currently) simple helpers for Google pubsub in OpenApi-Typescript-Infra services.

## Publishing messages

This module provides a typed helper for publishing messages to topics. First, define an interface that associates topic names with message types:

```typescript
interface MyTopics {
  some_cool_topic: {
    something: string;
    works: boolean;
  };
  'some-other-topic': {
    everything: { everywhere: { allAtOnce: boolean } };
  };
}
```

Now, create a publisher (and probably attach it to app.locals in your service startup):

```typescript
app.locals.pubsub = createPublisher<MyTopics>(app);
```

And then, whenever you need to publish something, you will get type safety on both the topic name and the message format:

```typescript
await app.locals.pubsub.publish('some_cool_topic', { something: 'should', works: true });

// Typescript will complain at these things
await app.locals.pubsub.publish('bad_topic', { something: 'should', works: true });
await app.locals.pubsub.publish('some_cool_topic', 'total madness');
```

## Subscriptions

The subscribe method sets up a set of topic handlers and handles automatically acking/nacking messages depending on the outcome of your (often asynchronous handler). The AckType controls the behavior and can have one of these options:

- auto - the default, acks if your handler completes without throwing an exception.
- ACK - acks ONLY if your handler returns the ACK symbol from this module. nacks if it returns anything else, or if it throws
- manual - does not ack or nack, no matter what. It's up to you to handle the message outcome. This is not recommended but provided for completeness.

## Utilities

`yarn pubsubdev sub [topics]` - add a subscription to the specified topics. The name of the subscription will be the topic name plus the PUBSUB_SUB_SUFFIX environment variable, or the current username if that is not set. Note that the runtime subscription code will ALSO look at that environment variable when automatically determining the subscription name from the topic name. In this way, you can automatically engage a separate subscription with the env var and a call to this utility.

`yarn pubsubdev unsub [topics]` - remove the subscription to the specifieid topics.

The intention of these tools is to allow you to have your local service receive the _actual_ messages sent by other development components (think of the email use case). You shouldn't use these in unit tests generally, and instead use traditional mocking for that.