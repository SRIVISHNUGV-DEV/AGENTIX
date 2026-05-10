#!/bin/bash
# Security Test Script for Agentix
# Tests all critical flows with malicious payloads

BASE_URL="

"

echo "=== Agentix Security Testing ==="
echo "Started at $(date)"
echo ""

# Function to test endpoint
test_endpoint() {
    local method=$1
    local endpoint=$2
    local payload=$3
    local desc=$4

    echo "Testing: $desc"
    echo "  $method $endpoint"
    if [ -n "$payload" ]; then
        response=$(curl -s -X "$method" "${BASE_URL}${endpoint}" \
            -H "Content-Type: application/json" \
            -d "$payload" 2>&1)
    else
        response=$(curl -s -X "$method" "${BASE_URL}${endpoint}" 2>&1)
    fi
    echo "  Response: $response"
    echo ""
}

# Test SQL Injection payloads
echo "=== SQL Injection Tests ==="

# Test 1: Basic SQL injection in org name
test_endpoint "POST" "/orgs" '{"name": "test'\''; DROP TABLE organizations; --", "ownerWalletAddress": "0x1234567890123456789012345678901234567890"}' "SQL injection in org name"

# Test 2: UNION-based injection
test_endpoint "POST" "/orgs" '{"name": "test" UNION SELECT * FROM users --", "ownerWalletAddress": "0x1234567890123456789012345678901234567890"}' "UNION injection"

# Test 3: Boolean-based blind injection
test_endpoint "GET" "/orgs?id=1 AND 1=1" "" "Boolean injection"

# Test 4: Time-based blind injection
test_endpoint "GET" "/orgs?id=1; SELECT pg_sleep(5)" "" "Time-based injection"

echo "=== XSS Tests ==="

# Test 5: Reflected XSS
test_endpoint "POST" "/orgs" '{"name": "<script>alert(1)</script>", "ownerWalletAddress": "0x1234567890123456789012345678901234567890"}' "Stored XSS attempt"

# Test 6: DOM-based XSS
test_endpoint "POST" "/orgs" '{"name": "javascript://alert(1)", "ownerWalletAddress": "0x1234567890123456789012345678901234567890"}' "DOM XSS attempt"

# Test 7: Event handler XSS
test_endpoint "POST" "/orgs" '{"name": "<img src=x onerror=alert(1)>", "ownerWalletAddress": "0x1234567890123456789012345678901234567890"}' "Event handler XSS"

echo "=== Authentication Tests ==="

# Test 8: No auth token
test_endpoint "GET" "/agents" "" "No auth token"

# Test 9: Invalid auth token
test_endpoint "GET" "/agents" "" "Invalid auth token" -H "Authorization: Bearer invalid_token"

# Test 10: SQL injection in login
test_endpoint "POST" "/auth/login" '{"email": "admin'\'' OR '\''1'\''='\''1", "password": "anything"}' "SQL injection in login"

echo "=== Input Validation Tests ==="

# Test 11: Empty string
test_endpoint "POST" "/orgs" '{"name": "", "ownerWalletAddress": ""}' "Empty inputs"

# Test 12: Unicode injection
test_endpoint "POST" "/orgs" '{"name": "test\u0027\u0022", "ownerWalletAddress": "0x1234567890123456789012345678901234567890"}' "Unicode injection"

# Test 13: Null bytes
test_endpoint "POST" "/orgs" '{"name": "test\u0000", "ownerWalletAddress": "0x1234567890123456789012345678901234567890"}' "Null byte injection"

# Test 14: Path traversal
test_endpoint "GET" "/orgs/../../../etc/passwd" "" "Path traversal"

echo "=== Business Logic Tests ==="

# Test 15: Negative ID
test_endpoint "GET" "/orgs/-1" "" "Negative ID"

# Test 16: Large number
test_endpoint "GET" "/orgs/99999999999999999999999999" "" "Integer overflow"

# Test 17: Malformed JSON
curl -s -X POST "${BASE_URL}/orgs" \
    -H "Content-Type: application/json" \
    -d "not valid json" 2>&1
echo "Malformed JSON test done"
echo ""

echo "=== Rate Limiting Tests ==="
echo "Sending 20 rapid requests to /orgs..."
for i in {1..20}; do
    curl -s "${BASE_URL}/health" > /dev/null 2>&1 &
done
wait
echo "Rate limit test done"
echo ""

echo "=== Security Headers ==="
echo "Checking security headers..."
curl -s -I "${BASE_URL}/health" | grep -iE "(x-frame-options|content-security-policy|x-content-type-options|strict-transport-security)"
echo ""

echo "=== Completed at $(date) ==="
