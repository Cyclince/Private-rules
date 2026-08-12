import type { BackgroundTaskPort } from '../../application/ports/background-task';

export class NodeBackgroundTaskAdapter implements BackgroundTaskPort {
  private accepting = true;
  private readonly tasks = new Set<Promise<unknown>>();

  schedule(task: Promise<unknown>) {
    if (!this.accepting) return;
    this.tasks.add(task);
    void task.catch(() => undefined).finally(() => this.tasks.delete(task));
  }

  async close() {
    this.accepting = false;
    await Promise.allSettled(this.tasks);
  }
}
