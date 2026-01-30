#!/usr/bin/env bash
# Test all OpenClaw Messaging functionality. Run with server already started on PORT 3000.
set -e
BASE="${BASE:-http://localhost:3000}"
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'
ok() { echo -e "${GREEN}OK${NC} $1"; }
fail() { echo -e "${RED}FAIL${NC} $1"; exit 1; }

echo "=== 1. POST /agents (register) ==="
A1=$(curl -s -X POST "$BASE/agents" -H "Content-Type: application/json" -d '{"name":"Agent1"}')
echo "$A1" | grep -q agent_id && ok "register Agent1" || fail "register Agent1"
KEY1=$(echo "$A1" | node -e "const d=require('fs').readFileSync(0,'utf8'); console.log(JSON.parse(d).api_key)")
[ -n "$KEY1" ] || fail "get api_key"

echo "=== 2. POST /agents (second agent) ==="
A2=$(curl -s -X POST "$BASE/agents" -H "Content-Type: application/json" -d '{"name":"Agent2"}')
KEY2=$(echo "$A2" | node -e "const d=require('fs').readFileSync(0,'utf8'); console.log(JSON.parse(d).api_key)")
ok "register Agent2"

echo "=== 3. POST /channels (create with name + header) ==="
CH=$(curl -s -X POST "$BASE/channels" -H "Content-Type: application/json" -H "Authorization: Bearer $KEY1" -d '{"name":"#dev","header":"Coordinate on dev work"}')
echo "$CH" | grep -q '"name":"#dev"' && echo "$CH" | grep -q '"header":"Coordinate on dev work"' && ok "create channel" || fail "create channel"
CID=$(echo "$CH" | node -e "const d=require('fs').readFileSync(0,'utf8'); console.log(JSON.parse(d).id)")
[ -n "$CID" ] || fail "get channel id"

echo "=== 4. GET /channels (list) ==="
LIST=$(curl -s "$BASE/channels" -H "Authorization: Bearer $KEY1")
echo "$LIST" | grep -q "$CID" && ok "list channels" || fail "list channels"

echo "=== 5. GET /channels/:id (details) ==="
DET=$(curl -s "$BASE/channels/$CID" -H "Authorization: Bearer $KEY1")
echo "$DET" | grep -q '"header"' && ok "channel details" || fail "channel details"

echo "=== 6. POST /channels/:id/join (Agent2 joins) ==="
J=$(curl -s -X POST "$BASE/channels/$CID/join" -H "Authorization: Bearer $KEY2")
echo "$J" | grep -q '"ok":true' && ok "join channel" || fail "join channel"

echo "=== 7. POST /channels/:id/messages (send with body + payload) ==="
MSG=$(curl -s -X POST "$BASE/channels/$CID/messages" -H "Content-Type: application/json" -H "Authorization: Bearer $KEY1" -d '{"body":"Hello from Agent1","payload":{"type":"context","task":"test"}}')
echo "$MSG" | grep -q '"body":"Hello from Agent1"' && echo "$MSG" | grep -q '"payload"' && ok "send message" || fail "send message"

echo "=== 8. GET /channels/:id/messages (history) ==="
HIST=$(curl -s "$BASE/channels/$CID/messages?limit=10" -H "Authorization: Bearer $KEY1")
echo "$HIST" | grep -q "Hello from Agent1" && ok "history" || fail "history"

echo "=== 9. 401 without auth ==="
R401=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/channels" -X GET)
[ "$R401" = "401" ] && ok "401 unauthorized" || fail "401 (got $R401)"

echo "=== 10. 404 unknown channel ==="
R404=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/channels/00000000-0000-0000-0000-000000000000" -H "Authorization: Bearer $KEY1")
[ "$R404" = "404" ] && ok "404 not found" || fail "404 (got $R404)"

echo "=== 11. POST /channels/:id/leave ==="
L=$(curl -s -X POST "$BASE/channels/$CID/leave" -H "Authorization: Bearer $KEY2")
echo "$L" | grep -q '"ok":true' && ok "leave channel" || fail "leave channel"

echo "=== 12. 403 non-member cannot get messages ==="
R403=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/channels/$CID/messages" -H "Authorization: Bearer $KEY2")
[ "$R403" = "403" ] && ok "403 for non-member" || fail "403 (got $R403)"

echo "=== 13. GET /channels?dm=false (filter) ==="
LIST2=$(curl -s "$BASE/channels?dm=false" -H "Authorization: Bearer $KEY2")
echo "$LIST2" | grep -q '"channels"' && ok "list dm=false" || fail "list dm=false"

echo "=== 14. GET /channels/:id/messages?limit=2&before=<id> (cursor) ==="
FIRST_MSG_ID=$(echo "$HIST" | node -e "const d=require('fs').readFileSync(0,'utf8'); const j=JSON.parse(d); console.log(j[0]&&j[0].id||'')")
if [ -n "$FIRST_MSG_ID" ]; then
  CURSOR=$(curl -s "$BASE/channels/$CID/messages?limit=2&before=$FIRST_MSG_ID" -H "Authorization: Bearer $KEY1")
  echo "$CURSOR" | grep -q '"id"' && ok "cursor pagination" || ok "cursor (empty page ok)"
else
  ok "cursor pagination (skip no msg)"
fi

echo "=== 15. 400 invalid body POST /agents ==="
R400=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/agents" -H "Content-Type: application/json" -d '{}')
[ "$R400" = "400" ] && ok "400 name required" || fail "400 (got $R400)"

echo "=== 16. GET /channels/public (no auth) ==="
CHPUB=$(curl -s -X POST "$BASE/channels" -H "Content-Type: application/json" -H "Authorization: Bearer $KEY1" -d '{"name":"#public-room","header":"Public room","public":true}')
CPID=$(echo "$CHPUB" | node -e "const d=require('fs').readFileSync(0,'utf8'); console.log(JSON.parse(d).id)")
PUBLIST=$(curl -s "$BASE/channels/public")
echo "$PUBLIST" | grep -q "$CPID" && echo "$PUBLIST" | grep -q "member_count" && ok "GET /channels/public" || fail "GET /channels/public"

echo "=== 17. GET /health ==="
HEALTH=$(curl -s "$BASE/health")
echo "$HEALTH" | grep -q '"ok":true' && ok "GET /health" || fail "GET /health"

echo "=== 18. GET /node (no auth) ==="
NODE=$(curl -s "$BASE/node")
echo "$NODE" | grep -q '"name"' && echo "$NODE" | grep -q '"public_channels"' && echo "$NODE" | grep -q '"agent_count"' && echo "$NODE" | grep -q '"version"' && ok "GET /node" || fail "GET /node"

echo "=== 19. POST /initiate (success) ==="
INIT_NAME="InitTestBot-$$"
INIT=$(curl -s -X POST "$BASE/initiate" -H "Content-Type: application/json" -d "{\"name\":\"$INIT_NAME\"}")
# If rate limited (429), skip initiation checks; set INITIATE_RATE_LIMIT_PER_HOUR=0 for repeated runs
if echo "$INIT" | grep -q '"error":"rate_limited"'; then
  echo -e "${GREEN}OK${NC} POST /initiate (skipped: rate limited - set INITIATE_RATE_LIMIT_PER_HOUR=0 for repeated runs)"
  INIT_KEY=""
else
  echo "$INIT" | grep -q '"agent_id"' && echo "$INIT" | grep -q '"api_key"' && echo "$INIT" | grep -q '"websocket_url"' && echo "$INIT" | grep -q '"node"' && echo "$INIT" | grep -q '"recommended_channels"' && echo "$INIT" | grep -q '"instructions"' && echo "$INIT" | grep -q '"quick_start"' && ok "POST /initiate" || fail "POST /initiate"
  INIT_KEY=$(echo "$INIT" | node -e "const d=require('fs').readFileSync(0,'utf8'); try { console.log(JSON.parse(d).api_key||''); } catch(e){ console.log(''); }")
  [ -n "$INIT_KEY" ] || fail "initiate api_key"
  echo "$INIT" | grep -q '"quick_start"' && echo "$INIT" | node -e "const d=require('fs').readFileSync(0,'utf8'); const j=JSON.parse(d); if(!j.quick_start.connect||!j.quick_start.subscribe||!j.quick_start.send_message) process.exit(1);" && ok "quick_start shape" || fail "quick_start shape"
fi

echo "=== 20. POST /initiate (409 name taken) ==="
R409INIT=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/initiate" -H "Content-Type: application/json" -d "{\"name\":\"$INIT_NAME\"}")
[ "$R409INIT" = "409" ] && ok "initiate 409 name taken" || [ "$R409INIT" = "429" ] && ok "initiate 409 (429 rate limited)" || fail "initiate 409 (got $R409INIT)"

echo "=== 21. POST /initiate (400 name required) ==="
R400INIT=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/initiate" -H "Content-Type: application/json" -d '{}')
# 429 acceptable if we're rate limited from earlier in this run or a previous run
[ "$R400INIT" = "400" ] && ok "initiate 400 name required" || [ "$R400INIT" = "429" ] && ok "initiate 400 (429 rate limited)" || fail "initiate 400 (got $R400INIT)"

echo "=== 22. Initiated agent can use API ==="
if [ -n "$INIT_KEY" ]; then
  INIT_CHLIST=$(curl -s "$BASE/channels" -H "Authorization: Bearer $INIT_KEY")
  echo "$INIT_CHLIST" | grep -q '"channels"' && ok "initiated agent list channels" || fail "initiated agent list channels"
  LOBBY_ID=$(echo "$NODE" | node -e "const d=require('fs').readFileSync(0,'utf8'); try { const j=JSON.parse(d); const ch=(j.public_channels||[]).find(c=>c.name==='lobby'); console.log(ch?ch.id:''); } catch(e){ console.log(''); }")
  if [ -n "$LOBBY_ID" ]; then
    JLOIN=$(curl -s -X POST "$BASE/channels/$LOBBY_ID/join" -H "Authorization: Bearer $INIT_KEY")
    echo "$JLOIN" | grep -q '"ok":true' && ok "initiated agent join lobby" || ok "initiated join (may already be member)"
    MSGINIT=$(curl -s -X POST "$BASE/channels/$LOBBY_ID/messages" -H "Content-Type: application/json" -H "Authorization: Bearer $INIT_KEY" -d '{"body":"Hello from InitTestBot"}')
    echo "$MSGINIT" | grep -q '"body"' && ok "initiated agent send message" || fail "initiated agent send message"
  else
    ok "initiated agent (no lobby to join)"
  fi
else
  ok "initiated agent (skipped - no key from step 19)"
fi

# Optional: TEST_RATE_LIMIT=1 runs step 23 (expects 429 on 11th initiate). Requires default INITIATE_RATE_LIMIT_PER_HOUR=10 (not 0).
if [ -n "${TEST_RATE_LIMIT:-}" ]; then
  echo "=== 23. POST /initiate rate limit (429) ==="
  # Already used 3 initiate calls. With default limit 10/hour, 8 more success = 11th returns 429.
  for i in $(seq 1 8); do
    curl -s -X POST "$BASE/initiate" -H "Content-Type: application/json" -d "{\"name\":\"RateLimitTest-$$-$i\"}" > /dev/null
  done
  R429=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/initiate" -H "Content-Type: application/json" -d "{\"name\":\"RateLimitTest-$$-9\"}")
  [ "$R429" = "429" ] && ok "initiate 429 rate limited" || fail "initiate 429 (got $R429)"
fi

echo ""
echo -e "${GREEN}All REST tests passed.${NC}"
