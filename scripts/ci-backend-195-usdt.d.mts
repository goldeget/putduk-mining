import type { BackendHttp195SourceBoundary } from "./backend-http-195-source.mjs";
export function planBackend195UsdtCi(boundary:BackendHttp195SourceBoundary):Readonly<{
  state:string;connector:string;gates:readonly Readonly<{
    id:string;required:boolean;action:string;command?:readonly string[];executionGroup?:string;phases?:readonly string[];
  }>[];
  executionGroups:readonly Readonly<{id:string;owns:readonly string[];executions:number;entry:string;arguments:string;output:string;retry:string}>[];
  integrationPending:readonly string[];
}>;
