import { gcpProjectId, topic } from '../src/test-consts';

import Emulator from 'google-pubsub-emulator';


const emulator: Emulator = new Emulator({
  project: gcpProjectId,
  topics: [`projects/${gcpProjectId}/topics/${topic}`],
});

const START_TIMEOUT_MS = 30_000;

export async function setup() {
  try {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error(
              `PubSub emulator failed to start within ${START_TIMEOUT_MS}ms — is gcloud's beta component installed and is a JRE on PATH?`,
            ),
          ),
        START_TIMEOUT_MS,
      );
    });
    try {
      await Promise.race([emulator.start(), timeout]);
    } finally {
      if (timer) { clearTimeout(timer); }
    }
  } catch (e) {
    if (!(e as Error).message.includes('already in use')) {
      // eslint-disable-next-line no-console
      console.error('Failed to start emulator', e);
      throw e;
    }
  }
}

export async function teardown() {
  try {
    await emulator.stop();
  } catch {
    // Ignore
  }
}