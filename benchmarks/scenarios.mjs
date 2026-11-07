export const scenarios = [
  {
    id:'GF-API-001', category:'greenfield', difficulty:'medium',
    project:{kind:'greenfield',name:'Field Operations API',request:'Design a secure REST API for a field operations team. Staff create work orders, assign technicians, record completion evidence, and supervisors review status. Include authentication, audit history, and automated tests.',repository:null,constraints:['Prefer a minimal maintainable architecture','Define acceptance criteria before implementation','Keep secrets out of source control'],evidence:[{id:'ev-user-1',type:'user_request',description:'Field operations REST API request',source:'user'}]},
    expectedSignals:[['work order','work_order','workorder'],['technician','assignment','assign'],['authentication','authorization','auth'],['audit','history'],['test','testing']],
    mustClarify:false
  },
  {
    id:'GF-COMMERCE-002', category:'greenfield', difficulty:'hard',
    project:{kind:'greenfield',name:'Multi-store Commerce Platform',request:'Plan a multi-tenant commerce platform with a storefront, catalog and inventory, checkout, order management, payment integration, notifications, and an operations dashboard. Tenant data must be isolated. Payments must not store raw card details.',repository:null,constraints:['Prefer a minimal maintainable architecture','Define acceptance criteria before implementation','Keep secrets out of source control'],evidence:[{id:'ev-user-2',type:'user_request',description:'Multi-store commerce platform request',source:'user'}]},
    expectedSignals:[['multi-tenant','tenant isolation','tenant'],['catalog','product'],['inventory','stock'],['checkout','order'],['payment','payments'],['notification'],['dashboard','operations'],['card data','pci','tokenization']],
    mustClarify:false
  },
  {
    id:'EX-API-003', category:'existing', difficulty:'medium',
    project:{kind:'existing',name:'Existing Customer API',request:'Add cursor-based pagination to the customer listing endpoint. Preserve current response compatibility for existing clients, add tests for empty pages and invalid cursors, and document the API change.',repository:{root:'fixtures/customer-api',fileCount:18,files:[{path:'src/routes/customers.mjs',kind:'source'},{path:'src/services/customer-service.mjs',kind:'source'},{path:'test/customers.test.mjs',kind:'test'},{path:'package.json',kind:'manifest'}],manifests:[{path:'package.json',name:'customer-api',scripts:{test:'node --test'}}],scripts:['test'],tests:['test/customers.test.mjs'],git:{dirty:false,branch:'main'}},constraints:['Do not overwrite unrelated user changes','Do not assume undocumented behavior','Preserve existing project conventions'],evidence:[{id:'ev-scan-3',type:'repository_scan',description:'Existing customer API repository scan',source:'fixtures/customer-api'}]},
    expectedSignals:[['cursor','pagination'],['customer listing','customers'],['backward compatibility','compatibility'],['invalid cursor','cursor validation'],['empty page','empty result'],['api documentation','documentation']],
    mustClarify:false
  },
  {
    id:'EX-MONOLITH-004', category:'existing', difficulty:'hard',
    project:{kind:'existing',name:'Legacy Order Monolith',request:'Introduce an asynchronous order notification flow in this existing monolith. Orders are created synchronously today. Add reliable delivery, retries with bounded backoff, idempotency, observability, and tests. Do not change the public order API.',repository:{root:'fixtures/order-monolith',fileCount:74,files:[{path:'src/orders/controller.mjs',kind:'source'},{path:'src/orders/service.mjs',kind:'source'},{path:'src/db/orders.mjs',kind:'source'},{path:'src/notifications/email.mjs',kind:'source'},{path:'test/orders.test.mjs',kind:'test'},{path:'package.json',kind:'manifest'}],manifests:[{path:'package.json',name:'order-monolith',scripts:{test:'node --test'}}],scripts:['test'],tests:['test/orders.test.mjs'],git:{dirty:false,branch:'main'}},constraints:['Do not overwrite unrelated user changes','Do not assume undocumented behavior','Preserve existing project conventions'],evidence:[{id:'ev-scan-4',type:'repository_scan',description:'Legacy order monolith scan',source:'fixtures/order-monolith'}]},
    expectedSignals:[['asynchronous','queue','worker'],['notification'],['retry','backoff'],['idempotency','deduplication'],['observability','metrics','logging'],['public api','api compatibility']],
    mustClarify:false
  },
  {
    id:'AMB-AUTH-005', category:'ambiguous', difficulty:'hard',
    project:{kind:'greenfield',name:'Identity Integration',request:'Add single sign-on to our application for employees and external partners. It must be secure and easy to use. Choose the best approach and implement the plan.',repository:null,constraints:['Do not invent identity-provider or protocol requirements','Do not assume employee and partner identity domains are identical','Ask blocking questions before provider-specific implementation'],evidence:[{id:'ev-user-5',type:'user_request',description:'Ambiguous SSO request',source:'user'}]},
    expectedSignals:[['identity provider','idp','identity platform'],['employee','partner'],['single sign-on','sso']],
    mustClarify:true,
    clarificationSignals:[['which identity provider','identity provider','idp'],['protocol','saml','oidc','oauth'],['employee and partner','partner identity','identity domains']]
  },
  {
    id:'AMB-DATA-006', category:'ambiguous', difficulty:'hard',
    project:{kind:'greenfield',name:'Business Analytics Dashboard',request:'Build a dashboard showing business performance in real time. It should be accurate, fast, and include all important metrics. Use the data we already have.',repository:null,constraints:['Do not invent metric definitions or data sources','Clarify freshness expectations and authoritative data sources','Do not claim real-time guarantees without a defined latency target'],evidence:[{id:'ev-user-6',type:'user_request',description:'Ambiguous real-time analytics request',source:'user'}]},
    expectedSignals:[['dashboard','visualization'],['metric','kpi'],['data source','source system']],
    mustClarify:true,
    clarificationSignals:[['metric definition','kpi definition','metric owner'],['data source','source system','authoritative source'],['real-time','freshness','latency']]
  }
];
