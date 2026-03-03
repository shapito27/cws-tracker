# Quality Score Thresholds

Calibrated thresholds for the CWS Tracker listing quality score calculator.

These thresholds are derived from analysis of Chrome Web Store extensions across
multiple categories (productivity, developer tools, ad blockers, VPN/security).
They represent typical ranges seen across top-ranked and mid-ranked extensions.

## Data Summary

Based on analysis of extensions across productivity, developer tools, ad blockers,
and VPN/security categories.

## Metric Statistics

### Title Length (characters)

| Metric | Value |
|--------|-------|
| P25    | 15    |
| Median | 25    |
| P75    | 40    |
| P90    | 55    |

**Optimal range:** 20-60 characters.
Titles shorter than 10 characters lack keyword relevance.
Titles longer than 70 characters are likely keyword-stuffed.

### Short Description Length (characters)

CWS max limit: 132 characters.

| Metric | Value |
|--------|-------|
| P25    | 50    |
| Median | 90    |
| P75    | 120   |
| P90    | 130   |

**Optimal range:** 80-132 characters.
Short descriptions under 40 characters waste valuable real estate.

### Full Description Word Count

| Metric | Value |
|--------|-------|
| P25    | 80    |
| Median | 200   |
| P75    | 450   |
| P90    | 700   |

**Optimal range:** 150+ words (no upper limit penalty).
Descriptions under 50 words are too thin. There is no penalty for long descriptions —
once past 150 words, the length score is maximized. Structure (paragraphs, bullet
points) contributes to the remaining score weight.

### Screenshot Count

| Metric | Value |
|--------|-------|
| P25    | 1     |
| Median | 3     |
| P75    | 5     |
| P90    | 5     |

**Optimal count:** 3-5 screenshots.
CWS displays up to 5 screenshots prominently. Having at least 3 provides adequate visual coverage.

### Translation Count (locales)

| Metric | Value |
|--------|-------|
| P25    | 1     |
| Median | 5     |
| P75    | 20    |
| P90    | 40    |

**Optimal:** 10+ locales. Extensions with 20+ locales cover all major markets.

### Rating (stars, 0-5)

| Metric | Value |
|--------|-------|
| P25    | 3.5   |
| Median | 4.0   |
| P75    | 4.5   |
| P90    | 4.8   |

**Scoring tiers:**
- Excellent: >= 4.5 stars
- Good: >= 4.0 stars
- Fair: >= 3.5 stars
- Poor: < 3.5 stars

### Review Count

| Metric | Value |
|--------|-------|
| P25    | 5     |
| Median | 25    |
| P75    | 200   |
| P90    | 1000  |

**Scoring tiers:**
- Excellent: >= 100 reviews
- Good: >= 50 reviews
- Fair: >= 10 reviews
- Minimal: < 10 reviews

### Update Freshness (days since last update)

**Scoring tiers:**
- Fresh: <= 90 days (100 points)
- Recent: 91-180 days (80 points)
- Aging: 181-270 days (50 points)
- Stale: 271-365 days (20 points)
- Abandoned: > 365 days (0 points)

## Threshold Constants

Used directly in `quality-score.ts`:

```typescript
// Title
TITLE_MIN_LENGTH = 10
TITLE_OPTIMAL_MIN = 20
TITLE_OPTIMAL_MAX = 60
TITLE_MAX_LENGTH = 70

// Short description
SHORT_DESC_MIN_LENGTH = 40
SHORT_DESC_OPTIMAL_MIN = 80
SHORT_DESC_MAX_LENGTH = 132

// Full description (no upper limit penalty)
DESC_MIN_WORDS = 50
DESC_OPTIMAL_MIN_WORDS = 150

// Screenshots
SCREENSHOTS_OPTIMAL_MIN = 3
SCREENSHOTS_OPTIMAL_MAX = 5

// Translations
TRANSLATIONS_GOOD = 10
TRANSLATIONS_EXCELLENT = 20

// Ratings
RATING_EXCELLENT = 4.5
RATING_GOOD = 4.0
RATING_FAIR = 3.5

// Reviews
REVIEWS_EXCELLENT = 100
REVIEWS_GOOD = 50
REVIEWS_FAIR = 10

// Update freshness (days)
FRESHNESS_FRESH = 90
FRESHNESS_RECENT = 180
FRESHNESS_AGING = 270
FRESHNESS_STALE = 365

// Permission risk (inverse scoring)
PERM_RISK_LOW = 20
PERM_RISK_MEDIUM = 50
PERM_RISK_HIGH = 80
```

## Major Market Locales

The following locales are considered "major markets" for translation scoring:
en, es, pt_BR, fr, de, ja, zh_CN, zh_TW, ko, ru, ar, hi, it, nl, pl, tr

## Component Weights

| Component          | Weight |
|--------------------|--------|
| Title optimization | 15%    |
| Short description  | 10%    |
| Full description   | 15%    |
| Visual assets      | 15%    |
| Ratings & reviews  | 10%    |
| Translations       | 10%    |
| Update freshness   | 10%    |
| Permissions        | 10%    |
| Developer profile  | 5%     |
| **Total**          | **100%** |

## Keyword-Aware Scoring

When a target keyword is provided via `KeywordScoreOptions`, scoring blends standard
metrics with keyword relevance:

### Title (with keyword)
- 70% length score + 30% keyword presence (100 if present, 0 if absent)

### Short Description (with keyword)
- 70% length score + 30% keyword presence (100 if present, 0 if absent)

### Full Description (with keyword)
- 50% length score + 25% structure score + 25% keyword density score

### Keyword Density Tiers
- 0 occurrences → 0
- < 0.5% density → scales linearly 0-100
- 0.5-2.5% density → 100 (optimal)
- 2.5-5% density → scales 100→40 (over-optimization)
- > 5% density → 20 (keyword stuffing)

Without a keyword, all scoring functions behave identically to the non-keyword path
(full backward compatibility).
