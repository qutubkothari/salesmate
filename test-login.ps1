Write-Host "SALESMATE LOGIN TEST" -ForegroundColor Cyan

$baseUrl = "https://salesmate.saksolution.com"

$testUsers = @(
    @{phone="9537653927"; password="QK"},
    @{phone="9537653927"; password="admin123"},
    @{phone="9766748786"; password="Mudar"},
    @{phone="1234567890"; password="admin123"}
)

foreach ($user in $testUsers) {
    Write-Host "Testing: $($user.phone) / $($user.password)" -ForegroundColor Yellow
    
    try {
        $body = @{
            phone = $user.phone
            password = $user.password
        } | ConvertTo-Json
        
        $response = Invoke-RestMethod -Uri "$baseUrl/api/auth/login" -Method POST -Body $body -ContentType "application/json" -ErrorAction Stop
        
        if ($response.success) {
            Write-Host "LOGIN SUCCESS!" -ForegroundColor Green
            Write-Host "User: $($response.user.name)" -ForegroundColor Green
            Write-Host "Role: $($response.user.role)" -ForegroundColor Green
            
            @{
                token = $response.token
                tenantId = $response.user.tenant_id
                userId = $response.user.id
                phone = $user.phone
            } | ConvertTo-Json | Out-File "test-creds.json"
            
            exit 0
        }
    }
    catch {
        Write-Host "Failed" -ForegroundColor Red
    }
}

Write-Host "ALL FAILED" -ForegroundColor Red
exit 1
