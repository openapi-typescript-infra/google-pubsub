declare module 'google-pubsub-emulator' {
  export interface EmulatorOptions {
    project: string;
    debug?: boolean;
    topics: string[];
  }

  // eslint-disable-next-line import/no-default-export
  export default class PubSubEmulator {
    constructor(options?: EmulatorOptions);
    start(): Promise<void>;
    stop(): Promise<void>;
  }
}
