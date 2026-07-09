var X=Object.defineProperty;var Z=(t,e,o)=>e in t?X(t,e,{enumerable:!0,configurable:!0,writable:!0,value:o}):t[e]=o;var O=(t,e,o)=>Z(t,typeof e!="symbol"?e+"":e,o);import{t as K,h as Y,b as Q}from"./rank-history-DtmErhKb.js";class k extends Error{constructor(e,o){super(e),this.code=o,this.name="OpenAIError"}}const ee=2.5/1e6,te=10/1e6;class N{constructor(e){O(this,"apiKey");O(this,"baseUrl","https://api.openai.com/v1");this.apiKey=e}async chat(e,o={}){var m,g,f,y,w;const i=o.model??"gpt-4o",n=o.temperature??.7,s=o.maxTokens??2048;let r;try{r=await fetch(`${this.baseUrl}/chat/completions`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${this.apiKey}`},body:JSON.stringify({model:i,messages:e,temperature:n,max_tokens:s})})}catch{throw new k("Failed to connect to OpenAI API. Check your internet connection.","connection_failed")}r.ok||await this.handleErrorResponse(r);const a=await r.json(),l=((f=(g=(m=a.choices)==null?void 0:m[0])==null?void 0:g.message)==null?void 0:f.content)??"",c=((y=a.usage)==null?void 0:y.prompt_tokens)??0,d=((w=a.usage)==null?void 0:w.completion_tokens)??0;return{content:l,inputTokens:c,outputTokens:d}}static estimateTokens(e){return e?Math.ceil(e.length/4):0}static estimateCost(e,o){return e*ee+o*te}async handleErrorResponse(e){var n,s;let o={};try{o=await e.json()}catch{}const i=((n=o.error)==null?void 0:n.message)??"";switch(e.status){case 401:throw new k("Invalid API key. Please check your OpenAI API key in Settings.","invalid_api_key");case 429:throw new k("Rate limited by OpenAI. Please wait a moment and try again.","rate_limited");case 402:throw new k("Insufficient OpenAI credits. Please add credits to your OpenAI account.","no_credits");default:throw((s=o.error)==null?void 0:s.code)==="insufficient_quota"?new k("Insufficient OpenAI credits. Please add credits to your OpenAI account.","no_credits"):new k(i||`OpenAI API error (HTTP ${e.status})`,"api_error")}}}function U(t){return Math.round(t*10)/10}function F(t){return!!t.devReplyText&&t.devReplyText.trim().length>0}function oe(t){const e=t.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");return new RegExp(`\\b${e}\\b`,"i")}function ne(t){const e=new Map;for(const o of t){const i=o.versionReviewed;if(!i)continue;const n=e.get(i)??{count:0,sum:0,latest:0};n.count+=1,n.sum+=o.rating,n.latest=Math.max(n.latest,o.postedAtEpoch),e.set(i,n)}return[...e.entries()].sort((o,i)=>i[1].latest-o[1].latest).slice(0,2).map(([o,i])=>({version:o,count:i.count,avgRating:U(i.sum/i.count)}))}function H(t,e,o,i={}){const n=i.referenceDate??K(),s=i.recentWindowDays??30,r=i.recentSampleSize??10,a=t.filter(u=>u.rating>=1&&u.rating<=5),l=a.length>0?U(a.reduce((u,p)=>u+p.rating,0)/a.length):null;let c=0,d=0;for(const u of t){if(u.postedDate>n)continue;const p=Y(u.postedDate,n);p<s?c+=1:p<s*2&&(d+=1)}const m=[...a].filter(u=>u.postedDate<=n).sort((u,p)=>p.postedAtEpoch-u.postedAtEpoch).slice(0,r),g=m.length>0?U(m.reduce((u,p)=>u+p.rating,0)/m.length):null,f=t.filter(F).length,y=t.length>0?Math.round(f/t.length*100):0,w=t.filter(u=>u.rating<=3),T=w.filter(F).length,v=w.length>0?Math.round(T/w.length*100):null,S=new Set;for(const u of t)u.language&&S.add(u.language);const E=o.map(u=>{const p=oe(u),P=u.toLowerCase();let _=0,L=0;for(const J of t){const M=J.text??"";M&&(M.toLowerCase().includes(P)&&(L+=1),p.test(M)&&(_+=1))}return{keyword:u,fullWord:_,partial:L}});return{capturedCount:t.length,totalRatings:(e==null?void 0:e.ratingCount)??null,textReviewCount:i.textReviewCount??null,capturedAvgRating:l,lifetimeAvgRating:(e==null?void 0:e.rating)??null,recentCount:c,priorCount:d,recentAvgRating:g,devReplyRatePct:y,devReplyRateLowPct:v,languages:[...S].sort(),versionRatings:ne(t),keywordHits:E}}const ie="No review scan yet";function W(t,e){return t&&t.capturedCount>0?e(t):ie}function re(t,e){return t===null||e===null?"":t<e-.1?" ↓":t>e+.1?" ↑":""}function se(t){const e=t.recentCount>t.priorCount?"rising":t.recentCount<t.priorCount?"falling":"flat";return`${t.recentCount} vs ${t.priorCount} (${e})`}function ae(t){return t.versionRatings.length===0?"n/a":t.versionRatings.map(e=>`${e.version}: ${e.avgRating}★ (n=${e.count})`).join("; ")}function ce(t){return t.keywordHits.length===0?"n/a":t.keywordHits.map(e=>`${e.keyword}: ${e.fullWord}/${e.partial}`).join("; ")}function z(t){return t.replace(/\r?\n/g," ").replace(/\|/g,"\\|")}function le(t,e){const o=!!t&&t.capturedCount>0,i=!!e&&e.capturedCount>0;return!o&&!i?"":["## Review Signals","_Based on the reviews captured locally for each extension — a sample accumulated across scans (may include rating-only reviews), NOT the full rating population. Use for diagnosis and keyword discovery; do not treat as a ranking score._","","| Signal | Your Extension | Competitor |","|--------|----------------|------------|",...[["Captured reviews (sample size)",r=>String(r.capturedCount)],["Total ratings / CWS text reviews",r=>`${r.totalRatings??"n/a"} / ${r.textReviewCount??"n/a"}`],["Captured avg star",r=>(r.capturedAvgRating??"n/a").toString()],["Lifetime avg (listing)",r=>(r.lifetimeAvgRating??"n/a").toString()],["Recent avg (newest sample)",r=>`${r.recentAvgRating??"n/a"}${re(r.recentAvgRating,r.lifetimeAvgRating)}`],["Velocity (last 30d vs prior 30d)",se],["Dev reply rate (all / ≤3★)",r=>`${r.devReplyRatePct}% / ${r.devReplyRateLowPct===null?"n/a":r.devReplyRateLowPct+"%"}`],["Languages in sample",r=>r.languages.length?`${r.languages.join(", ")} (${r.languages.length})`:"n/a"],["Recent version ratings",ae],["Keyword in reviews (full / partial)",ce]].map(([r,a])=>`| ${r} | ${z(W(t,a))} | ${z(W(e,a))} |`)].join(`
`)}function Ye(t){if(!t||t.length===0)return"0";let e=0;for(const o of t){const i=`${o.reviewId}:${o.contentHash}`;let n=5381;for(let s=0;s<i.length;s++)n=(n<<5)+n+i.charCodeAt(s)|0;e=e+(n>>>0)|0}return`${t.length}.${(e>>>0).toString(36)}`}const pe={title:{minLength:10,optimalMin:20,optimalMax:60,maxLength:70},shortDescription:{minLength:40,optimalMin:80,maxLength:132},fullDescription:{minWords:50,optimalMinWords:150,optimalMaxWords:1e3,maxWords:1500},screenshots:{optimalMin:3,optimalMax:5},translations:{good:10,excellent:20},rating:{excellent:4.5,good:4,fair:3.5},reviews:{excellent:100,good:50,fair:10},freshness:{fresh:90,recent:180,aging:270,stale:365},permissionRisk:{low:20,medium:50,high:80}},V=new Set(["en","es","pt_BR","fr","de","ja","zh_CN","zh_TW","ko","ru","ar","hi","it","nl","pl","tr"]),I={title:.15,shortDescription:.1,fullDescription:.15,visualAssets:.15,ratingsReviews:.1,translations:.1,updateFreshness:.1,permissions:.1,developerProfile:.05};function D(t,e){if(!t||!e)return!1;const o=e.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");return new RegExp(`\\b${o}\\b`,"i").test(t)}function B(t,e){if(!t||!e)return 0;const o=t.trim().split(/\s+/).filter(c=>c.length>0);if(o.length===0)return 0;const i=e.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"),n=new RegExp(`\\b${i}\\b`,"gi"),s=t.match(n),r=s?s.length:0;if(r===0)return 0;const a=e.trim().split(/\s+/).length,l=r*a/o.length*100;return l>=.5&&l<=2.5?100:l<.5?Math.round(l/.5*100):l<=5?Math.round(100-60*((l-2.5)/2.5)):20}function de(t,e,o){const i=t.length,n=e.title;let s;if(i===0?s=0:i<n.minLength?s=20:i>=n.optimalMin&&i<=n.optimalMax?s=100:i>n.maxLength?s=30:i<n.optimalMin?s=20+80*((i-n.minLength)/(n.optimalMin-n.minLength)):s=100-70*((i-n.optimalMax)/(n.maxLength-n.optimalMax)),!o)return Math.round(s);const r=D(t,o)?100:0;return Math.round(s*.7+r*.3)}function ue(t,e,o){const i=t.length,n=e.shortDescription;let s;if(i===0?s=0:i<n.minLength?s=20+30*(i/n.minLength):i>=n.optimalMin?s=100:s=50+50*((i-n.minLength)/(n.optimalMin-n.minLength)),!o)return Math.round(s);const r=D(t,o)?100:0;return Math.round(s*.7+r*.3)}function me(t,e,o){if(t.length===0)return 0;const n=t.trim().split(/\s+/).filter(g=>g.length>0).length,s=e.fullDescription;let r;n<s.minWords?r=20*(n/s.minWords):n>=s.optimalMinWords?r=100:r=20+80*((n-s.minWords)/(s.optimalMinWords-s.minWords));const a=t.split(/\n\s*\n/).filter(g=>g.trim().length>0).length,l=/\n/.test(t),c=/^[\s]*[-*\u2022]/m.test(t);let d=0;if(a>=3?d+=50:a>=2?d+=30:l&&(d+=15),c&&(d+=30),n>=s.optimalMinWords&&(d+=20),d=Math.min(d,100),!o)return Math.round(r*.7+d*.3);const m=B(t,o);return Math.round(r*.5+d*.25+m*.25)}function ge(t,e,o){const i=o.screenshots;let n;t===0?n=0:t>=i.optimalMin&&t<=i.optimalMax?n=100:t<i.optimalMin?n=30+70*(t/i.optimalMin):n=100;const s=e?100:0;return Math.round(n*.8+s*.2)}function he(t,e,o){const i=o.rating,n=o.reviews;let s;t===null?s=0:t>=i.excellent?s=100:t>=i.good?s=70+30*((t-i.good)/(i.excellent-i.good)):t>=i.fair?s=40+30*((t-i.fair)/(i.good-i.fair)):s=40*(t/i.fair);let r;return e>=n.excellent?r=100:e>=n.good?r=70+30*((e-n.good)/(n.excellent-n.good)):e>=n.fair?r=40+30*((e-n.fair)/(n.good-n.fair)):e>0?r=40*(e/n.fair):r=0,Math.round(s*.6+r*.4)}function fe(t,e,o){const i=o.translations;if(t<=1)return 0;let n;t>=i.excellent?n=100:t>=i.good?n=70+30*((t-i.good)/(i.excellent-i.good)):n=70*((t-1)/(i.good-1));const r=e.filter(l=>V.has(l)).length/V.size,a=Math.round(r*100);return Math.round(n*.6+a*.4)}function we(t,e){const o=e.freshness,i=K();let n;try{n=Y(t,i)}catch{return 0}return isNaN(n)?0:n<=o.fresh?100:n<=o.recent?80+20*((o.recent-n)/(o.recent-o.fresh)):n<=o.aging?50+30*((o.aging-n)/(o.aging-o.recent)):n<=o.stale?20+30*((o.stale-n)/(o.stale-o.aging)):0}function ye(t,e){const o=e.permissionRisk;return t<=o.low?100:t<=o.medium?70+30*((o.medium-t)/(o.medium-o.low)):t<=o.high?40+30*((o.high-t)/(o.high-o.medium)):0}function ve(t,e){return!t||t.trim().length===0?0:e?100:40}function ke(t,e,o,i){const n=[];for(const s of t){if(s.score>80)continue;const r=s.score<30?"high":s.score<50?"medium":"low";switch(s.name){case"title":{const a=e.title.length,l=o.title;a===0?n.push({component:"title",message:"Add a title to your extension listing.",priority:r}):a<l.optimalMin?n.push({component:"title",message:`Your title is ${a} characters. Consider expanding to ${l.optimalMin}-${l.optimalMax} characters for better keyword coverage.`,priority:r}):a>l.maxLength&&n.push({component:"title",message:`Your title is ${a} characters, which may appear keyword-stuffed. Consider trimming to under ${l.maxLength} characters.`,priority:r});break}case"shortDescription":{const a=e.shortDescription.length,l=o.shortDescription;a===0?n.push({component:"shortDescription",message:"Add a short description to your listing.",priority:r}):a<l.optimalMin&&n.push({component:"shortDescription",message:`Your short description is ${a}/${l.maxLength} characters. Use more of the available space (aim for ${l.optimalMin}+ characters) to include keywords and a call-to-action.`,priority:r});break}case"fullDescription":{const l=e.fullDescription.trim().split(/\s+/).filter(m=>m.length>0).length,c=o.fullDescription;l===0?n.push({component:"fullDescription",message:"Add a detailed description to your listing.",priority:r}):l<c.optimalMinWords&&n.push({component:"fullDescription",message:`Your description is ${l} words. Consider expanding to ${c.optimalMinWords}+ words with feature details, use cases, and keywords.`,priority:r}),e.fullDescription.split(/\n\s*\n/).filter(m=>m.trim().length>0).length<3&&l>=c.minWords&&n.push({component:"fullDescription",message:"Structure your description with multiple paragraphs, bullet points, and clear sections for better readability.",priority:"low"});break}case"visualAssets":{const a=o.screenshots;if(e.screenshotCount===0)n.push({component:"visualAssets",message:`Add screenshots to your listing. Aim for ${a.optimalMin}-${a.optimalMax} screenshots showing key features.`,priority:r});else if(e.screenshotCount<a.optimalMin){const l=a.optimalMin-e.screenshotCount;n.push({component:"visualAssets",message:`Add ${l} more screenshot${l>1?"s":""} to reach the optimal count of ${a.optimalMin}-${a.optimalMax}.`,priority:r})}e.hasPromoVideo||n.push({component:"visualAssets",message:"Consider adding a promotional video to showcase your extension in action.",priority:"low"});break}case"ratingsReviews":{e.rating===null?n.push({component:"ratingsReviews",message:"Your extension has no ratings yet. Encourage users to leave reviews.",priority:r}):e.rating<o.rating.good&&n.push({component:"ratingsReviews",message:`Your rating is ${e.rating.toFixed(1)} stars. Focus on fixing user complaints to improve your rating above ${o.rating.good}.`,priority:r}),e.reviewCount<o.reviews.fair&&n.push({component:"ratingsReviews",message:`You have ${e.reviewCount} reviews. Aim for at least ${o.reviews.fair} reviews to build credibility.`,priority:r});break}case"translations":{if(e.translationCount<=1)n.push({component:"translations",message:`Your extension is only available in 1 locale. Translate to ${o.translations.good}+ locales to reach more users.`,priority:r});else if(e.translationCount<o.translations.good){const a=o.translations.good-e.translationCount;n.push({component:"translations",message:`Add ${a} more locale${a>1?"s":""} to reach ${o.translations.good} supported locales. Focus on major markets.`,priority:r})}break}case"updateFreshness":{const a=K();let l;try{l=Y(e.lastUpdated,a)}catch{l=1/0}l>o.freshness.recent&&n.push({component:"updateFreshness",message:`Your extension was last updated ${l} days ago. Regular updates signal active maintenance to users and CWS.`,priority:r});break}case"permissions":{e.permissionRiskScore>o.permissionRisk.medium&&n.push({component:"permissions",message:"Your extension requests high-risk permissions. Consider if all permissions are necessary, as users see install warnings for risky permissions.",priority:r});break}case"developerProfile":{e.developerVerified||n.push({component:"developerProfile",message:"Verify your developer account on Chrome Web Store to build trust with users.",priority:r});break}}}return i&&(D(e.title,i)||n.push({component:"title",message:`Your title does not contain the keyword "${i}". Including the target keyword in the title is the strongest relevance signal.`,priority:"high"}),D(e.shortDescription,i)||n.push({component:"shortDescription",message:`Your short description does not contain the keyword "${i}". Add it to improve keyword relevance.`,priority:"medium"}),B(e.fullDescription,i)<50&&n.push({component:"fullDescription",message:`Low keyword density for "${i}" in your full description. Consider adding the keyword naturally 2-4 more times.`,priority:"medium"})),n}function j(t,e=pe,o){const i=o==null?void 0:o.keyword,n={title:de(t.title,e,i),shortDescription:ue(t.shortDescription,e,i),fullDescription:me(t.fullDescription,e,i),visualAssets:ge(t.screenshotCount,t.hasPromoVideo,e),ratingsReviews:he(t.rating,t.reviewCount,e),translations:fe(t.translationCount,t.availableLocales,e),updateFreshness:we(t.lastUpdated,e),permissions:ye(t.permissionRiskScore,e),developerProfile:ve(t.developerName,t.developerVerified)},s=Object.keys(I).map(l=>({name:l,score:Math.round(n[l]),weight:I[l],weightedScore:Math.round(n[l]*I[l]*100)/100})),r=Math.round(s.reduce((l,c)=>l+c.score*c.weight,0)),a=ke(s,t,e,i);return{totalScore:Math.min(Math.max(r,0),100),components:s,recommendations:a}}const $=`

## Interpreting the "Review Signals" block
If a "Review Signals" section is present, treat it as supplementary CONTEXT, not a ranking scorecard:
- Its numbers come from the reviews captured locally (a sample, NOT the full rating population) — never present them as totals.
- Reviews correlate with popularity and lag ranking. Do NOT claim reviews cause the rank gap. Use them to (a) surface the words users actually use (keyword-discovery input for title/description) and (b) flag recent rating, velocity, or version-linked trends worth investigating.
- Do not invent numeric ranking weights for review signals.`,Re=`You are a Chrome Web Store ASO (App Store Optimization) analyst specializing in keyword ranking diagnostics.

## Your Domain Knowledge
CWS search ranking is influenced by these factors (approximate weight order):
1. Keyword relevance — exact match in title > short description > full description
2. User base size and growth trajectory
3. Rating score and volume (both matter)
4. Update recency and frequency
5. Listing completeness — screenshots, localization count, promo video
6. Permission scope — fewer permissions = higher trust signal
7. Install retention and engagement (not directly visible in listing data)

## Your Task
Analyze why a competitor extension outranks the user's extension for a specific keyword (or set of keywords). Follow this reasoning process:

1. **Text relevance**: Compare how each listing's title, short description, and full description align with the keyword(s). Note exact-match vs partial-match placement.
2. **Metric gaps**: Identify the most impactful metric differences (users, ratings, quality score, etc.). Cite specific numbers from the data.
3. **Trend analysis**: If historical ranking/autocomplete data is provided, identify trajectory (improving, declining, stable) and correlate rank shifts with events (version updates, description changes, user milestones).
4. **Actionable recommendations**: Provide specific, implementable changes. Each recommendation should explain the expected impact.

## Output Format
Respond with valid JSON only (no markdown fences, no commentary outside JSON):
{
  "relevanceAnalysis": "2-3 paragraphs analyzing keyword alignment for both listings. Cite specific text from titles/descriptions.",
  "metricComparison": "2-3 paragraphs comparing metrics with specific numbers. Highlight the largest gaps.",
  "trendAnalysis": "1-2 paragraphs on ranking trajectory and correlation with events. Write 'No historical data provided.' if no trend data was given.",
  "recommendations": [
    {
      "area": "Category (e.g., Title, Description, Screenshots, Ratings, Localization, Permissions, Updates)",
      "suggestion": "Specific actionable change — not generic advice",
      "priority": "high|medium|low",
      "impact": "Expected outcome if implemented (e.g., 'Could improve keyword match score and move from #8 to top 5')"
    }
  ]
}

Provide 3-6 recommendations sorted by priority (high first). Every suggestion must reference actual data from the input — never give advice that could apply to any extension generically.`+$,Se=`Analyze why the competitor extension ranks higher for the keyword "{{keyword}}".

{{keywordPositions}}

## Your Extension
- **Title**: {{ownTitle}}
- **Position**: {{ownPosition}}
- **Short Description**: {{ownShortDescription}}
- **Full Description**:
<full-description>
{{ownFullDescription}}
</full-description>
- **Rating**: {{ownRating}}
- **Users**: {{ownUsers}}
- **Version**: {{ownVersion}}
- **Screenshots**: {{ownScreenshots}}
- **Translations**: {{ownTranslations}}
- **Quality Score**: {{ownQualityScore}}
- **Permission Risk**: {{ownPermissionRisk}}

## Competitor Extension
- **Title**: {{compTitle}}
- **Position**: {{compPosition}}
- **Short Description**: {{compShortDescription}}
- **Full Description**:
<full-description>
{{compFullDescription}}
</full-description>
- **Rating**: {{compRating}}
- **Users**: {{compUsers}}
- **Version**: {{compVersion}}
- **Screenshots**: {{compScreenshots}}
- **Translations**: {{compTranslations}}
- **Quality Score**: {{compQualityScore}}
- **Permission Risk**: {{compPermissionRisk}}

## Ranking Trends (last 14 days)
Your search rank: {{ownRankHistory14d}}
Competitor search rank: {{compRankHistory14d}}
Your autocomplete position: {{ownAutocomplete14d}}
Competitor autocomplete position: {{compAutocomplete14d}}

## Recent Changes & Events (last 14 days)
Your extension: {{ownEvents14d}}
Competitor: {{compEvents14d}}

{{reviewSignals}}`,Te=`You are a Chrome Web Store ASO (App Store Optimization) analyst specializing in keyword ranking diagnostics.

## Your Domain Knowledge
CWS search ranking is influenced by these factors (estimated weight):
1. **Keyword relevance (35-40%)** — exact match in title (strongest), short description, full description. Position and density matter.
2. **User base & growth (20-25%)** — total installs and recent growth trajectory signal product-market fit.
3. **Rating quality (15-20%)** — composite of average rating AND total rating volume. A 4.7 with 2,500 ratings outweighs a 4.9 with 50 ratings.
4. **Update recency (5-10%)** — extensions updated within the last 30 days receive a freshness boost.
5. **Listing completeness (5-10%)** — screenshot count, localization breadth, promo video presence.
6. **Permission scope (3-5%)** — fewer permissions = higher trust signal. High-risk permissions penalize ranking.
7. **Install retention (unmeasurable)** — not directly visible in listing data but influences ranking over time.

## Your Task
Analyze why a competitor extension outranks the user's extension for a specific keyword (or set of keywords). Use the scratchpad to reason step-by-step before giving your final analysis.

## Output Format
Respond with valid JSON only (no markdown fences, no commentary outside JSON):
{
  "scratchpad": "Your private reasoning: step through each ranking factor, note which favors whom and by how much. Calculate gaps. This field is for your working notes — be thorough.",
  "relevanceAnalysis": "2-3 paragraphs analyzing keyword alignment for both listings. Cite specific text from titles/descriptions.",
  "metricComparison": "2-3 paragraphs comparing metrics with specific numbers. Highlight the largest gaps.",
  "trendAnalysis": "1-2 paragraphs on ranking trajectory and correlation with events. Write 'No historical data provided.' if no trend data was given.",
  "recommendations": [
    {
      "area": "Category (e.g., Title, Description, Screenshots, Ratings, Localization, Permissions, Updates)",
      "suggestion": "Specific actionable change — not generic advice",
      "priority": "high|medium|low",
      "impact": "Expected outcome if implemented (e.g., 'Could improve keyword match score and move from #8 to top 5')"
    }
  ]
}

Provide 3-6 recommendations sorted by priority (high first). Every suggestion must reference actual data from the input.

## Few-Shot Example
Input summary: "Tab Sorter" (#7) vs "Smart Tab Manager" (#2) for keyword "tab manager"
Example output:
{
  "scratchpad": "Keyword 'tab manager': competitor has exact match in title ('Smart Tab Manager'), user has partial match ('Tab Sorter'). Users: 500K vs 12K — 41x gap, huge signal. Rating: 4.6/5 (3,200) vs 4.3/5 (89) — competitor wins on both score and volume. Screenshots: 5 vs 2. Translations: 18 vs 3. Competitor updated 5 days ago vs user 45 days ago. Biggest levers: title keyword match, user base gap, update frequency.",
  "relevanceAnalysis": "The competitor 'Smart Tab Manager' contains an exact match for 'tab manager' in its title, which is the strongest keyword relevance signal in CWS search. The user's extension 'Tab Sorter' only contains 'Tab' — missing 'manager' entirely. In the short descriptions, the competitor mentions 'manage your tabs' (semantic match), while the user focuses on 'sorting tabs by URL'. The competitor's full description uses 'tab manager' and variants 8 times vs 2 times in the user's description.",
  "metricComparison": "The most significant gap is the user base: 500,000+ vs 12,000+ users (41x difference). This alone is likely the primary ranking factor. Rating quality also favors the competitor: 4.6/5 with 3,200 ratings vs 4.3/5 with 89 ratings. The competitor has 5 screenshots vs 2, and 18 localizations vs 3.",
  "trendAnalysis": "No historical data provided.",
  "recommendations": [
    {"area": "Title", "suggestion": "Rename to 'Tab Sorter & Manager' to include exact keyword match for 'tab manager'", "priority": "high", "impact": "Title keyword match is the strongest relevance signal — could improve from #7 to #4-5"},
    {"area": "Description", "suggestion": "Add 'tab manager' phrase 3-4 more times naturally in the full description, especially in the first paragraph", "priority": "high", "impact": "Better keyword density in description reinforces title match"},
    {"area": "Updates", "suggestion": "Publish an update — current version is 45 days old vs competitor's 5 days", "priority": "medium", "impact": "Freshness boost from recent update could improve position by 1-2 spots"},
    {"area": "Screenshots", "suggestion": "Add 3 more screenshots showing key features", "priority": "medium", "impact": "Improves listing quality score and conversion rate"},
    {"area": "Localization", "suggestion": "Add at least 10 more locale translations (es, fr, de, ja, ko, zh_CN, pt_BR, ru, it, nl)", "priority": "low", "impact": "Broader locale coverage improves listing completeness signal"}
  ]
}`+$,Ce=`Analyze why the competitor extension ranks higher for the keyword "{{keyword}}".

{{keywordPositions}}

## Positions & Trends
Your position: {{ownPosition}} | Competitor position: {{compPosition}}

### Ranking Trends (last 14 days)
Your search rank: {{ownRankHistory14d}}
Competitor search rank: {{compRankHistory14d}}
Your autocomplete position: {{ownAutocomplete14d}}
Competitor autocomplete position: {{compAutocomplete14d}}

### Recent Changes & Events (last 14 days)
Your extension: {{ownEvents14d}}
Competitor: {{compEvents14d}}

## Metrics Comparison
| Metric | Your Extension | Competitor |
|--------|----------------|------------|
| Users | {{ownUsers}} | {{compUsers}} |
| Rating | {{ownRating}} | {{compRating}} |
| Version | {{ownVersion}} | {{compVersion}} |
| Screenshots | {{ownScreenshots}} | {{compScreenshots}} |
| Translations | {{ownTranslations}} | {{compTranslations}} |
| Quality Score | {{ownQualityScore}} | {{compQualityScore}} |
| Permission Risk | {{ownPermissionRisk}} | {{compPermissionRisk}} |

## Listing Text
### Your Extension: {{ownTitle}}
- **Short Description**: {{ownShortDescription}}
- **Full Description**:
<full-description>
{{ownFullDescription}}
</full-description>

### Competitor: {{compTitle}}
- **Short Description**: {{compShortDescription}}
- **Full Description**:
<full-description>
{{compFullDescription}}
</full-description>

{{reviewSignals}}`,Ae=`You are a Chrome Web Store ASO (App Store Optimization) analyst specializing in keyword ranking diagnostics.

## Your Domain Knowledge
CWS search ranking is determined by multiple factors. You will score each factor on a 1-5 scale for both extensions.

## Scoring Rubric
Score each factor from 1 (very weak) to 5 (very strong) for BOTH extensions:

1. **Keyword Relevance (Weight: 35%)**
   - 5: Exact keyword match in title + prominent in short & full description
   - 4: Exact match in title OR strong presence in short description
   - 3: Partial match in title, keyword present in descriptions
   - 2: Keyword only in full description, not in title or short description
   - 1: No meaningful keyword presence

2. **User Base & Growth (Weight: 25%)**
   - 5: 1M+ users
   - 4: 100K-999K users
   - 3: 10K-99K users
   - 2: 1K-9K users
   - 1: Under 1K users

3. **Rating Quality (Weight: 15%)**
   - 5: 4.5+ rating with 1,000+ reviews
   - 4: 4.0+ rating with 500+ reviews, OR 4.5+ with 100+ reviews
   - 3: 4.0+ rating with 100+ reviews
   - 2: 3.5+ rating OR fewer than 100 reviews
   - 1: Below 3.5 OR no ratings

4. **Update Recency (Weight: 10%)**
   - 5: Updated within last 7 days
   - 4: Updated within last 30 days
   - 3: Updated within last 90 days
   - 2: Updated within last 180 days
   - 1: Not updated in 180+ days

5. **Listing Completeness (Weight: 10%)**
   - 5: 5+ screenshots, 15+ locales, promo video
   - 4: 4+ screenshots, 10+ locales
   - 3: 3+ screenshots, 5+ locales
   - 2: 1-2 screenshots, few locales
   - 1: No screenshots or very minimal listing

6. **Permission Scope (Weight: 5%)**
   - 5: Risk score 0-10 (minimal permissions)
   - 4: Risk score 11-25
   - 3: Risk score 26-50
   - 2: Risk score 51-75
   - 1: Risk score 76-100 (very broad permissions)

## Your Task
1. Score each factor for both extensions using the rubric above.
2. Compute weighted totals.
3. Analyze the biggest factor gaps to explain the ranking difference.
4. Provide targeted recommendations for the areas with the largest gaps.

## Output Format
Respond with valid JSON only (no markdown fences, no commentary outside JSON):
{
  "relevanceAnalysis": "2-3 paragraphs analyzing keyword alignment. Reference the keyword occurrence counts from the input data and cite specific text.",
  "metricComparison": "2-3 paragraphs comparing metrics. Include your rubric scores for each factor (e.g., 'User Base: own=3, competitor=5'). Highlight the factors with the largest score gaps.",
  "trendAnalysis": "1-2 paragraphs on ranking trajectory and correlation with events. Write 'No historical data provided.' if no trend data was given.",
  "recommendations": [
    {
      "area": "Must match a rubric factor name: Keyword Relevance | User Base & Growth | Rating Quality | Update Recency | Listing Completeness | Permission Scope",
      "suggestion": "Specific actionable change tied to improving the rubric score for this factor",
      "priority": "high|medium|low",
      "impact": "Expected rubric score change and ranking impact (e.g., 'Would raise Keyword Relevance from 2 to 4, estimated +2-3 positions')"
    }
  ]
}

Provide 3-6 recommendations sorted by priority (high first). Focus on factors with the largest score gaps — those offer the biggest ranking improvement opportunity.`+$,xe=`Analyze why the competitor extension ranks higher for the keyword "{{keyword}}".

{{keywordPositions}}

## Pre-Computed Comparison Summary
| Metric | Your Extension | Competitor | Delta |
|--------|----------------|------------|-------|
| Position | {{ownPosition}} | {{compPosition}} | {{positionGap}} |
| Users | {{ownUsers}} | {{compUsers}} | {{userRatio}} |
| Rating | {{ownRating}} | {{compRating}} | {{ratingDelta}} |
| Reviews | {{ownReviewCount}} | {{compReviewCount}} | {{reviewRatio}} |
| Quality Score | {{ownQualityScore}} | {{compQualityScore}} | {{qualityDelta}} |
| Screenshots | {{ownScreenshots}} | {{compScreenshots}} | {{screenshotDelta}} |
| Translations | {{ownTranslations}} | {{compTranslations}} | {{translationDelta}} |
| Permission Risk | {{ownPermissionRisk}} | {{compPermissionRisk}} | {{permissionDelta}} |

## Keyword Occurrence Analysis
| Location | Your Extension | Competitor |
|----------|----------------|------------|
| Title | {{ownKeywordInTitle}} matches | {{compKeywordInTitle}} matches |
| Short Description | {{ownKeywordInShortDesc}} matches | {{compKeywordInShortDesc}} matches |
| Full Description | {{ownKeywordInFullDesc}} matches | {{compKeywordInFullDesc}} matches |

## Ranking Trends (last 14 days)
Your search rank: {{ownRankHistory14d}}
Competitor search rank: {{compRankHistory14d}}
Your autocomplete position: {{ownAutocomplete14d}}
Competitor autocomplete position: {{compAutocomplete14d}}

## Recent Changes & Events (last 14 days)
Your extension: {{ownEvents14d}}
Competitor: {{compEvents14d}}

## Listing Details
### Your Extension: {{ownTitle}}
- **Version**: {{ownVersion}}
- **Short Description**: {{ownShortDescription}}
- **Full Description**:
<full-description>
{{ownFullDescription}}
</full-description>

### Competitor: {{compTitle}}
- **Version**: {{compVersion}}
- **Short Description**: {{compShortDescription}}
- **Full Description**:
<full-description>
{{compFullDescription}}
</full-description>

{{reviewSignals}}`,G={default:{temperature:.7,maxTokens:2048,estimatedOutputTokens:900},cot:{temperature:.4,maxTokens:3072,estimatedOutputTokens:1200},rubric:{temperature:.3,maxTokens:2048,estimatedOutputTokens:900}},_e={keyword:"The search keyword being analyzed",ownTitle:"Your extension title",ownPosition:'Your ranking position (e.g. "#3" or "Not in top 30")',ownShortDescription:"Your short description",ownFullDescription:"Your full description",ownRating:'Your rating (e.g. "4.5/5 (200 ratings)")',ownUsers:'Your user count (e.g. "10,000+ (10000)")',ownVersion:"Your extension version",ownScreenshots:"Your screenshot count",ownTranslations:"Your translation locale count",ownQualityScore:"Your listing quality score",ownPermissionRisk:"Your permission risk score (0-100)",compTitle:"Competitor extension title",compPosition:"Competitor ranking position",compShortDescription:"Competitor short description",compFullDescription:"Competitor full description",compRating:"Competitor rating",compUsers:"Competitor user count",compVersion:"Competitor version",compScreenshots:"Competitor screenshot count",compTranslations:"Competitor translation locale count",compQualityScore:"Competitor quality score",compPermissionRisk:"Competitor permission risk score (0-100)",ownReviewCount:'Your review/rating count (e.g. "150")',compReviewCount:'Competitor review/rating count (e.g. "2500")',keywords:"Comma-separated list of all analyzed keywords",keywordPositions:"Markdown table of all keywords with positions for both extensions",reviewSignals:"Compact own-vs-competitor review-signals block (velocity, recent trend, dev-reply rate, keyword mentions, languages). Empty when no reviews were captured.",ownRankHistory7d:"Your search rank for selected keyword, last 7 days (date | position)",ownRankHistory14d:"Your search rank for selected keyword, last 14 days (date | position)",compRankHistory7d:"Competitor search rank for selected keyword, last 7 days (date | position)",compRankHistory14d:"Competitor search rank for selected keyword, last 14 days (date | position)",ownAutocomplete7d:"Your autocomplete position for selected keyword, last 7 days (date | position)",ownAutocomplete14d:"Your autocomplete position for selected keyword, last 14 days (date | position)",compAutocomplete7d:"Competitor autocomplete position for selected keyword, last 7 days (date | position)",compAutocomplete14d:"Competitor autocomplete position for selected keyword, last 14 days (date | position)",ownEvents7d:"Your extension events/changes, last 7 days (date | event | details)",ownEvents14d:"Your extension events/changes, last 14 days (date | event | details)",compEvents7d:"Competitor events/changes, last 7 days (date | event | details)",compEvents14d:"Competitor events/changes, last 14 days (date | event | details)",positionGap:'Position gap with direction (e.g. "6 positions behind", "3 positions ahead")',userRatio:'Competitor-to-own user ratio (e.g. "20x more")',ratingDelta:'Rating difference (e.g. "+0.5")',reviewRatio:'Review count ratio (e.g. "16.7x more")',qualityDelta:'Quality score difference (e.g. "+17")',screenshotDelta:'Screenshot count difference (e.g. "+2")',translationDelta:'Translation count difference (e.g. "+15")',permissionDelta:'Permission risk difference (e.g. "-5 (lower risk)")',ownKeywordInTitle:"Number of keyword occurrences in your title",ownKeywordInShortDesc:"Number of keyword occurrences in your short description",ownKeywordInFullDesc:"Number of keyword occurrences in your full description",compKeywordInTitle:"Number of keyword occurrences in competitor title",compKeywordInShortDesc:"Number of keyword occurrences in competitor short description",compKeywordInFullDesc:"Number of keyword occurrences in competitor full description"},be="No ranking data available for this period.",De="No autocomplete data available for this period.",$e="No events detected in this period.",h="No data available.";function C(t,e,o){if(e.length===0)return be;const i=new Map;for(const s of e)i.set(s.date,s);const n=[];for(let s=o-1;s>=0;s--){const r=Q(s),a=r.slice(5),l=i.get(r);l?n.push(`${a}: ${l.position!==null?`#${l.position}`:"30+"}`):n.push(`${a}: -`)}return`"${t}" search rank (last ${o} days):
${n.join(" | ")}`}function A(t,e,o){if(e.length===0)return De;const i=new Map;for(const s of e)i.set(s.date,s);const n=[];for(let s=o-1;s>=0;s--){const r=Q(s),a=r.slice(5),l=i.get(r);l?n.push(`${a}: #${l.position}`):n.push(`${a}: -`)}return`"${t}" autocomplete position (last ${o} days):
${n.join(" | ")}`}function x(t,e){if(t.length===0)return $e;const o=t.map(i=>`${i.date} | ${i.type} | ${i.note}`);return`Events (last ${e} days):
${o.join(`
`)}`}function Ee(t,e,o,i){const n=a=>a!==null?`#${a}`:"30+";return["| Keyword | Your Position | Competitor Position |","|---------|---------------|---------------------|",...[{keyword:t,own:n(e),comp:n(o)},...i.map(a=>({keyword:a.keyword,own:n(a.ownPosition),comp:n(a.competitorPosition)}))].map(a=>`| ${a.keyword} | ${a.own} | ${a.comp} |`)].join(`
`)}function R(t,e){if(!t||!e)return 0;const o=e.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"),i=new RegExp(`\\b${o}\\b`,"gi"),n=t.match(i);return n?n.length:0}function b(t){return t>0?`+${t}`:String(t)}function Pe(t){const{keyword:e,ownListing:o,competitorListing:i,ownPosition:n,competitorPosition:s}=t,r={keyword:e},a=j(o,void 0,r).totalScore,l=j(i,void 0,r).totalScore,c={keyword:e,ownTitle:o.title,ownPosition:n!==null?`#${n}`:"Not in top 30",ownShortDescription:o.shortDescription,ownFullDescription:o.fullDescription,ownRating:o.rating!==null?`${o.rating}/5 (${o.ratingCount} ratings)`:"No ratings",ownUsers:`${o.userCount} (${o.userCountNumeric})`,ownVersion:o.version,ownScreenshots:String(o.screenshotCount),ownTranslations:`${o.translationCount} locales`,ownQualityScore:`${a}/100`,ownPermissionRisk:`${o.permissionRiskScore}/100`,compTitle:i.title,compPosition:s!==null?`#${s}`:"Not in top 30",compShortDescription:i.shortDescription,compFullDescription:i.fullDescription,compRating:i.rating!==null?`${i.rating}/5 (${i.ratingCount} ratings)`:"No ratings",compUsers:`${i.userCount} (${i.userCountNumeric})`,compVersion:i.version,compScreenshots:String(i.screenshotCount),compTranslations:`${i.translationCount} locales`,compQualityScore:`${l}/100`,compPermissionRisk:`${i.permissionRiskScore}/100`,ownReviewCount:String(o.ratingCount),compReviewCount:String(i.ratingCount)},d=t.additionalKeywords??[];if(d.length>0){const p=[e,...d.map(P=>P.keyword)];c.keywords=p.join(", "),c.keywordPositions=`## Keyword Positions Across All Analyzed Keywords

`+Ee(e,n,s,d)}else c.keywords=e,c.keywordPositions="";if(t.history7d){const p=t.history7d;c.ownRankHistory7d=C(e,p.ownRankHistory,7),c.compRankHistory7d=C(e,p.compRankHistory,7),c.ownAutocomplete7d=A(e,p.ownAutocompleteHistory,7),c.compAutocomplete7d=A(e,p.compAutocompleteHistory,7),c.ownEvents7d=x(p.ownEvents,7),c.compEvents7d=x(p.compEvents,7)}else c.ownRankHistory7d=h,c.compRankHistory7d=h,c.ownAutocomplete7d=h,c.compAutocomplete7d=h,c.ownEvents7d=h,c.compEvents7d=h;if(t.history14d){const p=t.history14d;c.ownRankHistory14d=C(e,p.ownRankHistory,14),c.compRankHistory14d=C(e,p.compRankHistory,14),c.ownAutocomplete14d=A(e,p.ownAutocompleteHistory,14),c.compAutocomplete14d=A(e,p.compAutocompleteHistory,14),c.ownEvents14d=x(p.ownEvents,14),c.compEvents14d=x(p.compEvents,14)}else c.ownRankHistory14d=h,c.compRankHistory14d=h,c.ownAutocomplete14d=h,c.compAutocomplete14d=h,c.ownEvents14d=h,c.compEvents14d=h;const m=n,g=s;if(m!==null&&g!==null){const p=m-g;p>0?c.positionGap=`${p} positions behind`:p<0?c.positionGap=`${-p} positions ahead`:c.positionGap="Same position"}else m===null&&g!==null?c.positionGap="30+ behind":m!==null&&g===null?c.positionGap="Ahead (competitor not in top 30)":c.positionGap="N/A (both unranked)";const f=o.userCountNumeric,y=i.userCountNumeric;if(f>0&&y>0){const p=y/f;c.userRatio=p>=2?`${p.toFixed(1)}x more`:p<=.5?`${(1/p).toFixed(1)}x fewer`:`${p.toFixed(1)}x`}else c.userRatio="N/A";o.rating!==null&&i.rating!==null?c.ratingDelta=b(+(i.rating-o.rating).toFixed(1)):c.ratingDelta="N/A";const w=o.ratingCount,T=i.ratingCount;if(w>0&&T>0){const p=T/w;c.reviewRatio=p>=2?`${p.toFixed(1)}x more`:p<=.5?`${(1/p).toFixed(1)}x fewer`:`${p.toFixed(1)}x`}else c.reviewRatio="N/A";c.qualityDelta=b(l-a),c.screenshotDelta=b(i.screenshotCount-o.screenshotCount),c.translationDelta=b(i.translationCount-o.translationCount);const v=i.permissionRiskScore-o.permissionRiskScore;c.permissionDelta=v<0?`${v} (lower risk)`:v>0?`+${v} (higher risk)`:"0 (same)",c.ownKeywordInTitle=String(R(o.title,e)),c.ownKeywordInShortDesc=String(R(o.shortDescription,e)),c.ownKeywordInFullDesc=String(R(o.fullDescription,e)),c.compKeywordInTitle=String(R(i.title,e)),c.compKeywordInShortDesc=String(R(i.shortDescription,e)),c.compKeywordInFullDesc=String(R(i.fullDescription,e));const S=[e,...d.map(p=>p.keyword)].filter(p=>p.length>0),E=t.ownReviews&&t.ownReviews.length>0?H(t.ownReviews,o,S,{textReviewCount:t.ownTextReviewCount??null}):null,u=t.compReviews&&t.compReviews.length>0?H(t.compReviews,i,S,{textReviewCount:t.compTextReviewCount??null}):null;return c.reviewSignals=le(E,u),c}function Me(t,e){return t.replace(/\{\{(\w+)\}\}/g,(o,i)=>i in e?e[i]:o)}function Oe(t){switch(t){case"cot":return Te;case"rubric":return Ae;default:return Re}}function Ie(t){switch(t){case"cot":return Ce;case"rubric":return xe;default:return Se}}function q(t,e){var c,d;const o=(e==null?void 0:e.variant)??"default",i=Pe(t);let s=((c=e==null?void 0:e.systemPrompt)==null?void 0:c.trim())||Oe(o);const a=((d=e==null?void 0:e.userPromptTemplate)==null?void 0:d.trim())||Ie(o),l=Me(a,i);return i.reviewSignals&&!s.includes('Interpreting the "Review Signals" block')&&(s+=$),[{role:"system",content:s},{role:"user",content:l}]}function Le(t,e){const o=(e==null?void 0:e.variant)??"default",n=q(t,e).map(l=>l.content).join(""),s=N.estimateTokens(n),r=G[o].estimatedOutputTokens,a=N.estimateCost(s,r);return{inputTokens:s,outputTokens:r,estimatedCostUsd:a}}function Ne(t){try{let e=t.trim();e.startsWith("```")&&(e=e.replace(/^```(?:json)?\n?/,"").replace(/\n?```$/,""));const o=JSON.parse(e),i=typeof o.relevanceAnalysis=="string"?o.relevanceAnalysis:"",n=typeof o.metricComparison=="string"?o.metricComparison:"",s=typeof o.trendAnalysis=="string"?o.trendAnalysis:"",r=[];if(Array.isArray(o.recommendations)){for(const a of o.recommendations)if(a&&typeof a.area=="string"&&typeof a.suggestion=="string"){const l=["high","medium","low"].includes(a.priority)?a.priority:"medium",c=typeof a.impact=="string"?a.impact:void 0;r.push({area:a.area,suggestion:a.suggestion,priority:l,impact:c})}}return{relevanceAnalysis:i,metricComparison:n,trendAnalysis:s,recommendations:r}}catch{return{relevanceAnalysis:t,metricComparison:"",trendAnalysis:"",recommendations:[]}}}function Fe(t){let e=5381;for(let o=0;o<t.length;o++)e=(e<<5)+e+t.charCodeAt(o)|0;return(e>>>0).toString(36)}function He(t,e,o,i,n="default",s="",r=""){const a=Array.isArray(t)?t:[t],[l,...c]=a,d=JSON.stringify([l??"",[...c].sort()]),m=n!=="default"?`:${n}`:"",g=s?`:r=${s}`:"",f=r?`:p=${r}`:"";return`audit:${d}:${e}:${o}:${i}${m}${g}${f}`}async function We(t,e,o){const i=(o==null?void 0:o.variant)??"default",n=G[i],s=q(e,o),r=await t.chat(s,{model:"gpt-4o",temperature:n.temperature,maxTokens:n.maxTokens}),a=Ne(r.content),l=N.estimateCost(r.inputTokens,r.outputTokens),c={keyword:e.keyword,ownExtensionId:e.ownListing.extensionId,competitorExtensionId:e.competitorListing.extensionId,relevanceAnalysis:a.relevanceAnalysis,metricComparison:a.metricComparison,trendAnalysis:a.trendAnalysis,recommendations:a.recommendations,rawResponse:r.content,inputTokens:r.inputTokens,outputTokens:r.outputTokens,costUsd:l,createdAt:new Date().toISOString()};return e.additionalKeywords&&e.additionalKeywords.length>0&&(c.additionalKeywords=e.additionalKeywords.map(d=>d.keyword)),c}export{_e as A,N as O,Ie as a,He as b,We as c,k as d,Le as e,q as f,Oe as g,Ye as r,Fe as s};
