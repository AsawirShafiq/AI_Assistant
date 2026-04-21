/**
 * examples/api-usage.sh
 *
 * Example curl commands for every API endpoint.
 * Run the server first:  npx tsx src/api/server.ts
 *
 * Usage: bash examples/api-usage.sh
 */

BASE="http://localhost:3000/api"
BLUE='\033[1;34m'
GREEN='\033[1;32m'
NC='\033[0m'

section() { echo -e "\n${BLUE}═══ $1 ═══${NC}\n"; }
label()   { echo -e "${GREEN}▸ $1${NC}"; }

# ─── Health Check ─────────────────────────────────────────

section "Health Check"
label "GET /api/health"
curl -s "$BASE/health" | python3 -m json.tool
# → { "status": "ok", "timestamp": "2026-04-19T..." }

# ─── Query (ThinkerAgent) ────────────────────────────────

section "Query — ThinkerAgent"

label "POST /api/query — Fetch leads"
curl -s -X POST "$BASE/query" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Show me all fintech leads",
    "userId": "default_user"
  }' | python3 -m json.tool

label "POST /api/query — Write email"
curl -s -X POST "$BASE/query" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Write a first outreach email for Sarah Chen at NovaPay",
    "userId": "default_user"
  }' | python3 -m json.tool

label "POST /api/query — Update preferences"
curl -s -X POST "$BASE/query" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Make my emails shorter and use a friendly tone",
    "userId": "default_user"
  }' | python3 -m json.tool

# ─── Leads CRUD ──────────────────────────────────────────

section "Leads CRUD"

label "GET /api/leads — All leads (first 5)"
curl -s "$BASE/leads?limit=5" | python3 -m json.tool

label "GET /api/leads — Filter by industry"
curl -s "$BASE/leads?industry=fintech" | python3 -m json.tool

label "GET /api/leads — Filter by deal stage"
curl -s "$BASE/leads?dealStage=qualified" | python3 -m json.tool

label "POST /api/leads — Create a new lead"
LEAD_RESPONSE=$(curl -s -X POST "$BASE/leads" \
  -H "Content-Type: application/json" \
  -d '{
    "company": "TestCo",
    "contactName": "Jane Test",
    "contactEmail": "jane@testco.com",
    "industry": "saas",
    "location": "Austin, TX",
    "dealStage": "prospecting",
    "companySize": "startup",
    "estimatedValue": 25000,
    "source": "website",
    "priority": "medium",
    "tags": ["api-test"],
    "notes": "Created via API test"
  }')
echo "$LEAD_RESPONSE" | python3 -m json.tool
LEAD_ID=$(echo "$LEAD_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])" 2>/dev/null)

if [ -n "$LEAD_ID" ]; then
  label "GET /api/leads/:id — Get the created lead"
  curl -s "$BASE/leads/$LEAD_ID" | python3 -m json.tool

  label "PUT /api/leads/:id — Update deal stage"
  curl -s -X PUT "$BASE/leads/$LEAD_ID" \
    -H "Content-Type: application/json" \
    -d '{
      "dealStage": "qualified",
      "estimatedValue": 50000
    }' | python3 -m json.tool

  label "DELETE /api/leads/:id — Delete the test lead"
  curl -s -X DELETE "$BASE/leads/$LEAD_ID" | python3 -m json.tool
fi

# ─── Preferences ──────────────────────────────────────────

section "Preferences"

label "GET /api/preferences — Current preferences"
curl -s "$BASE/preferences?userId=default_user" | python3 -m json.tool

label "PUT /api/preferences — Update tone"
curl -s -X PUT "$BASE/preferences?userId=default_user" \
  -H "Content-Type: application/json" \
  -d '{
    "tone": "friendly",
    "preferredLength": "short"
  }' | python3 -m json.tool

label "POST /api/preferences — Create for new user"
curl -s -X POST "$BASE/preferences" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "api_test_user",
    "tone": "casual",
    "signOff": "Cheers"
  }' | python3 -m json.tool

# ─── Memory ──────────────────────────────────────────────

section "Memory"

label "GET /api/memory — View memory snapshot"
curl -s "$BASE/memory?userId=default_user" | python3 -m json.tool

label "DELETE /api/memory — Clear memory (api_test_user)"
curl -s -X DELETE "$BASE/memory?userId=api_test_user" | python3 -m json.tool

echo -e "\n${GREEN}✓ All example requests complete.${NC}\n"
