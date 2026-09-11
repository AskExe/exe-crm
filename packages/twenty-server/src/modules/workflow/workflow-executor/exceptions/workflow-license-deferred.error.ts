/** The current step was not started; its license check has been requeued. */
export class WorkflowLicenseDeferredError extends Error {
  constructor() {
    super('Installation license verification is temporarily unavailable');
  }
}
