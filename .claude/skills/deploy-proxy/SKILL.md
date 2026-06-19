---
name: deploy-proxy
description: Run proxy tests, deploy Cloudflare Worker, and verify health endpoint
allowed-tools: Bash(cd ~/Projects/cws-tracker-proxy && npx vitest:*), Bash(cd ~/Projects/cws-tracker-proxy && npx wrangler:*), Bash(curl:*), Read
---

# Deploy & Verify Proxy

Run tests, deploy the Cloudflare Worker proxy, and verify the deployment.

## Instructions

### Step 1: Run proxy tests

Run the proxy test suite (the proxy is now its own repo at `~/Projects/cws-tracker-proxy`):
```bash
cd ~/Projects/cws-tracker-proxy && npx vitest run
```

If tests fail, stop and report the failures. Do NOT deploy with failing tests.

### Step 2: Deploy to Cloudflare

Deploy the worker:
```bash
cd ~/Projects/cws-tracker-proxy && npx wrangler deploy
```

Capture the deployed URL from the output.

### Step 3: Verify deployment

Hit the deployed worker to verify it's responding:
```bash
curl -s -o /dev/null -w "%{http_code}" https://cws-tracker-proxy.<workers-subdomain>.workers.dev/
```

If the worker has a health endpoint, use that. Otherwise, a basic request to the root should return a non-5xx status.

### Step 4: Report results

Present a summary:

```markdown
## Proxy Deployment Report

| Step | Status |
|------|--------|
| Tests | PASS (N tests) / FAIL |
| Deploy | Success / Failed |
| Health check | HTTP XXX |

### Deploy URL
`https://...`

### Notes
[Any warnings or issues from the deploy output]
```
