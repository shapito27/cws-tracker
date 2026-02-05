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

**Optimal range:** 150-1000 words.
Descriptions under 50 words are too thin. Over 1500 words may indicate keyword stuffing.

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
- Fresh: <= 30 days (100 points)
- Recent: 31-90 days (80 points)
- Aging: 91-180 days (50 points)
- Stale: 181-365 days (20 points)
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

// Full description
DESC_MIN_WORDS = 50
DESC_OPTIMAL_MIN_WORDS = 150
DESC_OPTIMAL_MAX_WORDS = 1000
DESC_MAX_WORDS = 1500

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
FRESHNESS_FRESH = 30
FRESHNESS_RECENT = 90
FRESHNESS_AGING = 180
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
| Ratings & reviews  | 15%    |
| Translations       | 10%    |
| Update freshness   | 10%    |
| Permissions        | 5%     |
| Developer profile  | 5%     |
| **Total**          | **100%** |
