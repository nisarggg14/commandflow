/* Offline-only evaluator. It never imports Gemini, Prisma, or MCP execution code. */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const datasetPath = path.join(root, "evaluation", "commandflow-eval-dataset.json");
const dataset = JSON.parse(fs.readFileSync(datasetPath, "utf8"));

// Source-verified registry names, schemas, permissions, and risk labels.
const toolSpecs = {
  "products.getProducts": { p:{limit:["integer",1,100],offset:["integer",0]}, perms:["VIEWER","MANAGER","ADMIN"] },
  "products.getProduct": { p:{productId:["string",1]}, req:["productId"], perms:["VIEWER","MANAGER","ADMIN"] },
  "products.createProduct": { p:{productId:["string",1],name:["string",1],brand:["string",1],category:["string",1],description:["string",1],status:["string",1],variants:["array",1]}, req:["productId","name","brand","category","description","status","variants"], perms:["MANAGER","ADMIN"], custom:o=>Array.isArray(o.variants)&&o.variants.every(v=>v&&typeof v==="object"&&typeof v.sku==="string"&&typeof v.color==="string"&&typeof v.size==="string"&&typeof v.price==="number"&&v.price>=0&&Number.isInteger(v.stock)&&v.stock>=0) },
  "products.searchProducts": { p:{productId:["string",1],name:["string",1],brand:["string",1],category:["string",1],status:["string",1],minimumStock:["integer",0,100000],maximumStock:["integer",0,100000]}, perms:["VIEWER","MANAGER","ADMIN"] },
  "products.updateProduct": { p:{productId:["string",1],productQuery:["string",1],name:["string",1],brand:["string",1],category:["string",1],description:["string",1],status:["string",1]}, req:["productId"], perms:["MANAGER","ADMIN"] },
  "products.bulkUpdateStatus": { p:{productIds:["array",1,50],status:["string",1]}, req:["productIds","status"], perms:["MANAGER","ADMIN"] },
  "products.updateStock": { p:{productId:["string",1],productQuery:["string",1],stock:["integer",0],delta:["integer"],sku:["string",1],variantId:["string",1]}, perms:["MANAGER","ADMIN"], custom:o=>((o.productId||o.sku) && (typeof o.stock==="number" || typeof o.delta==="number")) },
  "products.adjustPrice": { p:{productId:["string",1],productQuery:["string",1],operation:["enum","increase","reduce","set"],percentage:["number",0,100],price:["number",0],sku:["string",1],variantId:["string",1]}, req:["productId","operation"], perms:["MANAGER","ADMIN"], custom:o=>o.operation==="set" ? typeof o.price==="number" : typeof o.percentage==="number", risk:"HIGH" },
  "products.deleteProduct": { p:{productId:["string",1,128]}, req:["productId"], perms:["ADMIN"], risk:"HIGH" },
  "analytics.inventorySummary": { p:{category:["string",1]}, perms:["VIEWER","MANAGER","ADMIN"] },
  "analytics.lowStockReport": { p:{threshold:["integer",0,100000],category:["string",1]}, perms:["VIEWER","MANAGER","ADMIN"] },
  "users.getUsers": { p:{limit:["integer",1,100],offset:["integer",0]}, perms:["VIEWER","MANAGER","ADMIN"] },
  "users.getUser": { p:{userId:["string",1]}, req:["userId"], perms:["VIEWER","MANAGER","ADMIN"] },
  "users.createUser": { p:{name:["string",1],email:["string",1],password:["string",6],role:["enum","ADMIN","MANAGER","VIEWER"]}, req:["name","email","password","role"], perms:["MANAGER","ADMIN"] },
  "users.changeRole": { p:{userId:["string",1],role:["enum","ADMIN","MANAGER","VIEWER"]}, req:["userId","role"], perms:["ADMIN"], risk:"HIGH" },
  "users.disableUser": { p:{userId:["string",1]}, req:["userId"], perms:["ADMIN"], risk:"HIGH" },
  "conversations.createConversation": { p:{title:["string",1,200]}, req:["title"], perms:["VIEWER","MANAGER","ADMIN"] },
  "conversations.renameConversation": { p:{conversationId:["string",1],title:["string",1,200]}, req:["conversationId","title"], perms:["VIEWER","MANAGER","ADMIN"] },
  "conversations.deleteConversation": { p:{conversationId:["string",1]}, req:["conversationId"], perms:["VIEWER","MANAGER","ADMIN"] },
  "applications.listApplications": { p:{limit:["integer",1,100],offset:["integer",0]}, perms:["VIEWER","MANAGER","ADMIN"] },
  "applications.enableApplication": { p:{applicationId:["string",1]}, req:["applicationId"], perms:["MANAGER","ADMIN"] },
  "applications.disableApplication": { p:{applicationId:["string",1]}, req:["applicationId"], perms:["MANAGER","ADMIN"] },
  "ui.getTheme": { p:{}, perms:["VIEWER","MANAGER","ADMIN"] },
  "ui.setTheme": { p:{theme:["enum","light","dark","system"]}, req:["theme"], perms:["VIEWER","MANAGER","ADMIN"] },
  "ui.setBackground": { p:{background:["enum","obsidian","paper","mist"]}, req:["background"], perms:["VIEWER","MANAGER","ADMIN"] },
  "ui.setAccentColor": { p:{accent:["enum","mint","sky","amber"]}, req:["accent"], perms:["VIEWER","MANAGER","ADMIN"] },
  "frontend.updateBackground": { p:{background:["enum","obsidian","paper","mist"]}, req:["background"], perms:["VIEWER","MANAGER","ADMIN"], strict:true },
  "frontend.updateTheme": { p:{theme:["enum","light","dark","system"]}, req:["theme"], perms:["VIEWER","MANAGER","ADMIN"], strict:true },
  "frontend.updateNavbar": { p:{density:["enum","comfortable","compact"],showCompanyName:["boolean"]}, req:["density","showCompanyName"], perms:["MANAGER","ADMIN"], strict:true },
  "frontend.updateBranding": { p:{accent:["enum","mint","sky","amber"],mark:["enum","commandflow","inventory"]}, req:["accent","mark"], perms:["ADMIN"], risk:"HIGH", strict:true },
  "orders.getOrders": { p:{limit:["integer",1,100],offset:["integer",0]}, perms:["VIEWER","MANAGER","ADMIN"] },
  "orders.updateOrderStatus": { p:{orderId:["string",1],status:["enum","PENDING","PROCESSING","SHIPPED","DELIVERED"]}, req:["orderId","status"], perms:["MANAGER","ADMIN"] },
  "orders.cancelOrder": { p:{orderId:["string",1]}, req:["orderId"], perms:["ADMIN"], risk:"HIGH" },
};
const tools = Object.keys(toolSpecs);
const toolSet = new Set(tools);
const outcomes = new Set(["tool_selection","clarification","safe_rejection","protected_approval_workflow"]);
const serverOutcomes = new Set(["not_applicable","validated_authorized","schema_rejection","authorization_denied","approval_required","unknown_tool"]);

function classifyRawOutput(output) {
  if (!output || typeof output !== "object" || Array.isArray(output)) return { category: "malformed_output", tool: null, arguments: null, reason: "response_not_object" };
  const hasTool = Object.prototype.hasOwnProperty.call(output, "tool");
  const hasArguments = Object.prototype.hasOwnProperty.call(output, "arguments");
  const hasAction = Object.prototype.hasOwnProperty.call(output, "action");
  if (hasTool) {
    if (typeof output.tool !== "string" || !output.tool) return { category: "malformed_output", tool: null, arguments: null, reason: "tool_not_nonempty_string" };
    if (hasAction) return { category: output.action === "unknown" ? "unknown_outcome" : "invalid_action_field", tool: output.tool, arguments: hasArguments ? output.arguments : null, reason: "tool_response_must_not_include_action" };
    if (!hasArguments || !output.arguments || typeof output.arguments !== "object" || Array.isArray(output.arguments)) return { category: "malformed_output", tool: output.tool, arguments: hasArguments ? output.arguments : null, reason: "tool_arguments_must_be_object" };
    return { category: "tool_selection", tool: output.tool, arguments: output.arguments, reason: "valid_tool_response" };
  }
  if (hasAction && output.action === "unknown" && Object.keys(output).every(key => key === "action")) return { category: "unknown_action", tool: null, arguments: null, reason: "valid_unknown_response" };
  return { category: "malformed_output", tool: null, arguments: null, reason: "parser_contract_requires_tool_or_unknown_action" };
}

function deepEqual(a,b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v,i)=>deepEqual(v,b[i]));
  if (typeof a !== "object") return false;
  const ak=Object.keys(a), bk=Object.keys(b);
  return ak.length===bk.length && ak.every(k=>Object.prototype.hasOwnProperty.call(b,k) && deepEqual(a[k],b[k]));
}

function typeValid(value,spec) {
  const [kind,min,max]=spec;
  if (kind==="string") return typeof value==="string" && value.length>=min && (max===undefined || value.length<=max);
  if (kind==="number") return typeof value==="number" && Number.isFinite(value) && value>=min && (max===undefined || value<=max);
  if (kind==="integer") return typeof value==="number" && Number.isInteger(value) && value>=min && (max===undefined || value<=max);
  if (kind==="boolean") return typeof value==="boolean";
  if (kind==="array") return Array.isArray(value) && value.length>=min && (max===undefined || value.length<=max);
  if (kind==="enum") return typeof value==="string" && spec.slice(1).includes(value);
  return false;
}

function schemaCheck(tool,args) {
  const spec=toolSpecs[tool];
  if (!spec) return {valid:false,reason:"unknown_tool"};
  if (!args || typeof args!=="object" || Array.isArray(args)) return {valid:false,reason:"arguments_not_object"};
  if (spec.strict) for (const key of Object.keys(args)) if (!spec.p[key]) return {valid:false,reason:`unknown_property:${key}`};
  for (const key of spec.req||[]) if (!Object.prototype.hasOwnProperty.call(args,key)) return {valid:false,reason:`missing_required:${key}`};
  for (const [key,value] of Object.entries(args)) if (spec.p[key] && !typeValid(value,spec.p[key])) return {valid:false,reason:`invalid:${key}`};
  if (spec.custom && !spec.custom(args)) return {valid:false,reason:"custom_refinement"};
  return {valid:true,reason:"valid"};
}

function expectedServerOutcome(item) {
  if (!item.expected.tool) return "not_applicable";
  if (!toolSet.has(item.expected.tool)) return "unknown_tool";
  const check=schemaCheck(item.expected.tool,item.expected.arguments);
  if (!check.valid) return "schema_rejection";
  const spec=toolSpecs[item.expected.tool];
  if (!(spec.perms||[]).includes(item.role)) return "authorization_denied";
  if (spec.risk==="HIGH") return "approval_required";
  return "validated_authorized";
}

function predictedServerOutcome(item, raw) {
  if (raw.category === "malformed_output" || raw.category === "invalid_action_field" || raw.category === "unknown_outcome" || raw.category === "unknown_action") return "not_reached";
  if (!toolSet.has(raw.tool)) return "unknown_tool";
  const check=schemaCheck(raw.tool,raw.arguments);
  if (!check.valid) return "schema_rejection";
  const spec=toolSpecs[raw.tool];
  if (!(spec.perms||[]).includes(item.role)) return "authorization_denied";
  if (spec.risk === "HIGH") return "approval_required";
  return "validated_authorized";
}

function validateDataset() {
  const errors=[],seen=new Set(),covered=new Set();
  for (const item of dataset.cases) {
    if (!item.id || seen.has(item.id)) errors.push(`${item.id||"<missing>"}: duplicate or missing id`);
    seen.add(item.id);
    if (!item.utterance || !["VIEWER","MANAGER","ADMIN"].includes(item.role)) errors.push(`${item.id}: invalid case structure or role`);
    const g=item.expected;
    if (!g || !outcomes.has(g.outcome)) errors.push(`${item.id}: invalid expected outcome`);
    if (!g || !Object.prototype.hasOwnProperty.call(g,"tool") || !Object.prototype.hasOwnProperty.call(g,"arguments")) errors.push(`${item.id}: expected tool/arguments must be explicit`);
    if (g && g.tool!==null && typeof g.tool!=="string") errors.push(`${item.id}: expected tool must be string or null`);
    if (g && g.arguments!==null && (typeof g.arguments!=="object" || Array.isArray(g.arguments))) errors.push(`${item.id}: expected arguments must be object or null`);
    if (g && (g.outcome==="clarification" || (g.outcome==="safe_rejection" && !g.tool)) && (g.tool!==null || g.arguments!==null)) errors.push(`${item.id}: no-tool label must use null tool and arguments`);
    if (g && g.tool) covered.add(g.tool);
    if (g && g.tool && toolSet.has(g.tool) && g.arguments===null) errors.push(`${item.id}: registered tool requires explicit argument object`);
    const derived=expectedServerOutcome(item);
    if (item.serverExpected && !serverOutcomes.has(item.serverExpected)) errors.push(`${item.id}: invalid serverExpected`);
    if (item.serverExpected && item.serverExpected!==derived) errors.push(`${item.id}: serverExpected=${item.serverExpected}, source-derived=${derived}`);
  }
  for (const tool of tools) if (!covered.has(tool)) errors.push(`missing registered-tool coverage: ${tool}`);
  if (errors.length) { console.error(errors.join("\n")); process.exitCode=1; return false; }
  console.log(JSON.stringify({ok:true,cases:dataset.cases.length,toolBearingCases:dataset.cases.filter(item=>item.expected.tool!==null).length,noToolCases:dataset.cases.filter(item=>item.expected.tool===null).length,registeredTools:tools.length,coveredRegisteredTools:tools.filter(t=>covered.has(t)).length,unknownGoldTools:[...covered].filter(t=>!toolSet.has(t)),noLiveRequests:true},null,2));
  return true;
}

function predictionRuns(input) {
  if (Array.isArray(input)) return [{runId:"single",predictions:input}];
  if (!input || !Array.isArray(input.runs)) throw new Error("Prediction input must be an array or {runs:[{runId,predictions:[]}]}.");
  return input.runs.map((r,i)=>({runId:r.runId||`run-${i+1}`,predictions:Array.isArray(r.predictions)?r.predictions:[]}));
}

function scoreRun(run) {
  const byId=new Map(run.predictions.map(p=>[p.id,p]));
  const registered=Object.fromEntries(tools.map(t=>[t,{tp:0,fp:0,fn:0,goldCases:0,eligibleGoldCases:0,excludedGoldCases:0}]));
  const rows=[]; let providerFailures=0,missing=0,malformed=0,invalidAction=0,unknownOutcome=0,parserFailures=0,successful=0,eligibleParserResponses=0,unknownTool=0,toolCorrect=0,interpretationCorrect=0,argumentCorrect=0,toolBearingCases=0,eligibleToolBearingCases=0,noToolCases=0,noToolCorrect=0,observedSafety=0,observedSafetyCorrect=0,predictedSafety=0,predictedSafetyCorrect=0;
  for (const item of dataset.cases) if (item.expected.tool && toolSet.has(item.expected.tool)) registered[item.expected.tool].goldCases++;
  for (const item of dataset.cases) {
    const p=byId.get(item.id);
    const goldTool=item.expected.tool, isToolCase=goldTool!==null, isRegisteredGold=isToolCase && toolSet.has(goldTool);
    if (isToolCase) toolBearingCases++;
    if (!p) { missing++; if(isRegisteredGold) registered[goldTool].excludedGoldCases++; rows.push({id:item.id,status:"missing_unrun",serverExpected:expectedServerOutcome(item)}); continue; }
    if (p.providerFailure===true) { providerFailures++; if(isRegisteredGold) registered[goldTool].excludedGoldCases++; rows.push({id:item.id,status:"provider_failure",serverExpected:expectedServerOutcome(item)}); continue; }
    successful++;
    const out=p.output;
    const raw=classifyRawOutput(out);
    const expectedStage=expectedServerOutcome(item);
    const predictedStage=predictedServerOutcome(item,raw);
    if (expectedStage!=="not_applicable") { predictedSafety++; if(predictedStage===expectedStage) predictedSafetyCorrect++; }
    if (p.serverOutcome) { observedSafety++; if(p.serverOutcome===expectedStage) observedSafetyCorrect++; }
    if (raw.category === "malformed_output" || raw.category === "invalid_action_field" || raw.category === "unknown_outcome") {
      parserFailures++;
      if (raw.category === "malformed_output") malformed++;
      else if (raw.category === "invalid_action_field") invalidAction++;
      else unknownOutcome++;
      if(isRegisteredGold) registered[goldTool].excludedGoldCases++;
      rows.push({id:item.id,status:"parser_failure",reason:raw.reason,rawCategory:raw.category,serverExpected:expectedStage,serverPredicted:predictedStage,serverObserved:p.serverOutcome||null});
      continue;
    }
    eligibleParserResponses++;
    const predictedTool=raw.tool;
    const predictedArgs=raw.arguments;
    if (isToolCase) { eligibleToolBearingCases++; if(isRegisteredGold) registered[goldTool].eligibleGoldCases++; } else noToolCases++;
    const toolOk=raw.category === "tool_selection" && predictedTool===goldTool;
    if (toolOk) toolCorrect++;
    if (!isToolCase && raw.category === "unknown_action") noToolCorrect++;
    if (isToolCase ? toolOk : (raw.category === "unknown_action")) interpretationCorrect++;
    if (isToolCase && raw.category === "tool_selection" && deepEqual(predictedArgs,item.expected.arguments)) argumentCorrect++;
    if (predictedTool && !toolSet.has(predictedTool)) unknownTool++;
    for (const tool of tools) { if (goldTool===tool && toolOk) registered[tool].tp++; else if (predictedTool===tool) registered[tool].fp++; else if (goldTool===tool) registered[tool].fn++; }
    rows.push({id:item.id,status:"scored",toolCorrect,interpretationCorrect: isToolCase ? toolOk : raw.category === "unknown_action",rawCategory:raw.category,argsApplicable:isToolCase,argsCorrect:isToolCase && raw.category === "tool_selection" ? deepEqual(predictedArgs,item.expected.arguments):null,serverExpected:expectedStage,serverPredicted:predictedStage,serverObserved:p.serverOutcome||null});
  }
  const excludedArgumentCases={missingUnrun:0,providerFailure:0,malformedResponse:0,invalidAction:0,unknownOutcome:0};
  for(const item of dataset.cases) if(item.expected.tool){const p=byId.get(item.id); if(!p) excludedArgumentCases.missingUnrun++; else if(p.providerFailure===true) excludedArgumentCases.providerFailure++; else {const c=classifyRawOutput(p.output); if(c.category==="malformed_output") excludedArgumentCases.malformedResponse++; else if(c.category==="invalid_action_field") excludedArgumentCases.invalidAction++; else if(c.category==="unknown_outcome") excludedArgumentCases.unknownOutcome++;}}
  const metrics=Object.fromEntries(tools.map(t=>{const c=registered[t],pr=c.tp/(c.tp+c.fp)||0,re=c.tp/(c.tp+c.fn)||0;return [t,{...c,precision:pr,recall:re,f1:pr+re?2*pr*re/(pr+re):0}]}));
  const macroF1=tools.reduce((s,t)=>s+metrics[t].f1,0)/tools.length;
  return {runId:run.runId,totalCases:dataset.cases.length,successfulModelResponses:successful,providerFailures,missingUnrun:missing,parserFailures,malformedResponses:malformed,invalidActionFields:invalidAction,unknownOutcomeResponses:unknownOutcome,eligibleParserResponses,unknownToolPredictions:unknownTool,toolSelection:{correct:interpretationCorrect,denominator:eligibleParserResponses,accuracy:eligibleParserResponses?interpretationCorrect/eligibleParserResponses:null,exactToolSelection:toolCorrect,noToolCases,noToolCorrect},exactArguments:{toolBearingCases,eligibleParserResponses:eligibleToolBearingCases,correct:argumentCorrect,denominator:eligibleToolBearingCases,excluded:excludedArgumentCases,accuracy:eligibleToolBearingCases?argumentCorrect/eligibleToolBearingCases:null},perTool:metrics,macroF1,serverSafety:{predictedStageScored:predictedSafety,predictedStageCorrect:predictedSafetyCorrect,predictedStageAccuracy:predictedSafety?predictedSafetyCorrect/predictedSafety:null,observedStageScored:observedSafety,observedStageCorrect:observedSafetyCorrect,observedStageAccuracy:observedSafety?observedSafetyCorrect/observedSafety:null},rows};
}

function buildReport(input) {
  const runs=predictionRuns(input).map(scoreRun);
  const robustness={status:"not_measured",reason:runs.length<=1?"fewer than two prediction runs":"each case needs at least two eligible scored observations",perCase:{}};
  let measuredCases=0;
  if (runs.length>1) for (const item of dataset.cases) {
    const eligible=runs.flatMap(run=>run.rows.filter(row=>row.id===item.id && row.status==="scored"));
    if (eligible.length<2) { robustness.perCase[item.id]={status:"not_measured",eligibleRepetitions:eligible.length,requiredRepetitions:2}; continue; }
    const values=eligible.map(row=>row.interpretationCorrect && (!row.argsApplicable || row.argsCorrect) ? 1 : 0);
    const mean=values.reduce((a,b)=>a+b,0)/values.length;
    const sd=Math.sqrt(values.reduce((s,v)=>s+(v-mean)**2,0)/values.length);
    robustness.perCase[item.id]={status:"measured",eligibleRepetitions:eligible.length,exactMatchRate:mean,mean,standardDeviation:sd,worstRun:Math.min(...values)};
    measuredCases++;
  }
  if (measuredCases===dataset.cases.length) { robustness.status="measured"; robustness.reason="every case has at least two eligible scored observations"; }
  else if (measuredCases>0) robustness.reason=`${measuredCases} of ${dataset.cases.length} cases have sufficient eligible observations; overall robustness is not measured`;
  return {datasetId:dataset.datasetId,totalCases:dataset.cases.length,runs:runs.length,runResults:runs,robustness,noGeminiRequests:true};
}

function summarize(input) {
  const report=buildReport(input);
  console.log(JSON.stringify(report,null,2));
  return report;
}

if (require.main===module) { if (process.argv.includes("--validate") || process.argv.length<3) validateDataset(); else summarize(JSON.parse(fs.readFileSync(path.resolve(process.cwd(),process.argv[2]),"utf8"))); }
module.exports={deepEqual,classifyRawOutput,schemaCheck,expectedServerOutcome,predictedServerOutcome,validateDataset,scoreRun,buildReport,summarize};
