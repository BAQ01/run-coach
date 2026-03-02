#!/usr/bin/env bash
# End-to-end test voor Run Coach PWA
# Gebruik: bash test_e2e.sh

set -euo pipefail
set +H  # Geen bash history expansion (voorkomt problemen met ! in wachtwoorden)

SUPABASE_URL="https://tlhfcyhinfckyflsmjvs.supabase.co"
ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRsaGZjeWhpbmZja3lmbHNtanZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0Mzc3ODEsImV4cCI6MjA4ODAxMzc4MX0.cxQtJlMsmxNsom-uwAwJ15aOKEIMXyOxnJXMYNmxC74"
SERVICE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRsaGZjeWhpbmZja3lmbHNtanZzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjQzNzc4MSwiZXhwIjoyMDg4MDEzNzgxfQ.aY8WISu4P_06GlnZf0SSwxjYhulsbi90Km1frNonR9E"

EMAIL="testuser_$(date +%s)@example.com"
PASS="TestPass123x"

PASS_COUNT=0
FAIL_COUNT=0

ok()   { echo "[✓] $1"; PASS_COUNT=$((PASS_COUNT + 1)); }
fail() { echo "[✗] $1"; FAIL_COUNT=$((FAIL_COUNT + 1)); }

echo ""
echo "=== Run Coach E2E Tests ==="
echo "Test e-mail: $EMAIL"
echo ""

# ── Test 1: Auth – registratie ────────────────────────────────────────────────
echo "1. Auth signup..."
SIGNUP=$(curl -s -X POST "$SUPABASE_URL/auth/v1/signup" \
  -H "Content-Type: application/json" \
  -H "apikey: $ANON_KEY" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}")

ACCESS_TOKEN=$(echo "$SIGNUP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('access_token',''))" 2>/dev/null || echo "")

if [ -n "$ACCESS_TOKEN" ] && [ "$ACCESS_TOKEN" != "null" ]; then
  ok "Signup OK – JWT ontvangen"
else
  fail "Signup mislukt – geen JWT. Response: $SIGNUP"
  echo "⚠ Verdere tests worden overgeslagen (geen token)"
  exit 1
fi

# ── Test 2: Edge Function – 401 zonder auth ───────────────────────────────────
echo "2. Edge Function 401 check..."
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  "$SUPABASE_URL/functions/v1/generate-schema" \
  -H "Content-Type: application/json" \
  -H "apikey: $ANON_KEY" \
  -d '{"goal":"5k","daysPerWeek":3,"currentLevel":"beginner"}')

if [ "$STATUS" = "401" ]; then
  ok "401 zonder auth"
else
  fail "Verwacht 401, kreeg $STATUS"
fi

# ── Test 3: Schema genereren – 5k ────────────────────────────────────────────
echo "3. Schema genereren (5k)..."
SCHEMA_5K=$(curl -s -X POST "$SUPABASE_URL/functions/v1/generate-schema" \
  -H "Content-Type: application/json" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{"goal":"5k","daysPerWeek":3,"currentLevel":"beginner"}')

SESSION_COUNT=$(echo "$SCHEMA_5K" | python3 -c "
import sys,json
d=json.load(sys.stdin)
p=d.get('plan',{})
print(len(p.get('sessions',[])))
" 2>/dev/null || echo "0")

WEEKS=$(echo "$SCHEMA_5K" | python3 -c "
import sys,json
d=json.load(sys.stdin)
p=d.get('plan',{})
print(p.get('total_weeks',0))
" 2>/dev/null || echo "0")

if [ "$SESSION_COUNT" -gt 0 ] 2>/dev/null && [ "$WEEKS" -gt 0 ] 2>/dev/null; then
  ok "5k schema: $SESSION_COUNT sessies, $WEEKS weken"
else
  fail "5k schema ongeldig. Response: $(echo "$SCHEMA_5K" | head -c 500)"
fi

# ── Test 4: Interval structuur (warmup / cooldown) ────────────────────────────
echo "4. Interval structuur..."
FIRST_TYPE=$(echo "$SCHEMA_5K" | python3 -c "
import sys,json
d=json.load(sys.stdin)
sessions=d.get('plan',{}).get('sessions',[])
if sessions:
  ivs=sessions[0].get('intervals',[])
  print(ivs[0].get('type','') if ivs else '')
" 2>/dev/null || echo "")

LAST_TYPE=$(echo "$SCHEMA_5K" | python3 -c "
import sys,json
d=json.load(sys.stdin)
sessions=d.get('plan',{}).get('sessions',[])
if sessions:
  ivs=sessions[0].get('intervals',[])
  print(ivs[-1].get('type','') if ivs else '')
" 2>/dev/null || echo "")

if [ "$FIRST_TYPE" = "warmup" ] && [ "$LAST_TYPE" = "cooldown" ]; then
  ok "Intervals: eerste=$FIRST_TYPE, laatste=$LAST_TYPE"
else
  fail "Interval structuur fout: eerste='$FIRST_TYPE', laatste='$LAST_TYPE'"
fi

# ── Test 5: Schema genereren – half_marathon ──────────────────────────────────
echo "5. Schema genereren (half_marathon)..."
SCHEMA_HM=$(curl -s -X POST "$SUPABASE_URL/functions/v1/generate-schema" \
  -H "Content-Type: application/json" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{"goal":"half_marathon","daysPerWeek":3,"currentLevel":"beginner"}')

HM_SESSIONS=$(echo "$SCHEMA_HM" | python3 -c "
import sys,json
d=json.load(sys.stdin)
p=d.get('plan',{})
print(len(p.get('sessions',[])))
" 2>/dev/null || echo "0")

HM_WEEKS=$(echo "$SCHEMA_HM" | python3 -c "
import sys,json
d=json.load(sys.stdin)
p=d.get('plan',{})
print(p.get('total_weeks',0))
" 2>/dev/null || echo "0")

if [ "$HM_SESSIONS" -gt 0 ] 2>/dev/null && [ "$HM_WEEKS" -gt 0 ] 2>/dev/null; then
  ok "half_marathon schema: $HM_SESSIONS sessies, $HM_WEEKS weken"
else
  fail "half_marathon schema ongeldig. Response: $(echo "$SCHEMA_HM" | head -c 500)"
fi

# ── Test 6: Validatie – ongeldige input ───────────────────────────────────────
echo "6. Validatie (daysPerWeek=9)..."
VALIDATION=$(curl -s -X POST "$SUPABASE_URL/functions/v1/generate-schema" \
  -H "Content-Type: application/json" \
  -H "apikey: $ANON_KEY" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{"goal":"5k","daysPerWeek":9,"currentLevel":"beginner"}')

VAL_OK=$(echo "$VALIDATION" | python3 -c "
import sys,json
d=json.load(sys.stdin)
# Fout verwacht: geen 'plan' veld, of een error veld
has_plan = 'plan' in d
has_error = 'error' in d or 'message' in d
print('error' if not has_plan else 'plan')
" 2>/dev/null || echo "unknown")

if [ "$VAL_OK" = "error" ]; then
  ok "Validatie werkt – ongeldige days geweigerd"
else
  fail "Validatie mislukt – ongeldige input geaccepteerd. Response: $VALIDATION"
fi

# ── Test 7: DB check – rij aangemaakt via service role ───────────────────────
echo "7. DB opslag check..."
# Gebruik SERVICE_KEY om direct training_plans te lezen (bypasses RLS)
DB_RESPONSE=$(curl -s \
  "$SUPABASE_URL/rest/v1/training_plans?select=id,goal,total_weeks&order=created_at.desc&limit=5" \
  -H "apikey: $SERVICE_KEY" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Accept: application/json")

ROW_COUNT=$(echo "$DB_RESPONSE" | python3 -c "
import sys,json
rows=json.load(sys.stdin)
print(len(rows) if isinstance(rows,list) else 0)
" 2>/dev/null || echo "0")

if [ "$ROW_COUNT" -gt 0 ] 2>/dev/null; then
  LATEST_GOAL=$(echo "$DB_RESPONSE" | python3 -c "
import sys,json
rows=json.load(sys.stdin)
print(rows[0].get('goal','?') if rows else '?')
" 2>/dev/null || echo "?")
  ok "DB bevat $ROW_COUNT rijen – laatste goal: $LATEST_GOAL"
else
  fail "DB check mislukt. Response: $DB_RESPONSE"
fi

# ── Test 8: RLS – andere gebruiker ziet geen data ─────────────────────────────
echo "8. RLS isolatie check..."
EMAIL2="testuser2_$(date +%s)@example.com"
SIGNUP2=$(curl -s -X POST "$SUPABASE_URL/auth/v1/signup" \
  -H "Content-Type: application/json" \
  -H "apikey: $ANON_KEY" \
  -d "{\"email\":\"$EMAIL2\",\"password\":\"$PASS\"}")

TOKEN2=$(echo "$SIGNUP2" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('access_token',''))" 2>/dev/null || echo "")

if [ -z "$TOKEN2" ] || [ "$TOKEN2" = "null" ]; then
  fail "RLS: tweede gebruiker kon niet aanmaken"
else
  PLANS2=$(curl -s \
    "$SUPABASE_URL/rest/v1/training_plans?select=id" \
    -H "apikey: $ANON_KEY" \
    -H "Authorization: Bearer $TOKEN2" \
    -H "Accept: application/json")

  COUNT2=$(echo "$PLANS2" | python3 -c "
import sys,json
rows=json.load(sys.stdin)
print(len(rows) if isinstance(rows,list) else -1)
" 2>/dev/null || echo "-1")

  if [ "$COUNT2" = "0" ]; then
    ok "RLS werkt – andere gebruiker ziet 0 plannen"
  else
    fail "RLS probleem – andere gebruiker ziet $COUNT2 plannen"
  fi
fi

# ── Samenvatting ─────────────────────────────────────────────────────────────
echo ""
echo "=== Resultaat ==="
echo "Geslaagd: $PASS_COUNT"
echo "Mislukt:  $FAIL_COUNT"
echo ""
if [ "$FAIL_COUNT" -eq 0 ]; then
  echo "Alle tests geslaagd!"
  exit 0
else
  echo "$FAIL_COUNT test(s) mislukt."
  exit 1
fi
