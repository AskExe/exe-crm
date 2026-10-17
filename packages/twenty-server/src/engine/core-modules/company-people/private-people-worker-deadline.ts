import { type PrivatePeopleDeadline } from './private-people-contract';
import { peopleMonotonicNow } from './private-people-protocol';

export class WorkerDeadline implements PrivatePeopleDeadline {
  private controller = new AbortController();
  private timer?: ReturnType<typeof setTimeout>;
  readonly signal = this.controller.signal;
  constructor(private end: number) {
    this.arm();
  }
  shrink(absoluteEnd: number) {
    this.end = Math.min(this.end, absoluteEnd);
    this.arm();
  }
  private arm() {
    clearTimeout(this.timer);
    const left = this.end - peopleMonotonicNow();
    if (left <= 0) this.controller.abort();
    else this.timer = setTimeout(() => this.controller.abort(), left);
  }
  remaining() {
    const left = Math.floor(this.end - peopleMonotonicNow());
    if (this.signal.aborted || left < 1)
      throw new Error('Private people original worker end');
    return left;
  }
  close() {
    clearTimeout(this.timer);
    this.controller.abort();
  }
}
