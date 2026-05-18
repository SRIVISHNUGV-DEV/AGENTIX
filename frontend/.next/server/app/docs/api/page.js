"use strict";(()=>{var a={};a.id=3051,a.ids=[3051],a.modules={261:a=>{a.exports=require("next/dist/shared/lib/router/utils/app-paths")},3295:a=>{a.exports=require("next/dist/server/app-render/after-task-async-storage.external.js")},5849:(a,b,c)=>{c.d(b,{A:()=>d});let d=(0,c(53712).A)("wallet",[["path",{d:"M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1",key:"18etb6"}],["path",{d:"M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4",key:"xoc0q4"}]])},10846:a=>{a.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},14755:(a,b,c)=>{c.d(b,{A:()=>d});let d=(0,c(53712).A)("bot",[["path",{d:"M12 8V4H8",key:"hb8ula"}],["rect",{width:"16",height:"12",x:"4",y:"8",rx:"2",key:"enze0r"}],["path",{d:"M2 14h2",key:"vft8re"}],["path",{d:"M20 14h2",key:"4cs60a"}],["path",{d:"M15 13v2",key:"1xurst"}],["path",{d:"M9 13v2",key:"rq6x2g"}]])},17891:a=>{a.exports=require("next/dist/shared/lib/router/utils/get-segment-param")},19121:a=>{a.exports=require("next/dist/server/app-render/action-async-storage.external.js")},26713:a=>{a.exports=require("next/dist/shared/lib/router/utils/is-bot")},28354:a=>{a.exports=require("util")},29294:a=>{a.exports=require("next/dist/server/app-render/work-async-storage.external.js")},33873:a=>{a.exports=require("path")},35802:(a,b,c)=>{c.r(b),c.d(b,{__next_app__:()=>M,handler:()=>O,routeModule:()=>N});var d=c(31975),e=c(30600),f=c(66116),g=c(27321),h=c(42431),i=c(34935),j=c(57326),k=c(63459),l=c(8555),m=c(67401),n=c(75869),o=c(42417),p=c(44612),q=c(261),r=c(14220),s=c(37353),t=c(26713),u=c(99509),v=c(31310),w=c(85426),x=c(80463),y=c(83665),z=c(9071),A=c(62091),B=c(86439),C=c(77068),D=c(44303),E=c(18045),F=c(71860),G=c(70722),H=c(19995),I=c(43954),J=c(17891),K={};for(let a in E)0>["default","__next_app__","routeModule","handler"].indexOf(a)&&(K[a]=()=>E[a]);c.d(b,K);let L={children:["",{children:["docs",{children:["api",{children:["__PAGE__",{},{page:[()=>Promise.resolve().then(c.bind(c,71771)),"D:\\BLOCKCHAIN AND ZK PROJECTS\\AGENT_CREDENTIAL\\agent-credentials-mvp\\frontend\\app\\docs\\api\\page.tsx"]}]},{"global-error":[()=>Promise.resolve().then(c.t.bind(c,75765,23)),"next/dist/client/components/builtin/global-error.js"]},[]]},{"global-error":[()=>Promise.resolve().then(c.t.bind(c,75765,23)),"next/dist/client/components/builtin/global-error.js"]},[]]},{layout:[()=>Promise.resolve().then(c.bind(c,92564)),"D:\\BLOCKCHAIN AND ZK PROJECTS\\AGENT_CREDENTIAL\\agent-credentials-mvp\\frontend\\app\\layout.tsx"],"global-error":[()=>Promise.resolve().then(c.t.bind(c,75765,23)),"next/dist/client/components/builtin/global-error.js"],"not-found":[()=>Promise.resolve().then(c.t.bind(c,13729,23)),"next/dist/client/components/builtin/not-found.js"],forbidden:[()=>Promise.resolve().then(c.t.bind(c,53532,23)),"next/dist/client/components/builtin/forbidden.js"],unauthorized:[()=>Promise.resolve().then(c.t.bind(c,4175,23)),"next/dist/client/components/builtin/unauthorized.js"]},[]]}.children,M={require:c,loadChunk:()=>Promise.resolve()},N=new d.AppPageRouteModule({definition:{kind:e.RouteKind.APP_PAGE,page:"/docs/api/page",pathname:"/docs/api",bundlePath:"",filename:"",appPaths:[]},userland:{loaderTree:L},distDir:".next",relativeProjectDir:""});async function O(a,b,d){var K,P,Q,R,S;d.requestMeta&&(0,h.setRequestMeta)(a,d.requestMeta),N.isDev&&(0,h.addRequestMeta)(a,"devRequestTimingInternalsEnd",process.hrtime.bigint());let T=!!(0,h.getRequestMeta)(a,"minimalMode"),U="/docs/api/page";"/index"===U&&(U="/");let V=await N.prepare(a,b,{srcPage:U,multiZoneDraftMode:!1});if(!V)return b.statusCode=400,b.end("Bad Request"),null==d.waitUntil||d.waitUntil.call(d,Promise.resolve()),null;let{buildId:W,query:X,params:Y,pageIsDynamic:Z,buildManifest:$,nextFontManifest:_,reactLoadableManifest:aa,serverActionsManifest:ab,clientReferenceManifest:ac,subresourceIntegrityManifest:ad,prerenderManifest:ae,isDraftMode:af,resolvedPathname:ag,revalidateOnlyGenerated:ah,routerServerContext:ai,nextConfig:aj,parsedUrl:ak,interceptionRoutePatterns:al,deploymentId:am,clientAssetToken:an}=V,ao=(0,q.normalizeAppPath)(U),{isOnDemandRevalidate:ap}=V,aq=aj.experimental.ppr&&!aj.cacheComponents&&(0,I.isInterceptionRouteAppPath)(ag)?null:N.match(ag,ae),ar=(null==aq?void 0:aq.route)??null,as=!!ae.routes[ag],at=a.headers["user-agent"]||"",au=(0,t.getBotType)(at),av=(0,p.isHtmlBotRequest)(a),aw=(0,h.getRequestMeta)(a,"isPrefetchRSCRequest")??"1"===a.headers[s.NEXT_ROUTER_PREFETCH_HEADER],ax=(0,h.getRequestMeta)(a,"isRSCRequest")??!!a.headers[s.RSC_HEADER],ay=(0,r.getIsPossibleServerAction)(a),az=(0,m.checkIsAppPPREnabled)(aj.experimental.ppr),aA=a.headers[x.NEXT_RESUME_STATE_LENGTH_HEADER];if(!(0,h.getRequestMeta)(a,"postponed")&&T&&az&&ay&&aA&&"string"==typeof aA){let e=parseInt(aA,10),{maxPostponedStateSize:f,maxPostponedStateSizeBytes:g}=(0,D.getMaxPostponedStateSize)(aj.experimental.maxPostponedStateSize);if(!isNaN(e)&&e>0){if(e>g)return b.statusCode=413,b.end((0,D.getPostponedStateExceededErrorMessage)(f)),null==d.waitUntil||d.waitUntil.call(d,Promise.resolve()),null;let i="1 MB",j=(null==(S=aj.experimental.serverActions)?void 0:S.bodySizeLimit)??i,k=e+(j!==i?c(66716).parse(j):1048576),l=await (0,D.readBodyWithSizeLimit)(a,k);if(null===l)return b.statusCode=413,b.end("Request body exceeded limit. To configure the body size limit for Server Actions, see: https://nextjs.org/docs/app/api-reference/next-config-js/serverActions#bodysizelimit"),null==d.waitUntil||d.waitUntil.call(d,Promise.resolve()),null;if(l.length>=e){let b=l.subarray(0,e).toString("utf8");(0,h.addRequestMeta)(a,"postponed",b);let c=l.subarray(e);(0,h.addRequestMeta)(a,"actionBody",c)}else throw Object.defineProperty(Error(`invariant: expected ${e} bytes of postponed state but only received ${l.length} bytes`),"__NEXT_ERROR_CODE",{value:"E979",enumerable:!1,configurable:!0})}}if(!(0,h.getRequestMeta)(a,"postponed")&&az&&"1"===a.headers[x.NEXT_RESUME_HEADER]&&"POST"===a.method){let{maxPostponedStateSize:c,maxPostponedStateSizeBytes:e}=(0,D.getMaxPostponedStateSize)(aj.experimental.maxPostponedStateSize),f=await (0,D.readBodyWithSizeLimit)(a,e);if(null===f)return b.statusCode=413,b.end((0,D.getPostponedStateExceededErrorMessage)(c)),null==d.waitUntil||d.waitUntil.call(d,Promise.resolve()),null;let g=f.toString("utf8");(0,h.addRequestMeta)(a,"postponed",g)}let aB=!0===N.isDev||!0===aj.experimental.exposeTestingApiInProductionBuild,aC=aB&&("1"===a.headers[s.NEXT_INSTANT_PREFETCH_HEADER]||void 0===a.headers[s.RSC_HEADER]&&"string"==typeof a.headers.cookie&&a.headers.cookie.includes(s.NEXT_INSTANT_TEST_COOKIE+"=")),aD=(az||aC)&&((null==(K=ae.routes[ao]??ae.dynamicRoutes[ao])?void 0:K.renderingMode)==="PARTIALLY_STATIC"||aC&&(aB||(null==ai?void 0:ai.experimentalTestProxy)===!0)),aE=aC&&aD,aF=aE&&!0===N.isDev,aG=!1,aH=aD?(0,h.getRequestMeta)(a,"postponed"):void 0,aI=null==(P=ae.routes[ag])?void 0:P.prefetchDataRoute,aJ=aD&&ax&&!aw&&!aI;T&&(aJ=aJ&&!!aH);let aK=(0,h.getRequestMeta)(a,"segmentPrefetchRSCRequest"),aL=(!au||!aD)&&(!at||(0,p.shouldServeStreamingMetadata)(at,aj.htmlLimitedBots)),aM=!!((ar||as||ae.routes[ao])&&!(au&&aD)),aN=aD&&!0===aj.cacheComponents,aO=!0===N.isDev||!aM||"string"==typeof aH||(aN&&(0,h.getRequestMeta)(a,"onCacheEntryV2")?aJ&&!T:aJ),aP=!!au&&aD,aQ=(null==ar?void 0:ar.remainingPrerenderableParams)??[],aR=(null==ar?void 0:ar.fallback)===null&&((null==(Q=ar.fallbackRootParams)?void 0:Q.length)??0)>0,aS=null;if(!af&&aM&&!aO&&!ay&&!aH&&!aJ){let a=aq?"string"==typeof(null==ar?void 0:ar.fallback)?ar.fallback:aq.source:null;if(!0===aj.experimental.partialFallbacks&&a&&(null==ar?void 0:ar.fallbackRouteParams)&&!aR){if(aQ.length>0){let b,c=(b=new Map(aQ.map(a=>[a.paramName,a])),a.split("/").map(a=>{let c=(0,J.getSegmentParam)(a);if(!c)return a;let d=b.get(c.paramName);if(!d)return a;let e=null==Y?void 0:Y[d.paramName];if(!e)return a;let f=Array.isArray(e)?e.map(a=>encodeURIComponent(a)).join("/"):encodeURIComponent(e);return a.replace(function(a){let{repeat:b,optional:c}=(0,J.getParamProperties)(a.paramType);return c?`[[...${a.paramName}]]`:b?`[...${a.paramName}]`:`[${a.paramName}]`}(d),f)}).join("/")||"/");aS=c!==a?c:null}}else aS=ag}let aT=aS;!aT&&(N.isDev||aM&&Z&&(null==ar?void 0:ar.fallbackRouteParams)&&!ay)&&(aT=ag),N.isDev||af||!aM||!ax||aJ||(0,k.d)(a.headers);let aU={...E,tree:L,handler:O,routeModule:N,__next_app__:M};ab&&ac&&(0,o.setManifestsSingleton)({page:U,clientReferenceManifest:ac,serverActionsManifest:ab});let aV=a.method||"GET",aW=(0,g.getTracer)(),aX=aW.getActiveScopeSpan(),aY=!!(null==ai?void 0:ai.isWrappedByNextServer),aZ=!0===aj.experimental.partialFallbacks&&aQ.length>0?(null==ar||null==(R=ar.fallbackRouteParams)?void 0:R.filter(a=>!aQ.some(b=>b.paramName===a.paramName)))??[]:[],a$=async()=>((null==ai?void 0:ai.render404)?await ai.render404(a,b,ak,!1):b.end("This page could not be found"),null);try{let k,m=N.getVaryHeader(ag,al);b.setHeader("Vary",m);let o=async(c,d)=>{let e=new l.NodeNextRequest(a),f=new l.NodeNextResponse(b);return N.render(e,f,d).finally(()=>{if(!c)return;c.setAttributes({"http.status_code":b.statusCode,"next.rsc":!1});let a=aW.getRootSpanAttributes();if(!a)return;if(a.get("next.span_type")!==i.BaseServerSpan.handleRequest)return void console.warn(`Unexpected root span type '${a.get("next.span_type")}'. Please report this Next.js issue https://github.com/vercel/next.js`);let d=a.get("next.route");if(d){let a=`${aV} ${d}`;c.setAttributes({"next.route":d,"http.route":d,"next.span_name":a}),c.updateName(a),k&&k!==c&&(k.setAttribute("http.route",d),k.updateName(a))}else c.updateName(`${aV} ${U}`)})},p=(0,h.getRequestMeta)(a,"incrementalCache")||await N.getIncrementalCache(a,aj,ae,T);null==p||p.resetRequestCache(),globalThis.__incrementalCache=p;let q=async({span:e,postponed:f,fallbackRouteParams:g,forceStaticRender:i})=>{let k={query:X,params:Y,page:ao,sharedContext:{buildId:W,deploymentId:am,clientAssetToken:an},serverComponentsHmrCache:(0,h.getRequestMeta)(a,"serverComponentsHmrCache"),fallbackRouteParams:g,renderOpts:{App:()=>null,Document:()=>null,pageConfig:{},ComponentMod:aU,Component:(0,j.T)(aU),params:Y,routeModule:N,page:U,postponed:f,shouldWaitOnAllReady:aP,serveStreamingMetadata:aL,supportsDynamicResponse:"string"==typeof f||aO,buildManifest:$,nextFontManifest:_,reactLoadableManifest:aa,subresourceIntegrityManifest:ad,setCacheStatus:null==ai?void 0:ai.setCacheStatus,setIsrStatus:null==ai?void 0:ai.setIsrStatus,setReactDebugChannel:null==ai?void 0:ai.setReactDebugChannel,sendErrorsToBrowser:null==ai?void 0:ai.sendErrorsToBrowser,dir:c(33873).join(process.cwd(),N.relativeProjectDir),isDraftMode:af,botType:au,isOnDemandRevalidate:ap,isPossibleServerAction:ay,assetPrefix:aj.assetPrefix,nextConfigOutput:aj.output,crossOrigin:aj.crossOrigin,trailingSlash:aj.trailingSlash,images:aj.images,previewProps:ae.preview,enableTainting:aj.experimental.taint,htmlLimitedBots:aj.htmlLimitedBots,reactMaxHeadersLength:aj.reactMaxHeadersLength,multiZoneDraftMode:!1,incrementalCache:p,cacheLifeProfiles:aj.cacheLife,basePath:aj.basePath,serverActions:aj.experimental.serverActions,logServerFunctions:"object"==typeof aj.logging&&!!aj.logging.serverFunctions,...aE||aF||aG?{isBuildTimePrerendering:!0,supportsDynamicResponse:!1,isStaticGeneration:!0,isDebugDynamicAccesses:aF}:{},cacheComponents:!!aj.cacheComponents,experimental:{isRoutePPREnabled:aD,expireTime:aj.expireTime,staleTimes:aj.experimental.staleTimes,dynamicOnHover:!!aj.experimental.dynamicOnHover,optimisticRouting:!!aj.experimental.optimisticRouting,inlineCss:!!aj.experimental.inlineCss,prefetchInlining:aj.experimental.prefetchInlining??!1,authInterrupts:!!aj.experimental.authInterrupts,cachedNavigations:!!aj.experimental.cachedNavigations,clientTraceMetadata:aj.experimental.clientTraceMetadata||[],clientParamParsingOrigins:aj.experimental.clientParamParsingOrigins,maxPostponedStateSizeBytes:(0,C.parseMaxPostponedStateSize)(aj.experimental.maxPostponedStateSize)},waitUntil:d.waitUntil,onClose:a=>{b.on("close",a)},onAfterTaskError:()=>{},onInstrumentationRequestError:(b,c,d,e)=>N.onRequestError(a,b,d,e,ai),err:(0,h.getRequestMeta)(a,"invokeError")}};i&&(k.renderOpts.supportsDynamicResponse=!1);let l=await o(e,k),{metadata:m}=l,{cacheControl:n,headers:q={},fetchTags:r,fetchMetrics:s}=m;if(r&&(q[x.NEXT_CACHE_TAGS_HEADER]=r),a.fetchMetrics=s,aM&&(null==n?void 0:n.revalidate)===0&&!N.isDev&&!aD){let a=m.staticBailoutInfo,b=Object.defineProperty(Error(`Page changed from static to dynamic at runtime ${ag}${(null==a?void 0:a.description)?`, reason: ${a.description}`:""}
see more here https://nextjs.org/docs/messages/app-static-to-dynamic-error`),"__NEXT_ERROR_CODE",{value:"E132",enumerable:!1,configurable:!0});if(null==a?void 0:a.stack){let c=a.stack;b.stack=b.message+c.substring(c.indexOf("\n"))}throw b}return{value:{kind:u.CachedRouteKind.APP_PAGE,html:l,headers:q,rscData:m.flightData,postponed:m.postponed,status:m.statusCode,segmentData:m.segmentData},cacheControl:n}},r=async({hasResolved:c,previousCacheEntry:g,isRevalidating:i,span:j,forceStaticRender:k=!1})=>{let l=!1===N.isDev,m=c||b.writableEnded;try{let f;if(ap&&ah&&!g&&!T)return(null==ai?void 0:ai.render404)?await ai.render404(a,b):(b.statusCode=404,b.end("This page could not be found")),null;if(ar&&(f=(0,v.parseFallbackField)(ar.fallback)),!0===aj.experimental.partialFallbacks&&(null==ar?void 0:ar.fallback)===null&&!aR&&aQ.length>0&&(f=v.FallbackMode.PRERENDER),f===v.FallbackMode.PRERENDER&&(0,t.isBot)(at)&&(!aD||av)&&(f=v.FallbackMode.BLOCKING_STATIC_RENDER),(null==g?void 0:g.isStale)===-1&&(ap=!0),ap&&(f!==v.FallbackMode.NOT_FOUND||g)&&(f=v.FallbackMode.BLOCKING_STATIC_RENDER),!T&&f!==v.FallbackMode.BLOCKING_STATIC_RENDER&&aT&&!m&&!af&&Z&&(l||!as)){if((l||ar)&&f===v.FallbackMode.NOT_FOUND){if(aj.adapterPath)return await a$();throw new B.NoFallbackError}if(aD&&(aj.cacheComponents?!aJ:!ax)){let b=l&&"string"==typeof(null==ar?void 0:ar.fallback)?ar.fallback:ao,f=(l||aE)&&(null==ar?void 0:ar.fallbackRouteParams)?(0,n.createOpaqueFallbackRouteParams)(ar.fallbackRouteParams):aG?(0,n.getFallbackRouteParams)(ao,N):null;aE&&f&&(0,h.addRequestMeta)(a,"fallbackParams",f);let g=await N.handleResponse({cacheKey:b,req:a,nextConfig:aj,routeKind:e.RouteKind.APP_PAGE,isFallback:!0,prerenderManifest:ae,isRoutePPREnabled:aD,responseGenerator:async()=>q({span:j,postponed:void 0,fallbackRouteParams:f,forceStaticRender:!0}),waitUntil:d.waitUntil,isMinimalMode:T});if(null===g)return null;if(g)return T||!aD||!(aQ.length>0)||!0!==aj.experimental.partialFallbacks||!aS||!p||ap||aG||aB||aC||aw||(0,H.scheduleOnNextTick)(async()=>{let b=N.getResponseCache(a);try{await b.revalidate(aS,p,aD,!1,a=>q({span:a.span,postponed:void 0,fallbackRouteParams:aZ.length>0?(0,n.createOpaqueFallbackRouteParams)(aZ):null,forceStaticRender:!0}),null,c,d.waitUntil)}catch(a){console.error("Error revalidating the page in the background",a)}}),delete g.cacheControl,g}}let o=ap||i||!aH?void 0:aH;if(aN&&!T&&p&&(aJ||ay)&&!k){let b=await p.get(ag,{kind:u.IncrementalCacheKind.APP_PAGE,isRoutePPREnabled:!0,isFallback:!1});b&&b.value&&b.value.kind===u.CachedRouteKind.APP_PAGE&&(o=b.value.postponed,b&&(-1===b.isStale||!0===b.isStale)&&(0,H.scheduleOnNextTick)(async()=>{let b=N.getResponseCache(a);try{await b.revalidate(ag,p,aD,!1,a=>r({...a,forceStaticRender:!0}),null,c,d.waitUntil)}catch(a){console.error("Error revalidating the page in the background",a)}}))}if((aE||aF)&&void 0!==o)return{cacheControl:{revalidate:1,expire:void 0},value:{kind:u.CachedRouteKind.PAGES,html:w.default.EMPTY,pageData:{},headers:void 0,status:void 0}};let s=(l&&(0,h.getRequestMeta)(a,"renderFallbackShell")||aE&&!as)&&(null==ar?void 0:ar.fallbackRouteParams)?(0,n.createOpaqueFallbackRouteParams)(ar.fallbackRouteParams):aG?(0,n.getFallbackRouteParams)(ao,N):null;if((l||aE)&&aj.cacheComponents&&!as&&(null==ar?void 0:ar.fallbackRouteParams)){let b=(0,n.createOpaqueFallbackRouteParams)(ar.fallbackRouteParams);b&&(0,h.addRequestMeta)(a,"fallbackParams",b)}return q({span:j,postponed:o,fallbackRouteParams:s,forceStaticRender:k})}catch(b){throw(null==g?void 0:g.isStale)&&await N.onRequestError(a,b,{routerKind:"App Router",routePath:U,routeType:"render",revalidateReason:(0,f.c)({isStaticGeneration:aM,isOnDemandRevalidate:ap})},!1,ai),b}},D=async c=>{var f,g,i,j,k;let l,m=await N.handleResponse({cacheKey:aS,responseGenerator:a=>r({span:c,...a}),routeKind:e.RouteKind.APP_PAGE,isOnDemandRevalidate:ap,isRoutePPREnabled:aD,req:a,nextConfig:aj,prerenderManifest:ae,waitUntil:d.waitUntil,isMinimalMode:T});if(af&&b.setHeader("Cache-Control","private, no-cache, no-store, max-age=0, must-revalidate"),N.isDev&&b.setHeader("Cache-Control","no-cache, must-revalidate"),!m){if(aS)throw Object.defineProperty(Error("invariant: cache entry required but not generated"),"__NEXT_ERROR_CODE",{value:"E62",enumerable:!1,configurable:!0});return null}if((null==(f=m.value)?void 0:f.kind)!==u.CachedRouteKind.APP_PAGE)throw Object.defineProperty(Error(`Invariant app-page handler received invalid cache entry ${null==(i=m.value)?void 0:i.kind}`),"__NEXT_ERROR_CODE",{value:"E707",enumerable:!1,configurable:!0});let n="string"==typeof m.value.postponed;ax&&!ay&&am&&b.setHeader(x.NEXT_NAV_DEPLOYMENT_ID_HEADER,am),aM&&!aJ&&(!n||aw)&&(T||b.setHeader("x-nextjs-cache",ap?"REVALIDATED":m.isMiss?"MISS":m.isStale?"STALE":"HIT"),b.setHeader(s.NEXT_IS_PRERENDER_HEADER,"1"));let{value:o}=m;if(aH)l={revalidate:0,expire:void 0};else if(aJ)l={revalidate:0,expire:void 0};else if(!N.isDev)if(af)l={revalidate:0,expire:void 0};else if(aM){if(m.cacheControl)if("number"==typeof m.cacheControl.revalidate){if(m.cacheControl.revalidate<1)throw Object.defineProperty(Error(`Invalid revalidate configuration provided: ${m.cacheControl.revalidate} < 1`),"__NEXT_ERROR_CODE",{value:"E22",enumerable:!1,configurable:!0});l={revalidate:m.cacheControl.revalidate,expire:(null==(j=m.cacheControl)?void 0:j.expire)??aj.expireTime}}else l={revalidate:x.CACHE_ONE_YEAR_SECONDS,expire:void 0}}else b.getHeader("Cache-Control")||(l={revalidate:0,expire:void 0});if(m.cacheControl=l,"string"==typeof aK&&(null==o?void 0:o.kind)===u.CachedRouteKind.APP_PAGE&&o.segmentData){b.setHeader(s.NEXT_DID_POSTPONE_HEADER,"2");let c=null==(k=o.headers)?void 0:k[x.NEXT_CACHE_TAGS_HEADER];T&&aM&&c&&"string"==typeof c&&b.setHeader(x.NEXT_CACHE_TAGS_HEADER,c);let d=o.segmentData.get(aK);return void 0!==d?(0,A.sendRenderResult)({req:a,res:b,generateEtags:aj.generateEtags,poweredByHeader:aj.poweredByHeader,result:w.default.fromStatic(d,s.RSC_CONTENT_TYPE_HEADER),cacheControl:m.cacheControl}):(b.statusCode=204,(0,A.sendRenderResult)({req:a,res:b,generateEtags:aj.generateEtags,poweredByHeader:aj.poweredByHeader,result:w.default.EMPTY,cacheControl:m.cacheControl}))}let p=aN?(0,h.getRequestMeta)(a,"onCacheEntryV2")??(0,h.getRequestMeta)(a,"onCacheEntry"):(0,h.getRequestMeta)(a,"onCacheEntry");if(p&&await p(m,{url:(0,h.getRequestMeta)(a,"initURL")??a.url}))return null;if(o.headers){let a={...o.headers};for(let[c,d]of(T&&aM||delete a[x.NEXT_CACHE_TAGS_HEADER],Object.entries(a)))if(void 0!==d)if(Array.isArray(d))for(let a of d)b.appendHeader(c,a);else"number"==typeof d&&(d=d.toString()),b.appendHeader(c,d)}let t=null==(g=o.headers)?void 0:g[x.NEXT_CACHE_TAGS_HEADER];if(T&&aM&&t&&"string"==typeof t&&b.setHeader(x.NEXT_CACHE_TAGS_HEADER,t),!o.status||ax&&aD||(b.statusCode=o.status),!T&&o.status&&F.RedirectStatusCode[o.status]&&ax&&(b.statusCode=200),n&&!aJ&&b.setHeader(s.NEXT_DID_POSTPONE_HEADER,"1"),ax&&!af){if(void 0===o.rscData){if(o.html.contentType!==s.RSC_CONTENT_TYPE_HEADER)if(aj.cacheComponents)return b.statusCode=404,(0,A.sendRenderResult)({req:a,res:b,generateEtags:aj.generateEtags,poweredByHeader:aj.poweredByHeader,result:w.default.EMPTY,cacheControl:m.cacheControl});else throw Object.defineProperty(new G.InvariantError(`Expected RSC response, got ${o.html.contentType}`),"__NEXT_ERROR_CODE",{value:"E789",enumerable:!1,configurable:!0});return(0,A.sendRenderResult)({req:a,res:b,generateEtags:aj.generateEtags,poweredByHeader:aj.poweredByHeader,result:o.html,cacheControl:m.cacheControl})}return(0,A.sendRenderResult)({req:a,res:b,generateEtags:aj.generateEtags,poweredByHeader:aj.poweredByHeader,result:w.default.fromStatic(o.rscData,s.RSC_CONTENT_TYPE_HEADER),cacheControl:m.cacheControl})}let v=o.html;if(aC&&aE){let c=!0===N.isDev?crypto.randomUUID():null;return v.pipeThrough((0,z.createInstantTestScriptInsertionTransformStream)(c)),(0,A.sendRenderResult)({req:a,res:b,generateEtags:aj.generateEtags,poweredByHeader:aj.poweredByHeader,result:v,cacheControl:{revalidate:0,expire:void 0}})}if(!n||T||ax)return(0,A.sendRenderResult)({req:a,res:b,generateEtags:aj.generateEtags,poweredByHeader:aj.poweredByHeader,result:v,cacheControl:m.cacheControl});if(aE||aF)return v.push(new ReadableStream({start(a){a.enqueue(y.ENCODED_TAGS.CLOSED.BODY_AND_HTML),a.close()}})),(0,A.sendRenderResult)({req:a,res:b,generateEtags:aj.generateEtags,poweredByHeader:aj.poweredByHeader,result:v,cacheControl:{revalidate:0,expire:void 0}});let B=new TransformStream;return v.push(B.readable),q({span:c,postponed:o.postponed,fallbackRouteParams:null,forceStaticRender:!1}).then(async a=>{var b,c;if(!a)throw Object.defineProperty(Error("Invariant: expected a result to be returned"),"__NEXT_ERROR_CODE",{value:"E463",enumerable:!1,configurable:!0});if((null==(b=a.value)?void 0:b.kind)!==u.CachedRouteKind.APP_PAGE)throw Object.defineProperty(Error(`Invariant: expected a page response, got ${null==(c=a.value)?void 0:c.kind}`),"__NEXT_ERROR_CODE",{value:"E305",enumerable:!1,configurable:!0});await a.value.html.pipeTo(B.writable)}).catch(a=>{B.writable.abort(a).catch(a=>{console.error("couldn't abort transformer",a)})}),(0,A.sendRenderResult)({req:a,res:b,generateEtags:aj.generateEtags,poweredByHeader:aj.poweredByHeader,result:v,cacheControl:{revalidate:0,expire:void 0}})};if(!aY||!aX)return k=aW.getActiveScopeSpan(),await aW.withPropagatedContext(a.headers,()=>aW.trace(i.BaseServerSpan.handleRequest,{spanName:`${aV} ${U}`,kind:g.SpanKind.SERVER,attributes:{"http.method":aV,"http.target":a.url}},D),void 0,!aY);await D(aX)}catch(b){throw b instanceof B.NoFallbackError||await N.onRequestError(a,b,{routerKind:"App Router",routePath:U,routeType:"render",revalidateReason:(0,f.c)({isStaticGeneration:aM,isOnDemandRevalidate:ap})},!1,ai),b}}},41025:a=>{a.exports=require("next/dist/server/app-render/dynamic-access-async-storage.external.js")},43954:a=>{a.exports=require("next/dist/shared/lib/router/utils/interception-routes")},63033:a=>{a.exports=require("next/dist/server/app-render/work-unit-async-storage.external.js")},67208:(a,b,c)=>{c.d(b,{A:()=>d});let d=(0,c(53712).A)("arrow-right",[["path",{d:"M5 12h14",key:"1ays0h"}],["path",{d:"m12 5 7 7-7 7",key:"xquz4c"}]])},70722:a=>{a.exports=require("next/dist/shared/lib/invariant-error")},71771:(a,b,c)=>{c.r(b),c.d(b,{default:()=>H,metadata:()=>t});var d=c(22037),e=c(89813),f=c.n(e),g=c(94413),h=c(56889),i=c(2149),j=c(53712);let k=(0,j.A)("users",[["path",{d:"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2",key:"1yyitq"}],["path",{d:"M16 3.128a4 4 0 0 1 0 7.744",key:"16gr8j"}],["path",{d:"M22 21v-2a4 4 0 0 0-3-3.87",key:"kshegd"}],["circle",{cx:"9",cy:"7",r:"4",key:"nufk8"}]]);var l=c(14755),m=c(98739),n=c(20596),o=c(64301),p=c(43202),q=c(5849);let r=(0,j.A)("file-braces",[["path",{d:"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",key:"1oefj6"}],["path",{d:"M14 2v5a1 1 0 0 0 1 1h5",key:"wfsgrz"}],["path",{d:"M10 12a1 1 0 0 0-1 1v1a1 1 0 0 1-1 1 1 1 0 0 1 1 1v1a1 1 0 0 0 1 1",key:"1oajmo"}],["path",{d:"M14 18a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1 1 1 0 0 1-1-1v-1a1 1 0 0 0-1-1",key:"mpwhp6"}]]);var s=c(67208);let t={title:"API Reference - Agentix",description:"Complete REST API documentation for Agentix Protocol."},u=`// All mutating operations require wallet signatures
interface SignedRequest {
  signature: string      // EIP-191 personal_sign signature
  message: string        // JSON stringified message
  nonce: string          // UUID for replay protection
  requestedAt: number    // Unix timestamp in seconds
}

// Example: Creating a signed request
const message = {
  action: "create_agent",
  orgId: 1,
  nonce: crypto.randomUUID(),
  requestedAt: Math.floor(Date.now() / 1000)
}

const signature = await window.ethereum.request({
  method: 'personal_sign',
  params: [JSON.stringify(message), walletAddress]
})

// Send to API
const response = await fetch('/external', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ ...message, signature })
})`,v=`# List all organizations
GET /orgs

# Response
[
  { "id": 1, "name": "Agentix", "ownerWalletAddress": "0x...", "created_at": 1715624400 }
]

# Create organization (requires signature)
POST /orgs
{
  "name": "My Organization",
  "walletAddress": "0x...",
  "signature": "...",
  "message": "...",
  "nonce": "uuid-v4",
  "requestedAt": 1715624400
}

# Response
{ "id": 1, "name": "My Organization", "ownerWalletAddress": "0x..." }

# Get organization state (includes agents, credentials, wallets, sessions)
GET /orgs/:orgId/state`,w=`# List agents for organization
GET /agents?orgId=1

# Get single agent
GET /agents/:agentId

# Provision agent (auto-creates org if needed)
POST /v1/agents/provision
{
  "orgId": 1,
  "orgName": "MyOrg",
  "agentName": "Treasury Agent"
}

# Response
{
  "success": true,
  "orgId": 1,
  "agentId": 42,
  "next": {
    "credentialRegisterUrl": "/credentials",
    "proofBundleUrl": "/proofs/bundle",
    "sessionSubmitUrl": "/sessions",
    "revokeUrl": "/credentials/revoke",
    "walletCreateUrl": "/wallets"
  }
}`,x=`# List external agents
GET /external?orgId=1
GET /external-agents?orgId=1   # Alias for frontend compatibility

# Response
[
  {
    "id": 1,
    "org_id": 1,
    "agent_name": "Treasury Manager",
    "agent_type": "openclaude",
    "agent_endpoint": "http://localhost:8080",
    "status": "active",
    "linked_agent_id": 42,
    "created_at": 1715624400
  }
]

# Create external agent (requires signature)
POST /external
{
  "orgId": 1,
  "agentType": "openclaude",
  "name": "Treasury Manager",
  "endpoint": "http://localhost:8080",
  "signature": "...",
  "message": "...",
  "nonce": "uuid-v4",
  "requestedAt": 1715624400
}

# Supported agent types
# openclaude, langchain, claude_code, crewai, llama_index, autogen, smolagents, custom

# Get single agent
GET /external/:agentId?orgId=1

# Update agent
PATCH /external/:agentId
{
  "orgId": 1,
  "name": "New Name",
  "endpoint": "http://new-endpoint:8080"
}`,y=`# Execute action on agent (requires signature)
POST /external/:agentId/execute
{
  "action": "read_file",
  "params": { "path": "/data/config.json" },
  "nonce": "uuid-v4",
  "requestedAt": 1715624400,
  "timeout": 30000
}

# Action Types:
# read_file      - { path: string }
# write_file     - { path: string, content: string }
# execute_command - { command: string, args?: string[], cwd?: string }
# query          - { query: string, params?: any[] }
# api_call       - { url: string, method?: "GET"|"POST"|"PUT"|"DELETE", headers?: {}, body?: any }
# sign_transaction - { to: string, value: string, data?: string }
# deploy_contract - { bytecode: string, abi: any, constructorArgs?: any[] }
# custom         - { customType: string, ... }

# Response
{
  "success": true,
  "execution": {
    "id": "uuid-v4",
    "externalAgentId": "1",
    "action": "read_file",
    "params": { "path": "/data/config.json" },
    "result": { "content": "..." },
    "success": true,
    "executionTimeMs": 150,
    "createdAt": "2026-05-14T10:00:00Z",
    "status": "success"
  }
}

# Get execution history
GET /external/:agentId/executions?orgId=1&limit=50
GET /external-agents/:agentId/executions?orgId=1&limit=50

# Get execution statistics
GET /external/:agentId/executions/stats?orgId=1
# Response
{
  "total": 100,
  "successful": 95,
  "failed": 5,
  "avgTime": 250,
  "lastExecution": 1715624400
}`,z=`# List credentials for agent
GET /credentials?agentId=1

# Register credential (requires signature)
POST /credentials
{
  "agentId": 1,
  "orgId": 1,
  "permissions": 255,
  "expiry": 1715624400,
  "commitment": "123456789012345678",
  "secretHash": "987654321098765432"
}

# Revoke credential
POST /credentials/revoke
{
  "agentId": 1,
  "secretHash": "..."
}

# Get agent credentials
GET /external/:agentId/credentials?orgId=1
POST /external/:agentId/credentials`,A=`# List sessions
GET /sessions?orgId=1

# Create session with ZK proof
POST /sessions
{
  "agentId": 1,
  "sessionId": "session_0x...",
  "sessionKey": "0x...",
  "maxValue": "1000000000000000000",
  "expiry": 1715624400,
  "proof": { ... },
  "publicSignals": [...]
}`,B=`# List wallets
GET /wallets?agentId=1

# Create ERC-4337 wallet
POST /wallets
{
  "ownerAddress": "0x...",
  "agentId": 1
}

# Response
{
  "success": true,
  "txHash": "0x...",
  "walletAddress": "0x...",
  "ownerAddress": "0x...",
  "sessionManagerAddress": "0x...",
  "implementationAddress": "0x...",
  "entryPointAddress": "0x...",
  "walletKind": "erc4337"
}

# Whitelist management
GET /wallets/:address/whitelist
POST /wallets/:address/whitelist
DELETE /wallets/:address/whitelist/:party`,C=`# List blockchain events
GET /events?orgId=1&contractName=SessionManager&limit=50

# Sync events from blockchain
POST /events/sync`,D=`# Error response format
{
  "error": "Error message",
  "code": "ERROR_CODE",
  "details": { ... }
}

# Common error codes:
# validation_error   - Invalid request parameters
# not_found          - Resource not found
# unauthorized       - Missing or invalid signature
# forbidden          - Insufficient permissions
# conflict           - Resource already exists
# rate_limited       - Too many requests
# internal_error     - Server error

# Example error
{
  "error": "orgId must be an integer",
  "code": "validation_error"
}`;function E({code:a,language:b="typescript"}){return(0,d.jsxs)("div",{className:"relative rounded-lg bg-zinc-950 border border-zinc-800 overflow-hidden",children:[(0,d.jsxs)("div",{className:"flex items-center justify-between px-4 py-2 border-b border-zinc-800 bg-zinc-900/50",children:[(0,d.jsx)("span",{className:"text-xs text-zinc-500 font-mono",children:b}),(0,d.jsxs)("button",{className:"text-xs text-zinc-500 hover:text-zinc-300 flex items-center gap-1",children:[(0,d.jsx)(g.A,{className:"h-3 w-3"}),"Copy"]})]}),(0,d.jsx)("pre",{className:"p-4 overflow-x-auto",children:(0,d.jsx)("code",{className:"text-sm font-mono text-zinc-300 whitespace-pre",children:a})})]})}function F({id:a,title:b,icon:c,children:e}){return(0,d.jsxs)("section",{id:a,className:"scroll-mt-20 mt-16 first:mt-0",children:[(0,d.jsxs)("div",{className:"flex items-center gap-3 mb-4",children:[(0,d.jsx)("div",{className:"flex h-10 w-10 items-center justify-center rounded-lg bg-blue-400/10",children:(0,d.jsx)(c,{className:"h-5 w-5 text-blue-400"})}),(0,d.jsx)("h2",{className:"text-2xl font-semibold",children:b})]}),e]})}function G({method:a,path:b,description:c}){return(0,d.jsxs)("div",{className:"flex items-center gap-4 p-3 rounded-lg border border-zinc-800 bg-zinc-900/30",children:[(0,d.jsx)("span",{className:`px-2 py-1 rounded text-xs font-mono font-medium ${{GET:"text-emerald-400 bg-emerald-400/10",POST:"text-blue-400 bg-blue-400/10",PATCH:"text-orange-400 bg-orange-400/10",DELETE:"text-red-400 bg-red-400/10"}[a]}`,children:a}),(0,d.jsx)("code",{className:"text-sm font-mono text-zinc-300",children:b}),(0,d.jsx)("span",{className:"text-sm text-zinc-500 ml-auto",children:c})]})}function H(){return(0,d.jsxs)("div",{className:"min-h-screen bg-zinc-950 text-zinc-100",children:[(0,d.jsx)("header",{className:"sticky top-0 z-50 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-sm",children:(0,d.jsxs)("div",{className:"mx-auto flex max-w-6xl items-center justify-between px-6 py-4",children:[(0,d.jsxs)("div",{className:"flex items-center gap-2",children:[(0,d.jsxs)(f(),{href:"/docs",className:"text-zinc-400 hover:text-zinc-200 flex items-center gap-1",children:[(0,d.jsx)(h.A,{className:"h-4 w-4"}),"Docs"]}),(0,d.jsx)("span",{className:"text-zinc-600",children:"/"}),(0,d.jsx)("span",{className:"text-zinc-100",children:"API Reference"})]}),(0,d.jsxs)("nav",{className:"flex items-center gap-6 text-sm",children:[(0,d.jsx)(f(),{href:"/docs/sdk",className:"text-zinc-400 hover:text-zinc-200",children:"SDK Reference"}),(0,d.jsx)(f(),{href:"/docs/mcp",className:"text-zinc-400 hover:text-zinc-200",children:"MCP Server"})]})]})}),(0,d.jsxs)("main",{className:"mx-auto max-w-6xl px-6 py-12",children:[(0,d.jsxs)("div",{className:"max-w-3xl mb-12",children:[(0,d.jsxs)("div",{className:"flex items-center gap-2 mb-4",children:[(0,d.jsx)("span",{className:"rounded-full bg-blue-400/10 px-3 py-1 text-xs font-medium text-blue-400",children:"REST API"}),(0,d.jsx)("span",{className:"rounded-full bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-400",children:"v1.0.0"})]}),(0,d.jsx)("h1",{className:"text-4xl font-semibold tracking-tight",children:"API Reference"}),(0,d.jsx)("p",{className:"mt-4 text-lg text-zinc-400",children:"Complete REST API documentation for Agentix Protocol. All endpoints return JSON with consistent error handling."}),(0,d.jsxs)("div",{className:"mt-4 p-3 rounded-lg bg-zinc-900/50 border border-zinc-800",children:[(0,d.jsx)("div",{className:"text-xs text-zinc-500 mb-1",children:"Base URL"}),(0,d.jsx)("code",{className:"text-sm font-mono text-zinc-300",children:"http://127.0.0.1:3001 (dev) | https://api.agentix.io (prod)"})]})]}),(0,d.jsx)("div",{className:"grid gap-3 sm:grid-cols-4 mb-16",children:[{label:"Authentication",id:"auth"},{label:"Organizations",id:"orgs"},{label:"Agents",id:"agents"},{label:"Executions",id:"executions"}].map(({label:a,id:b})=>(0,d.jsx)("a",{href:`#${b}`,className:"text-sm text-zinc-400 hover:text-zinc-200 text-center py-2 rounded-lg border border-zinc-800 hover:border-zinc-700 transition-colors",children:a},b))}),(0,d.jsxs)(F,{id:"auth",title:"Authentication",icon:i.A,children:[(0,d.jsx)("p",{className:"text-zinc-400 mb-6",children:"All mutating operations require wallet signatures using EIP-191 personal_sign. This ensures only the wallet owner can perform actions on their behalf."}),(0,d.jsx)(E,{code:u})]}),(0,d.jsxs)(F,{id:"orgs",title:"Organizations",icon:k,children:[(0,d.jsx)("p",{className:"text-zinc-400 mb-6",children:"Organizations group agents, credentials, wallets, and sessions under a single entity."}),(0,d.jsx)(E,{code:v}),(0,d.jsx)("h3",{className:"text-lg font-medium mb-4 mt-8",children:"Endpoints"}),(0,d.jsxs)("div",{className:"grid gap-2",children:[(0,d.jsx)(G,{method:"GET",path:"/orgs",description:"List all organizations"}),(0,d.jsx)(G,{method:"POST",path:"/orgs",description:"Create organization (signed)"}),(0,d.jsx)(G,{method:"GET",path:"/orgs/:orgId/state",description:"Get org with all related data"})]})]}),(0,d.jsxs)(F,{id:"agents",title:"Agents",icon:l.A,children:[(0,d.jsx)("p",{className:"text-zinc-400 mb-6",children:"Protocol-native agents with ZK credentials. Use the provision endpoint to auto-create org and agent."}),(0,d.jsx)(E,{code:w}),(0,d.jsx)("h3",{className:"text-lg font-medium mb-4 mt-8",children:"Endpoints"}),(0,d.jsxs)("div",{className:"grid gap-2",children:[(0,d.jsx)(G,{method:"GET",path:"/agents?orgId=:id",description:"List agents for org"}),(0,d.jsx)(G,{method:"GET",path:"/agents/:agentId",description:"Get single agent"}),(0,d.jsx)(G,{method:"POST",path:"/v1/agents/provision",description:"Provision new agent"})]})]}),(0,d.jsxs)(F,{id:"external",title:"External Agents",icon:m.A,children:[(0,d.jsx)("p",{className:"text-zinc-400 mb-6",children:"External AI runtimes (OpenClaude, LangChain, etc.) registered with Agentix. These map to protocol-native agents via `linked_agent_id`."}),(0,d.jsx)(E,{code:x}),(0,d.jsx)("h3",{className:"text-lg font-medium mb-4 mt-8",children:"Supported Agent Types"}),(0,d.jsx)("div",{className:"grid gap-2 sm:grid-cols-4",children:["openclaude","langchain","claude_code","crewai","llama_index","autogen","smolagents","custom"].map(a=>(0,d.jsx)("div",{className:"p-2 rounded border border-zinc-800 bg-zinc-900/30 text-center text-sm font-mono",children:a},a))}),(0,d.jsx)("h3",{className:"text-lg font-medium mb-4 mt-8",children:"Endpoints"}),(0,d.jsxs)("div",{className:"grid gap-2",children:[(0,d.jsx)(G,{method:"GET",path:"/external?orgId=:id",description:"List external agents"}),(0,d.jsx)(G,{method:"POST",path:"/external",description:"Create external agent (signed)"}),(0,d.jsx)(G,{method:"GET",path:"/external/:agentId",description:"Get single agent"}),(0,d.jsx)(G,{method:"PATCH",path:"/external/:agentId",description:"Update agent"})]})]}),(0,d.jsxs)(F,{id:"executions",title:"Executions",icon:n.A,children:[(0,d.jsx)("p",{className:"text-zinc-400 mb-6",children:"Execute actions on external agents and monitor execution history."}),(0,d.jsx)(E,{code:y}),(0,d.jsx)("h3",{className:"text-lg font-medium mb-4 mt-8",children:"Action Types"}),(0,d.jsx)("div",{className:"grid gap-2",children:[{action:"read_file",params:"{ path: string }",desc:"Read file contents"},{action:"write_file",params:"{ path, content }",desc:"Write file contents"},{action:"execute_command",params:"{ command, args?, cwd? }",desc:"Run shell command"},{action:"query",params:"{ query, params? }",desc:"Database query"},{action:"api_call",params:"{ url, method?, headers?, body? }",desc:"HTTP API call"},{action:"sign_transaction",params:"{ to, value, data? }",desc:"Sign blockchain tx"},{action:"deploy_contract",params:"{ bytecode, abi, constructorArgs? }",desc:"Deploy contract"},{action:"custom",params:"{ customType, ... }",desc:"Custom action"}].map(({action:a,params:b,desc:c})=>(0,d.jsxs)("div",{className:"flex items-center gap-4 p-3 rounded-lg border border-zinc-800 bg-zinc-900/30",children:[(0,d.jsx)("code",{className:"text-sm font-mono text-blue-400",children:a}),(0,d.jsx)("code",{className:"text-xs font-mono text-zinc-500",children:b}),(0,d.jsx)("span",{className:"text-sm text-zinc-400 ml-auto",children:c})]},a))}),(0,d.jsx)("h3",{className:"text-lg font-medium mb-4 mt-8",children:"Endpoints"}),(0,d.jsxs)("div",{className:"grid gap-2",children:[(0,d.jsx)(G,{method:"POST",path:"/external/:agentId/execute",description:"Execute action (signed)"}),(0,d.jsx)(G,{method:"GET",path:"/external/:agentId/executions",description:"Get execution history"}),(0,d.jsx)(G,{method:"GET",path:"/external/:agentId/executions/stats",description:"Get execution stats"})]})]}),(0,d.jsxs)(F,{id:"credentials",title:"Credentials",icon:o.A,children:[(0,d.jsx)("p",{className:"text-zinc-400 mb-6",children:"ZK-backed credentials authorize agents to perform specific actions. Each credential has permission bitmasks and expiry."}),(0,d.jsx)(E,{code:z})]}),(0,d.jsxs)(F,{id:"sessions",title:"Sessions",icon:p.A,children:[(0,d.jsx)("p",{className:"text-zinc-400 mb-6",children:"On-chain sessions with ZK proofs for time-limited authorizations. Sessions allow agents to transact on behalf of wallets."}),(0,d.jsx)(E,{code:A})]}),(0,d.jsxs)(F,{id:"wallets",title:"Wallets",icon:q.A,children:[(0,d.jsx)("p",{className:"text-zinc-400 mb-6",children:"ERC-4337 compliant smart contract wallets deployed for agents. Includes whitelist management for allowed contracts."}),(0,d.jsx)(E,{code:B})]}),(0,d.jsxs)(F,{id:"events",title:"Events",icon:r,children:[(0,d.jsx)("p",{className:"text-zinc-400 mb-6",children:"Indexed blockchain events for session management, credentials, and wallet operations."}),(0,d.jsx)(E,{code:C})]}),(0,d.jsxs)(F,{id:"errors",title:"Error Handling",icon:i.A,children:[(0,d.jsx)("p",{className:"text-zinc-400 mb-6",children:"All errors follow a consistent JSON format with error code and message."}),(0,d.jsx)(E,{code:D})]}),(0,d.jsx)(F,{id:"rate-limits",title:"Rate Limits",icon:o.A,children:(0,d.jsxs)("div",{className:"grid gap-4 sm:grid-cols-3",children:[(0,d.jsxs)("div",{className:"p-4 rounded-lg border border-zinc-800 bg-zinc-900/30",children:[(0,d.jsx)("div",{className:"text-sm text-zinc-500 mb-1",children:"Production"}),(0,d.jsx)("div",{className:"text-2xl font-semibold",children:"100"}),(0,d.jsx)("div",{className:"text-sm text-zinc-500",children:"requests / 15 min"})]}),(0,d.jsxs)("div",{className:"p-4 rounded-lg border border-zinc-800 bg-zinc-900/30",children:[(0,d.jsx)("div",{className:"text-sm text-zinc-500 mb-1",children:"Development"}),(0,d.jsx)("div",{className:"text-2xl font-semibold",children:"1000"}),(0,d.jsx)("div",{className:"text-sm text-zinc-500",children:"requests / 15 min"})]}),(0,d.jsxs)("div",{className:"p-4 rounded-lg border border-zinc-800 bg-zinc-900/30",children:[(0,d.jsx)("div",{className:"text-sm text-zinc-500 mb-1",children:"Auth Endpoints"}),(0,d.jsx)("div",{className:"text-2xl font-semibold",children:"10"}),(0,d.jsx)("div",{className:"text-sm text-zinc-500",children:"requests / 1 min"})]})]})}),(0,d.jsxs)("div",{className:"mt-16 rounded-lg border border-zinc-800 bg-zinc-900/30 p-8",children:[(0,d.jsx)("h3",{className:"text-xl font-semibold mb-4",children:"Next Steps"}),(0,d.jsxs)("div",{className:"grid gap-4 sm:grid-cols-2",children:[(0,d.jsxs)(f(),{href:"/docs/sdk",className:"flex items-center gap-3 p-4 rounded-lg border border-zinc-800 hover:border-zinc-700 transition-colors",children:[(0,d.jsx)(n.A,{className:"h-5 w-5 text-emerald-400"}),(0,d.jsxs)("div",{children:[(0,d.jsx)("div",{className:"font-medium",children:"SDK Reference"}),(0,d.jsx)("div",{className:"text-sm text-zinc-500",children:"TypeScript SDK"})]}),(0,d.jsx)(s.A,{className:"h-4 w-4 text-zinc-600 ml-auto"})]}),(0,d.jsxs)(f(),{href:"/docs/mcp",className:"flex items-center gap-3 p-4 rounded-lg border border-zinc-800 hover:border-zinc-700 transition-colors",children:[(0,d.jsx)(m.A,{className:"h-5 w-5 text-pink-400"}),(0,d.jsxs)("div",{children:[(0,d.jsx)("div",{className:"font-medium",children:"MCP Server"}),(0,d.jsx)("div",{className:"text-sm text-zinc-500",children:"Model Context Protocol"})]}),(0,d.jsx)(s.A,{className:"h-4 w-4 text-zinc-600 ml-auto"})]})]})]})]}),(0,d.jsx)("footer",{className:"border-t border-zinc-800 mt-20",children:(0,d.jsxs)("div",{className:"mx-auto max-w-6xl px-6 py-8 text-sm text-zinc-500 text-center",children:["Agentix Protocol • MIT License • ",(0,d.jsx)(f(),{href:"https://github.com/SRIVISHNUGV-DEV/AGENTIX",className:"hover:text-zinc-300",children:"GitHub"})]})})]})}},77068:a=>{a.exports=require("next/dist/shared/lib/size-limit")},86439:a=>{a.exports=require("next/dist/shared/lib/no-fallback-error.external")},98739:(a,b,c)=>{c.d(b,{A:()=>d});let d=(0,c(53712).A)("server",[["rect",{width:"20",height:"8",x:"2",y:"2",rx:"2",ry:"2",key:"ngkwjq"}],["rect",{width:"20",height:"8",x:"2",y:"14",rx:"2",ry:"2",key:"iecqi9"}],["line",{x1:"6",x2:"6.01",y1:"6",y2:"6",key:"16zg32"}],["line",{x1:"6",x2:"6.01",y1:"18",y2:"18",key:"nzw8ys"}]])}};var b=require("../../../webpack-runtime.js");b.C(a);var c=b.X(0,[1042,375,8672,978,2114],()=>b(b.s=35802));module.exports=c})();