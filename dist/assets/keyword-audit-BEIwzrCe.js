var _=Object.defineProperty;var F=(i,e,t)=>e in i?_(i,e,{enumerable:!0,configurable:!0,writable:!0,value:t}):i[e]=t;var b=(i,e,t)=>F(i,typeof e!="symbol"?e+"":e,t);import{t as E,e as O,b as I}from"./rank-history-CqgtmlSP.js";class h extends Error{constructor(e,t){super(e),this.code=t,this.name="OpenAIError"}}const L=2.5/1e6,H=10/1e6;class D{constructor(e){b(this,"apiKey");b(this,"baseUrl","https://api.openai.com/v1");this.apiKey=e}async chat(e,t={}){var m,g,y,w,k;const n=t.model??"gpt-4o",o=t.temperature??.7,s=t.maxTokens??2048;let a;try{a=await fetch(`${this.baseUrl}/chat/completions`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${this.apiKey}`},body:JSON.stringify({model:n,messages:e,temperature:o,max_tokens:s})})}catch{throw new h("Failed to connect to OpenAI API. Check your internet connection.","connection_failed")}a.ok||await this.handleErrorResponse(a);const r=await a.json(),l=((y=(g=(m=r.choices)==null?void 0:m[0])==null?void 0:g.message)==null?void 0:y.content)??"",c=((w=r.usage)==null?void 0:w.prompt_tokens)??0,d=((k=r.usage)==null?void 0:k.completion_tokens)??0;return{content:l,inputTokens:c,outputTokens:d}}static estimateTokens(e){return e?Math.ceil(e.length/4):0}static estimateCost(e,t){return e*L+t*H}async handleErrorResponse(e){var o,s;let t={};try{t=await e.json()}catch{}const n=((o=t.error)==null?void 0:o.message)??"";switch(e.status){case 401:throw new h("Invalid API key. Please check your OpenAI API key in Settings.","invalid_api_key");case 429:throw new h("Rate limited by OpenAI. Please wait a moment and try again.","rate_limited");case 402:throw new h("Insufficient OpenAI credits. Please add credits to your OpenAI account.","no_credits");default:throw((s=t.error)==null?void 0:s.code)==="insufficient_quota"?new h("Insufficient OpenAI credits. Please add credits to your OpenAI account.","no_credits"):new h(n||`OpenAI API error (HTTP ${e.status})`,"api_error")}}}const W={title:{minLength:10,optimalMin:20,optimalMax:60,maxLength:70},shortDescription:{minLength:40,optimalMin:80,maxLength:132},fullDescription:{minWords:50,optimalMinWords:150,optimalMaxWords:1e3,maxWords:1500},screenshots:{optimalMin:3,optimalMax:5},translations:{good:10,excellent:20},rating:{excellent:4.5,good:4,fair:3.5},reviews:{excellent:100,good:50,fair:10},freshness:{fresh:90,recent:180,aging:270,stale:365},permissionRisk:{low:20,medium:50,high:80}},P=new Set(["en","es","pt_BR","fr","de","ja","zh_CN","zh_TW","ko","ru","ar","hi","it","nl","pl","tr"]),x={title:.15,shortDescription:.1,fullDescription:.15,visualAssets:.15,ratingsReviews:.1,translations:.1,updateFreshness:.1,permissions:.1,developerProfile:.05};function C(i,e){if(!i||!e)return!1;const t=e.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");return new RegExp(`\\b${t}\\b`,"i").test(i)}function U(i,e){if(!i||!e)return 0;const t=i.trim().split(/\s+/).filter(c=>c.length>0);if(t.length===0)return 0;const n=e.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"),o=new RegExp(`\\b${n}\\b`,"gi"),s=i.match(o),a=s?s.length:0;if(a===0)return 0;const r=e.trim().split(/\s+/).length,l=a*r/t.length*100;return l>=.5&&l<=2.5?100:l<.5?Math.round(l/.5*100):l<=5?Math.round(100-60*((l-2.5)/2.5)):20}function z(i,e,t){const n=i.length,o=e.title;let s;if(n===0?s=0:n<o.minLength?s=20:n>=o.optimalMin&&n<=o.optimalMax?s=100:n>o.maxLength?s=30:n<o.optimalMin?s=20+80*((n-o.minLength)/(o.optimalMin-o.minLength)):s=100-70*((n-o.optimalMax)/(o.maxLength-o.optimalMax)),!t)return Math.round(s);const a=C(i,t)?100:0;return Math.round(s*.7+a*.3)}function V(i,e,t){const n=i.length,o=e.shortDescription;let s;if(n===0?s=0:n<o.minLength?s=20+30*(n/o.minLength):n>=o.optimalMin?s=100:s=50+50*((n-o.minLength)/(o.optimalMin-o.minLength)),!t)return Math.round(s);const a=C(i,t)?100:0;return Math.round(s*.7+a*.3)}function j(i,e,t){if(i.length===0)return 0;const o=i.trim().split(/\s+/).filter(g=>g.length>0).length,s=e.fullDescription;let a;o<s.minWords?a=20*(o/s.minWords):o>=s.optimalMinWords?a=100:a=20+80*((o-s.minWords)/(s.optimalMinWords-s.minWords));const r=i.split(/\n\s*\n/).filter(g=>g.trim().length>0).length,l=/\n/.test(i),c=/^[\s]*[-*\u2022]/m.test(i);let d=0;if(r>=3?d+=50:r>=2?d+=30:l&&(d+=15),c&&(d+=30),o>=s.optimalMinWords&&(d+=20),d=Math.min(d,100),!t)return Math.round(a*.7+d*.3);const m=U(i,t);return Math.round(a*.5+d*.25+m*.25)}function Q(i,e,t){const n=t.screenshots;let o;i===0?o=0:i>=n.optimalMin&&i<=n.optimalMax?o=100:i<n.optimalMin?o=30+70*(i/n.optimalMin):o=100;const s=e?100:0;return Math.round(o*.8+s*.2)}function B(i,e,t){const n=t.rating,o=t.reviews;let s;i===null?s=0:i>=n.excellent?s=100:i>=n.good?s=70+30*((i-n.good)/(n.excellent-n.good)):i>=n.fair?s=40+30*((i-n.fair)/(n.good-n.fair)):s=40*(i/n.fair);let a;return e>=o.excellent?a=100:e>=o.good?a=70+30*((e-o.good)/(o.excellent-o.good)):e>=o.fair?a=40+30*((e-o.fair)/(o.good-o.fair)):e>0?a=40*(e/o.fair):a=0,Math.round(s*.6+a*.4)}function G(i,e,t){const n=t.translations;if(i<=1)return 0;let o;i>=n.excellent?o=100:i>=n.good?o=70+30*((i-n.good)/(n.excellent-n.good)):o=70*((i-1)/(n.good-1));const a=e.filter(l=>P.has(l)).length/P.size,r=Math.round(a*100);return Math.round(o*.6+r*.4)}function q(i,e){const t=e.freshness,n=E();let o;try{o=O(i,n)}catch{return 0}return isNaN(o)?0:o<=t.fresh?100:o<=t.recent?80+20*((t.recent-o)/(t.recent-t.fresh)):o<=t.aging?50+30*((t.aging-o)/(t.aging-t.recent)):o<=t.stale?20+30*((t.stale-o)/(t.stale-t.aging)):0}function J(i,e){const t=e.permissionRisk;return i<=t.low?100:i<=t.medium?70+30*((t.medium-i)/(t.medium-t.low)):i<=t.high?40+30*((t.high-i)/(t.high-t.medium)):0}function X(i,e){return!i||i.trim().length===0?0:e?100:40}function Z(i,e,t,n){const o=[];for(const s of i){if(s.score>80)continue;const a=s.score<30?"high":s.score<50?"medium":"low";switch(s.name){case"title":{const r=e.title.length,l=t.title;r===0?o.push({component:"title",message:"Add a title to your extension listing.",priority:a}):r<l.optimalMin?o.push({component:"title",message:`Your title is ${r} characters. Consider expanding to ${l.optimalMin}-${l.optimalMax} characters for better keyword coverage.`,priority:a}):r>l.maxLength&&o.push({component:"title",message:`Your title is ${r} characters, which may appear keyword-stuffed. Consider trimming to under ${l.maxLength} characters.`,priority:a});break}case"shortDescription":{const r=e.shortDescription.length,l=t.shortDescription;r===0?o.push({component:"shortDescription",message:"Add a short description to your listing.",priority:a}):r<l.optimalMin&&o.push({component:"shortDescription",message:`Your short description is ${r}/${l.maxLength} characters. Use more of the available space (aim for ${l.optimalMin}+ characters) to include keywords and a call-to-action.`,priority:a});break}case"fullDescription":{const l=e.fullDescription.trim().split(/\s+/).filter(m=>m.length>0).length,c=t.fullDescription;l===0?o.push({component:"fullDescription",message:"Add a detailed description to your listing.",priority:a}):l<c.optimalMinWords&&o.push({component:"fullDescription",message:`Your description is ${l} words. Consider expanding to ${c.optimalMinWords}+ words with feature details, use cases, and keywords.`,priority:a}),e.fullDescription.split(/\n\s*\n/).filter(m=>m.trim().length>0).length<3&&l>=c.minWords&&o.push({component:"fullDescription",message:"Structure your description with multiple paragraphs, bullet points, and clear sections for better readability.",priority:"low"});break}case"visualAssets":{const r=t.screenshots;if(e.screenshotCount===0)o.push({component:"visualAssets",message:`Add screenshots to your listing. Aim for ${r.optimalMin}-${r.optimalMax} screenshots showing key features.`,priority:a});else if(e.screenshotCount<r.optimalMin){const l=r.optimalMin-e.screenshotCount;o.push({component:"visualAssets",message:`Add ${l} more screenshot${l>1?"s":""} to reach the optimal count of ${r.optimalMin}-${r.optimalMax}.`,priority:a})}e.hasPromoVideo||o.push({component:"visualAssets",message:"Consider adding a promotional video to showcase your extension in action.",priority:"low"});break}case"ratingsReviews":{e.rating===null?o.push({component:"ratingsReviews",message:"Your extension has no ratings yet. Encourage users to leave reviews.",priority:a}):e.rating<t.rating.good&&o.push({component:"ratingsReviews",message:`Your rating is ${e.rating.toFixed(1)} stars. Focus on fixing user complaints to improve your rating above ${t.rating.good}.`,priority:a}),e.reviewCount<t.reviews.fair&&o.push({component:"ratingsReviews",message:`You have ${e.reviewCount} reviews. Aim for at least ${t.reviews.fair} reviews to build credibility.`,priority:a});break}case"translations":{if(e.translationCount<=1)o.push({component:"translations",message:`Your extension is only available in 1 locale. Translate to ${t.translations.good}+ locales to reach more users.`,priority:a});else if(e.translationCount<t.translations.good){const r=t.translations.good-e.translationCount;o.push({component:"translations",message:`Add ${r} more locale${r>1?"s":""} to reach ${t.translations.good} supported locales. Focus on major markets.`,priority:a})}break}case"updateFreshness":{const r=E();let l;try{l=O(e.lastUpdated,r)}catch{l=1/0}l>t.freshness.recent&&o.push({component:"updateFreshness",message:`Your extension was last updated ${l} days ago. Regular updates signal active maintenance to users and CWS.`,priority:a});break}case"permissions":{e.permissionRiskScore>t.permissionRisk.medium&&o.push({component:"permissions",message:"Your extension requests high-risk permissions. Consider if all permissions are necessary, as users see install warnings for risky permissions.",priority:a});break}case"developerProfile":{e.developerVerified||o.push({component:"developerProfile",message:"Verify your developer account on Chrome Web Store to build trust with users.",priority:a});break}}}return n&&(C(e.title,n)||o.push({component:"title",message:`Your title does not contain the keyword "${n}". Including the target keyword in the title is the strongest relevance signal.`,priority:"high"}),C(e.shortDescription,n)||o.push({component:"shortDescription",message:`Your short description does not contain the keyword "${n}". Add it to improve keyword relevance.`,priority:"medium"}),U(e.fullDescription,n)<50&&o.push({component:"fullDescription",message:`Low keyword density for "${n}" in your full description. Consider adding the keyword naturally 2-4 more times.`,priority:"medium"})),o}function M(i,e=W,t){const n=t==null?void 0:t.keyword,o={title:z(i.title,e,n),shortDescription:V(i.shortDescription,e,n),fullDescription:j(i.fullDescription,e,n),visualAssets:Q(i.screenshotCount,i.hasPromoVideo,e),ratingsReviews:B(i.rating,i.reviewCount,e),translations:G(i.translationCount,i.availableLocales,e),updateFreshness:q(i.lastUpdated,e),permissions:J(i.permissionRiskScore,e),developerProfile:X(i.developerName,i.developerVerified)},s=Object.keys(x).map(l=>({name:l,score:Math.round(o[l]),weight:x[l],weightedScore:Math.round(o[l]*x[l]*100)/100})),a=Math.round(s.reduce((l,c)=>l+c.score*c.weight,0)),r=Z(s,i,e,n);return{totalScore:Math.min(Math.max(a,0),100),components:s,recommendations:r}}const ee=`You are a Chrome Web Store ASO (App Store Optimization) analyst specializing in keyword ranking diagnostics.

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

Provide 3-6 recommendations sorted by priority (high first). Every suggestion must reference actual data from the input — never give advice that could apply to any extension generically.`,te=`Analyze why the competitor extension ranks higher for the keyword "{{keyword}}".

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
Competitor: {{compEvents14d}}`,oe=`You are a Chrome Web Store ASO (App Store Optimization) analyst specializing in keyword ranking diagnostics.

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
}`,ie=`Analyze why the competitor extension ranks higher for the keyword "{{keyword}}".

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
</full-description>`,ne=`You are a Chrome Web Store ASO (App Store Optimization) analyst specializing in keyword ranking diagnostics.

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

Provide 3-6 recommendations sorted by priority (high first). Focus on factors with the largest score gaps — those offer the biggest ranking improvement opportunity.`,se=`Analyze why the competitor extension ranks higher for the keyword "{{keyword}}".

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
</full-description>`,N={default:{temperature:.7,maxTokens:2048,estimatedOutputTokens:900},cot:{temperature:.4,maxTokens:3072,estimatedOutputTokens:1200},rubric:{temperature:.3,maxTokens:2048,estimatedOutputTokens:900}},ye={keyword:"The search keyword being analyzed",ownTitle:"Your extension title",ownPosition:'Your ranking position (e.g. "#3" or "Not in top 30")',ownShortDescription:"Your short description",ownFullDescription:"Your full description",ownRating:'Your rating (e.g. "4.5/5 (200 ratings)")',ownUsers:'Your user count (e.g. "10,000+ (10000)")',ownVersion:"Your extension version",ownScreenshots:"Your screenshot count",ownTranslations:"Your translation locale count",ownQualityScore:"Your listing quality score",ownPermissionRisk:"Your permission risk score (0-100)",compTitle:"Competitor extension title",compPosition:"Competitor ranking position",compShortDescription:"Competitor short description",compFullDescription:"Competitor full description",compRating:"Competitor rating",compUsers:"Competitor user count",compVersion:"Competitor version",compScreenshots:"Competitor screenshot count",compTranslations:"Competitor translation locale count",compQualityScore:"Competitor quality score",compPermissionRisk:"Competitor permission risk score (0-100)",ownReviewCount:'Your review/rating count (e.g. "150")',compReviewCount:'Competitor review/rating count (e.g. "2500")',keywords:"Comma-separated list of all analyzed keywords",keywordPositions:"Markdown table of all keywords with positions for both extensions",ownRankHistory7d:"Your search rank for selected keyword, last 7 days (date | position)",ownRankHistory14d:"Your search rank for selected keyword, last 14 days (date | position)",compRankHistory7d:"Competitor search rank for selected keyword, last 7 days (date | position)",compRankHistory14d:"Competitor search rank for selected keyword, last 14 days (date | position)",ownAutocomplete7d:"Your autocomplete position for selected keyword, last 7 days (date | position)",ownAutocomplete14d:"Your autocomplete position for selected keyword, last 14 days (date | position)",compAutocomplete7d:"Competitor autocomplete position for selected keyword, last 7 days (date | position)",compAutocomplete14d:"Competitor autocomplete position for selected keyword, last 14 days (date | position)",ownEvents7d:"Your extension events/changes, last 7 days (date | event | details)",ownEvents14d:"Your extension events/changes, last 14 days (date | event | details)",compEvents7d:"Competitor events/changes, last 7 days (date | event | details)",compEvents14d:"Competitor events/changes, last 14 days (date | event | details)",positionGap:'Position gap with direction (e.g. "6 positions behind", "3 positions ahead")',userRatio:'Competitor-to-own user ratio (e.g. "20x more")',ratingDelta:'Rating difference (e.g. "+0.5")',reviewRatio:'Review count ratio (e.g. "16.7x more")',qualityDelta:'Quality score difference (e.g. "+17")',screenshotDelta:'Screenshot count difference (e.g. "+2")',translationDelta:'Translation count difference (e.g. "+15")',permissionDelta:'Permission risk difference (e.g. "-5 (lower risk)")',ownKeywordInTitle:"Number of keyword occurrences in your title",ownKeywordInShortDesc:"Number of keyword occurrences in your short description",ownKeywordInFullDesc:"Number of keyword occurrences in your full description",compKeywordInTitle:"Number of keyword occurrences in competitor title",compKeywordInShortDesc:"Number of keyword occurrences in competitor short description",compKeywordInFullDesc:"Number of keyword occurrences in competitor full description"},re="No ranking data available for this period.",ae="No autocomplete data available for this period.",ce="No events detected in this period.",u="No data available.";function S(i,e,t){if(e.length===0)return re;const n=new Map;for(const s of e)n.set(s.date,s);const o=[];for(let s=t-1;s>=0;s--){const a=I(s),r=a.slice(5),l=n.get(a);l?o.push(`${r}: ${l.position!==null?`#${l.position}`:"30+"}`):o.push(`${r}: -`)}return`"${i}" search rank (last ${t} days):
${o.join(" | ")}`}function R(i,e,t){if(e.length===0)return ae;const n=new Map;for(const s of e)n.set(s.date,s);const o=[];for(let s=t-1;s>=0;s--){const a=I(s),r=a.slice(5),l=n.get(a);l?o.push(`${r}: #${l.position}`):o.push(`${r}: -`)}return`"${i}" autocomplete position (last ${t} days):
${o.join(" | ")}`}function T(i,e){if(i.length===0)return ce;const t=i.map(n=>`${n.date} | ${n.type} | ${n.note}`);return`Events (last ${e} days):
${t.join(`
`)}`}function le(i,e,t,n){const o=r=>r!==null?`#${r}`:"30+";return["| Keyword | Your Position | Competitor Position |","|---------|---------------|---------------------|",...[{keyword:i,own:o(e),comp:o(t)},...n.map(r=>({keyword:r.keyword,own:o(r.ownPosition),comp:o(r.competitorPosition)}))].map(r=>`| ${r.keyword} | ${r.own} | ${r.comp} |`)].join(`
`)}function f(i,e){if(!i||!e)return 0;const t=e.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"),n=new RegExp(`\\b${t}\\b`,"gi"),o=i.match(n);return o?o.length:0}function A(i){return i>0?`+${i}`:String(i)}function pe(i){const{keyword:e,ownListing:t,competitorListing:n,ownPosition:o,competitorPosition:s}=i,a={keyword:e},r=M(t,void 0,a).totalScore,l=M(n,void 0,a).totalScore,c={keyword:e,ownTitle:t.title,ownPosition:o!==null?`#${o}`:"Not in top 30",ownShortDescription:t.shortDescription,ownFullDescription:t.fullDescription,ownRating:t.rating!==null?`${t.rating}/5 (${t.ratingCount} ratings)`:"No ratings",ownUsers:`${t.userCount} (${t.userCountNumeric})`,ownVersion:t.version,ownScreenshots:String(t.screenshotCount),ownTranslations:`${t.translationCount} locales`,ownQualityScore:`${r}/100`,ownPermissionRisk:`${t.permissionRiskScore}/100`,compTitle:n.title,compPosition:s!==null?`#${s}`:"Not in top 30",compShortDescription:n.shortDescription,compFullDescription:n.fullDescription,compRating:n.rating!==null?`${n.rating}/5 (${n.ratingCount} ratings)`:"No ratings",compUsers:`${n.userCount} (${n.userCountNumeric})`,compVersion:n.version,compScreenshots:String(n.screenshotCount),compTranslations:`${n.translationCount} locales`,compQualityScore:`${l}/100`,compPermissionRisk:`${n.permissionRiskScore}/100`,ownReviewCount:String(t.ratingCount),compReviewCount:String(n.ratingCount)},d=i.additionalKeywords??[];if(d.length>0){const p=[e,...d.map(K=>K.keyword)];c.keywords=p.join(", "),c.keywordPositions=`## Keyword Positions Across All Analyzed Keywords

`+le(e,o,s,d)}else c.keywords=e,c.keywordPositions="";if(i.history7d){const p=i.history7d;c.ownRankHistory7d=S(e,p.ownRankHistory,7),c.compRankHistory7d=S(e,p.compRankHistory,7),c.ownAutocomplete7d=R(e,p.ownAutocompleteHistory,7),c.compAutocomplete7d=R(e,p.compAutocompleteHistory,7),c.ownEvents7d=T(p.ownEvents,7),c.compEvents7d=T(p.compEvents,7)}else c.ownRankHistory7d=u,c.compRankHistory7d=u,c.ownAutocomplete7d=u,c.compAutocomplete7d=u,c.ownEvents7d=u,c.compEvents7d=u;if(i.history14d){const p=i.history14d;c.ownRankHistory14d=S(e,p.ownRankHistory,14),c.compRankHistory14d=S(e,p.compRankHistory,14),c.ownAutocomplete14d=R(e,p.ownAutocompleteHistory,14),c.compAutocomplete14d=R(e,p.compAutocompleteHistory,14),c.ownEvents14d=T(p.ownEvents,14),c.compEvents14d=T(p.compEvents,14)}else c.ownRankHistory14d=u,c.compRankHistory14d=u,c.ownAutocomplete14d=u,c.compAutocomplete14d=u,c.ownEvents14d=u,c.compEvents14d=u;const m=o,g=s;if(m!==null&&g!==null){const p=m-g;p>0?c.positionGap=`${p} positions behind`:p<0?c.positionGap=`${-p} positions ahead`:c.positionGap="Same position"}else m===null&&g!==null?c.positionGap="30+ behind":m!==null&&g===null?c.positionGap="Ahead (competitor not in top 30)":c.positionGap="N/A (both unranked)";const y=t.userCountNumeric,w=n.userCountNumeric;if(y>0&&w>0){const p=w/y;c.userRatio=p>=2?`${p.toFixed(1)}x more`:p<=.5?`${(1/p).toFixed(1)}x fewer`:`${p.toFixed(1)}x`}else c.userRatio="N/A";t.rating!==null&&n.rating!==null?c.ratingDelta=A(+(n.rating-t.rating).toFixed(1)):c.ratingDelta="N/A";const k=t.ratingCount,$=n.ratingCount;if(k>0&&$>0){const p=$/k;c.reviewRatio=p>=2?`${p.toFixed(1)}x more`:p<=.5?`${(1/p).toFixed(1)}x fewer`:`${p.toFixed(1)}x`}else c.reviewRatio="N/A";c.qualityDelta=A(l-r),c.screenshotDelta=A(n.screenshotCount-t.screenshotCount),c.translationDelta=A(n.translationCount-t.translationCount);const v=n.permissionRiskScore-t.permissionRiskScore;return c.permissionDelta=v<0?`${v} (lower risk)`:v>0?`+${v} (higher risk)`:"0 (same)",c.ownKeywordInTitle=String(f(t.title,e)),c.ownKeywordInShortDesc=String(f(t.shortDescription,e)),c.ownKeywordInFullDesc=String(f(t.fullDescription,e)),c.compKeywordInTitle=String(f(n.title,e)),c.compKeywordInShortDesc=String(f(n.shortDescription,e)),c.compKeywordInFullDesc=String(f(n.fullDescription,e)),c}function de(i,e){return i.replace(/\{\{(\w+)\}\}/g,(t,n)=>n in e?e[n]:t)}function me(i){switch(i){case"cot":return oe;case"rubric":return ne;default:return ee}}function ue(i){switch(i){case"cot":return ie;case"rubric":return se;default:return te}}function Y(i,e){var c,d;const t=(e==null?void 0:e.variant)??"default",n=pe(i),s=((c=e==null?void 0:e.systemPrompt)==null?void 0:c.trim())||me(t),r=((d=e==null?void 0:e.userPromptTemplate)==null?void 0:d.trim())||ue(t),l=de(r,n);return[{role:"system",content:s},{role:"user",content:l}]}function we(i,e){const t=(e==null?void 0:e.variant)??"default",o=Y(i,e).map(l=>l.content).join(""),s=D.estimateTokens(o),a=N[t].estimatedOutputTokens,r=D.estimateCost(s,a);return{inputTokens:s,outputTokens:a,estimatedCostUsd:r}}function ge(i){try{let e=i.trim();e.startsWith("```")&&(e=e.replace(/^```(?:json)?\n?/,"").replace(/\n?```$/,""));const t=JSON.parse(e),n=typeof t.relevanceAnalysis=="string"?t.relevanceAnalysis:"",o=typeof t.metricComparison=="string"?t.metricComparison:"",s=typeof t.trendAnalysis=="string"?t.trendAnalysis:"",a=[];if(Array.isArray(t.recommendations)){for(const r of t.recommendations)if(r&&typeof r.area=="string"&&typeof r.suggestion=="string"){const l=["high","medium","low"].includes(r.priority)?r.priority:"medium",c=typeof r.impact=="string"?r.impact:void 0;a.push({area:r.area,suggestion:r.suggestion,priority:l,impact:c})}}return{relevanceAnalysis:n,metricComparison:o,trendAnalysis:s,recommendations:a}}catch{return{relevanceAnalysis:i,metricComparison:"",trendAnalysis:"",recommendations:[]}}}function ke(i,e,t,n,o="default"){const s=Array.isArray(i)?[...i].sort().join(","):i,a=o!=="default"?`:${o}`:"";return`audit:${s}:${e}:${t}:${n}${a}`}async function ve(i,e,t){const n=(t==null?void 0:t.variant)??"default",o=N[n],s=Y(e,t),a=await i.chat(s,{model:"gpt-4o",temperature:o.temperature,maxTokens:o.maxTokens}),r=ge(a.content),l=D.estimateCost(a.inputTokens,a.outputTokens),c={keyword:e.keyword,ownExtensionId:e.ownListing.extensionId,competitorExtensionId:e.competitorListing.extensionId,relevanceAnalysis:r.relevanceAnalysis,metricComparison:r.metricComparison,trendAnalysis:r.trendAnalysis,recommendations:r.recommendations,rawResponse:a.content,inputTokens:a.inputTokens,outputTokens:a.outputTokens,costUsd:l,createdAt:new Date().toISOString()};return e.additionalKeywords&&e.additionalKeywords.length>0&&(c.additionalKeywords=e.additionalKeywords.map(d=>d.keyword)),c}export{ye as A,D as O,ue as a,ke as b,h as c,Y as d,we as e,me as g,ve as r};
