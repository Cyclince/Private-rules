export interface BackgroundTaskPort {
  schedule(task: Promise<unknown>): void;
  close?(): Promise<void>;
}

export class ImmediateBackgroundTaskAdapter implements BackgroundTaskPort {
  schedule(task: Promise<unknown>) {
    void task.catch(() => undefined);
  }
}
