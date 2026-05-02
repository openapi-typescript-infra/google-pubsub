#!/usr/bin/env node
/* eslint-disable no-console */
import { userInfo } from 'os';
import * as readline from 'readline';
import { readFileSync } from 'fs';

import { PubSub } from '@google-cloud/pubsub';

// Creates a client; credentials are taken from the environment.
const pubSubClient = new PubSub();

function getSubscriptionName(topicName: string) {
  return `${topicName}-${process.env.PUBSUB_SUB_SUFFIX || userInfo().username}`;
}

/**
 * Usage:
 *   pubsubdev <command> [...topics]
 *
 * Commands:
 *  pubsubdev sub [...topics]                          - Subscribe to topics
 *  pubsubdev unsub [...topics]                        - Unsubscribe from topics
 *  pubsubdev send topic [message_file or - for stdin] - Send a message to a topic
 */
async function createSubscription(topicName: string): Promise<string> {
  const subscriptionName = getSubscriptionName(topicName);
  await pubSubClient.topic(topicName).createSubscription(subscriptionName);
  console.log(`Subscription ${subscriptionName} created for topic ${topicName}.`);
  return `Subscription ${subscriptionName} created.`;
}

async function deleteSubscription(topicName: string): Promise<string> {
  const subscriptionName = getSubscriptionName(topicName);
  await pubSubClient.subscription(subscriptionName).delete();
  console.log(`Subscription ${subscriptionName} deleted.`);
  return `Subscription ${subscriptionName} deleted successfully.`;
}

function readFromStdin(): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.on('line', (input) => {
      resolve(input);
      rl.close();
    });
  });
}

async function run() {
  const command = process.argv[2];
  if (command === 'sub') {
    const topics = process.argv.slice(3);
    await Promise.all(topics.map(async (topic) => createSubscription(topic)));
  } else if (command === 'unsub') {
    const topics = process.argv.slice(3);
    await Promise.all(topics.map(async (topic) => deleteSubscription(topic)));
  } else if (command === 'send') {
    const topicName = process.argv[3];
    const topic = pubSubClient.topic(topicName);
    let messageId;
    if (!process.stdin.isTTY) {
      const message = await readFromStdin();
      messageId = await topic.publishMessage({ data: Buffer.from(message) });
    } else {
      const message = readFileSync(process.argv[4]);
      messageId = await topic.publishMessage({ data: message });
    }
    console.log(`Message ${messageId} published.`);
  }
}

run().catch((error) => {
  console.error(error);
});
