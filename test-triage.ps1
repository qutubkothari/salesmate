# Test triage endpoints
Start-Sleep -Seconds 1

Write-Host "`n=== Testing Triage Endpoints ===" -ForegroundColor Cyan

# Test 1: List triage items
Write-Host "`n1. GET /api/triage/1 (list)" -ForegroundColor Yellow
try {
    $result = Invoke-RestMethod -Uri 'http://localhost:8081/api/triage/1' -Method GET
    Write-Host "SUCCESS:" -ForegroundColor Green
    $result | ConvertTo-Json -Depth 5
} catch {
    Write-Host "FAILED: $_" -ForegroundColor Red
}

# Test 2: Create triage item
Write-Host "`n2. POST /api/triage/1 (create)" -ForegroundColor Yellow
$body = @{
    conversation_id = 999
    end_user_phone = "1234567890"
    type = "LEAD"
    message_preview = "Test triage item"
} | ConvertTo-Json

try {
    $result = Invoke-RestMethod -Uri 'http://localhost:8081/api/triage/1' -Method POST -Body $body -ContentType 'application/json'
    Write-Host "SUCCESS:" -ForegroundColor Green
    $result | ConvertTo-Json -Depth 5
    $triageId = $result.id
} catch {
    Write-Host "FAILED: $_" -ForegroundColor Red
}

# Test 3: List again
Write-Host "`n3. GET /api/triage/1 (list after create)" -ForegroundColor Yellow
try {
    $result = Invoke-RestMethod -Uri 'http://localhost:8081/api/triage/1' -Method GET
    Write-Host "SUCCESS:" -ForegroundColor Green
    $result | ConvertTo-Json -Depth 5
} catch {
    Write-Host "FAILED: $_" -ForegroundColor Red
}

Write-Host "`n=== Tests Complete ===" -ForegroundColor Cyan
