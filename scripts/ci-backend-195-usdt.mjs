/** Explicit shared-run CI connector. No --plan/default action executes tests. */
import { spawnSync,execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync,writeFileSync,realpathSync,lstatSync } from "node:fs";
import { resolve,dirname,isAbsolute,relative } from "node:path";
import { fileURLToPath,pathToFileURL } from "node:url";
import { assertUsdt195CiBridgeSources } from "./ci-backend-195-usdt-source.mjs";
import { assertUsdt195CiArtifacts } from "./ci-backend-195-usdt-artifacts.mjs";
import { planBackend195Gates } from "./ci-backend-195.mjs";
import { collectCiSourceEvidence } from "./ci-source-evidence.mjs";
import { parseUsdt195RunnerArguments } from "./usdt-manual-195-results.mjs";
import { buildKrw195Fixture,buildPrincipal195Fixture,buildConcurrency195Fixture,USDT_195_FROZEN_SOURCES } from "./usdt-manual-195-native-fixture.mjs";
const ROOT=realpathSync(fileURLToPath(new URL("../",import.meta.url)));
const hash=value=>createHash("sha256").update(value).digest("hex");
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const fail=reason=>{throw Error("USDT195_CI_"+reason);};
export function planBackend195UsdtCi(boundary){
  const original=planBackend195Gates(boundary);
  const group="usdt195-native-concurrency";
  return Object.freeze({...original,connector:"SINGLE_RUN_AUTHORED_NOT_TESTED",
    gates:Object.freeze(original.gates.map(g=>{
      if(g.id==="native195"||g.id==="externalSendConcurrency195")return Object.freeze({
        id:g.id,required:true,action:"shared-artifact",executionGroup:group,
        phases:Object.freeze(g.id==="native195"?["krw","principal"]:["concurrency"]),
      });
      return Object.freeze({...g,action:"command",
        command:Object.freeze(g.id==="unit195"?[...g.command,
          "tests/unit/usdt-manual-195-runner.test.ts",
          "tests/unit/ci-backend-195-usdt-artifacts.test.ts",
          "tests/unit/withdrawal-release-hold-receipt.test.ts"]:g.command)});
    })),
    executionGroups:Object.freeze([Object.freeze({id:group,owns:Object.freeze(["native195","externalSendConcurrency195"]),
      executions:1,entry:"scripts/ci-backend-195-usdt.mjs",arguments:"EXPLICIT_RUNNER_FLAGS_REQUIRED",
      output:"NEW_EXTERNAL_ARTIFACT_DIRECTORY",retry:"FORBIDDEN_SAME_CONTAINER"})]),
    integrationPending:Object.freeze([...original.integrationPending,
      "Existing workflow/database job is not replaced or registered by this connector",
      "Runner must precede any committed money/auth fixture in a fresh owned DB",
      "Raw SQL/Python stdout is not retained by the frozen runner; stored proof consumption only",
      "HOLD release readback patch requires a separately identified candidate revision",
      "Whole17-job/20-minute budget, HTTP/Auth/Worker and release remain unverified"]),
  });
}
function contextSource(){
  return collectCiSourceEvidence(process.env,(...args)=>execFileSync("git",["--no-optional-locks",...args],{
    cwd:ROOT,encoding:"utf8",windowsHide:true,timeout:30000,maxBuffer:1024*1024}).trim());
}
function ownedArtifact(output,name){
  if(!["execution.json","artifact-manifest.json","krw.sql","principal.sql","concurrency.py"].includes(name))fail("ARTIFACT_NAME_REJECTED");
  const file=resolve(output,name);
  if(lstatSync(file).isSymbolicLink())fail("ARTIFACT_LINK_REJECTED");
  const actual=realpathSync(file),loc=relative(output,actual);
  if(isAbsolute(loc)||loc!==name)fail("ARTIFACT_PATH_REJECTED");
  const bytes=readFileSync(actual);
  if(bytes.length>8*1024*1024)fail("ARTIFACT_SIZE_REJECTED");
  return bytes;
}
function derivatives(){
  const result={};
  for(const [kind,build] of [["krw",buildKrw195Fixture],["principal",buildPrincipal195Fixture],["concurrency",buildConcurrency195Fixture]]){
    const derivative=build(readFileSync(resolve(ROOT,USDT_195_FROZEN_SOURCES[kind].path)),{fullPayoutConfirmed:true});
    result[kind]={originalSha256:USDT_195_FROZEN_SOURCES[kind].sha256,sha256:derivative.sha256,
      changes:derivative.changes.map(c=>({name:c.name,beforeSha256:c.beforeSha256,afterSha256:c.afterSha256,matches:c.matches}))};
  }
  return result;
}
function safeFailure(error){return /^USDT195_CI_[A-Z0-9_]+$/.test(error?.message??"")?error.message:"USDT195_CI_CONNECTION_UNCONFIRMED";}
function recordFailedChild(output,parameters,source,startedAt,finishedAt,result){
  const metadata={kind:"USDT195_CI_CHILD_FAILURE",state:"UNCONFIRMED",source,
    startedAt,finishedAt,exitCode:result.status,signal:result.signal??null,
    timedOut:result.error?.code==="ETIMEDOUT",stdoutSha256:hash(result.stdout??""),
    stderrSha256:hash(result.stderr??""),databaseOutcome:"UNKNOWN",partialCommitsPossible:true,
    automaticRetry:false,release:"NOT_VERIFIED",artifactWritten:false};
  try{
    const allowed=process.platform==="win32"?"D:/PUTDUK-MINING-QA":process.env.RUNNER_TEMP;
    if(typeof allowed==="string"&&resolve(dirname(output))===resolve(allowed)&&
      /^putduk-mining-usdt195-[0-9a-f-]{36}$/.test(output.split(/[\\/]/).at(-1)??"")&&
      !lstatSync(output).isSymbolicLink()&&realpathSync(output)===output){
      const original=JSON.parse(ownedArtifact(output,"execution.json").toString("utf8"));
      if(original.kind==="USDT195_NATIVE_CONCURRENCY_EXECUTION"&&equal(original.source,source)&&
        Number.isSafeInteger(original.startedAt)&&original.startedAt>=startedAt&&original.startedAt<=finishedAt){
        const path=resolve(output,"ci-connection-failure.json");
        writeFileSync(path,JSON.stringify({...metadata,artifactWritten:true,expectedContainerId:parameters.containerId},null,2)+"\n",{flag:"wx"});
        metadata.artifactWritten=true;
      }
    }
  }catch{/* Safe metadata still goes to the current CLI log. Never overwrite another attempt. */}
  console.error(JSON.stringify(metadata)); // No raw SQL, credential or child stderr is exposed.
}
function main(){
  const scope=process.platform==="win32"?"LOCAL_QA":"CANONICAL_CI";
  const args=process.argv.slice(2);
  // --plan is future read-only source/Git inspection, not a test result.
  if(args.length===1&&args[0]==="--plan"){
    const reviewed=assertUsdt195CiBridgeSources(ROOT,"CANONICAL_CI");
    console.log(JSON.stringify({...planBackend195UsdtCi(reviewed.candidate),source:contextSource()},null,2));return;
  }
  const parameters=parseUsdt195RunnerArguments(args);
  if(process.env.APP_ENV!=="test"||process.env.NODE_OPTIONS||process.env.NODE_PATH)fail("TEST_ENV_WITHOUT_NODE_OVERRIDE_REQUIRED");
  const reviewed=assertUsdt195CiBridgeSources(ROOT,scope),source=contextSource();
  const output=resolve(parameters.output);
  const env={};
  for(const key of ["PATH","Path","SystemRoot","WINDIR","TEMP","TMP","HOME","USERPROFILE","LANG","LC_ALL",
    "CI","GITHUB_ACTIONS","GITHUB_REPOSITORY","GITHUB_JOB","GITHUB_WORKSPACE","GITHUB_SHA","GITHUB_EVENT_NAME",
    "GITHUB_RUN_ID","GITHUB_RUN_ATTEMPT","CI_HEAD_SHA","RUNNER_TEMP","APP_ENV",
    "DOCKER_HOST","DOCKER_TLS_VERIFY","DOCKER_CERT_PATH"])
    if(process.env[key]!==undefined)env[key]=process.env[key];
  const startedAt=Date.now();
  const result=spawnSync(process.execPath,[resolve(ROOT,"scripts/usdt-manual-195-runner.mjs"),...args],{
    cwd:ROOT,env,shell:false,encoding:"utf8",windowsHide:true,timeout:18*60*1000,maxBuffer:1024*1024});
  const finishedAt=Date.now();
  // No retry, no DB cleanup, no timeout interpreted as rollback.
  if(result.error||result.signal||result.status!==0){
    recordFailedChild(output,parameters,source,startedAt,finishedAt,result);
    fail("RUNNER_FAILED_DATABASE_OUTCOME_UNKNOWN");
  }
  let summary;try{summary=JSON.parse(result.stdout);}catch{fail("RUNNER_SINGLE_SUMMARY_REQUIRED");}
  if(!equal(Object.keys(summary).sort(),["output","release","state"])||
    summary.state!=="PASSED"||summary.release!=="NOT_VERIFIED"||resolve(summary.output)!==output)
    fail("RUNNER_SUMMARY_MISMATCH");
  if(lstatSync(output).isSymbolicLink()||realpathSync(output)!==output)fail("OUTPUT_LINK_REJECTED");
  const bundle={manifest:ownedArtifact(output,"artifact-manifest.json"),files:{}};
  for(const name of ["execution.json","krw.sql","principal.sql","concurrency.py"])bundle.files[name]=ownedArtifact(output,name);
  const after=assertUsdt195CiBridgeSources(ROOT,scope);
  if(after.bridgeManifestSha256!==reviewed.bridgeManifestSha256||!equal(contextSource(),source))fail("SOURCE_CHANGED_DURING_RUN");
  const report=JSON.parse(bundle.files["execution.json"].toString("utf8"));
  const leaseFile=resolve(dirname(output),".usdt195-container-"+parameters.containerId+".lock");
  if(lstatSync(leaseFile).isSymbolicLink())fail("RUNNER_LEASE_REJECTED");
  const lease=JSON.parse(readFileSync(leaseFile,"utf8"));
  if(!equal(Object.keys(lease).sort(),["containerId","output","runId"])||
    lease.runId!==report.runId||lease.output!==output||lease.containerId!==parameters.containerId)
    fail("EXACT_RETAINED_RUNNER_LEASE_REQUIRED");
  const proof=assertUsdt195CiArtifacts(bundle,{scope,source,boundary:reviewed.candidate,
    expectedContainerId:parameters.containerId,startedAt,finishedAt,childExitCode:result.status,
    childStdoutSha256:hash(result.stdout),childStderrSha256:hash(result.stderr),
    expectedDerivatives:derivatives(),
    launcherSha256:hash(readFileSync(resolve(ROOT,"scripts/usdt-manual-195-concurrency-bootstrap.py"))),
    concurrencyContract:JSON.parse(readFileSync(resolve(ROOT,"tests/e2e/fixtures/usdt-manual-195-concurrency-contract.json"),"utf8"))});
  const stored={version:1,...proof,bridgeManifestSha256:reviewed.bridgeManifestSha256,
    startedAt,finishedAt,childExitCode:result.status,childStdoutSha256:hash(result.stdout),
    childStderrSha256:hash(result.stderr),httpAuth:"NOT_TESTED",uiIntegration:"PENDING"};
  const bytes=Buffer.from(JSON.stringify(stored,null,2)+"\n");
  writeFileSync(resolve(output,"ci-native-concurrency.json"),bytes,{flag:"wx"});
  writeFileSync(resolve(output,"ci-native-concurrency.sha256"),hash(bytes)+"  ci-native-concurrency.json\n",{flag:"wx"});
  console.log(JSON.stringify({artifactContract:"VALIDATED",scope,gates:proof.gates.map(g=>g.id),
    output,release:"NOT_VERIFIED",wholeCi:"NOT_INTEGRATED"}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{main();}catch(error){console.error(safeFailure(error));process.exitCode=1;}
}
