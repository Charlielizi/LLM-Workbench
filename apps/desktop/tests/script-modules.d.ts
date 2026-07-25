declare module "../../../scripts/summarize-provider-smoke.mjs" {
  export interface ProviderSmokeSummaryRow {
    provider: string;
    outcome: string;
    failurePhase: string;
    failureCode: string;
    reason: string;
    path: string;
  }

  export function resolveProviderId(provider: string): string;
  export function getUserDataDirs(explicitDir?: string): string[];
  export function getLatestExistingResult(
    providerId: string,
    userDataDirs: string[],
  ): Promise<{ path: string; json: unknown } | null>;
  export function summarizeResult(
    provider: string,
    result: { path: string; json: unknown } | null,
  ): ProviderSmokeSummaryRow;
  export function parseCliArgs(argv: string[]): {
    providers: string[];
    userDataDir: string;
  };
  export function buildSummaryRows(input?: {
    providers?: string[];
    userDataDir?: string;
  }): Promise<ProviderSmokeSummaryRow[]>;
  export function formatMarkdownTable(rows: ProviderSmokeSummaryRow[]): string;
}
