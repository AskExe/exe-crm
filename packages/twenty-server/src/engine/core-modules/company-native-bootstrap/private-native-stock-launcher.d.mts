export function run(): Promise<Readonly<Record<string, unknown>>>;
export function launcherFailureStderr(error: unknown): string;
export function reportLauncherFailure(error: unknown): boolean;
