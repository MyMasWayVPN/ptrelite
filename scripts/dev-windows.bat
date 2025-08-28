@echo off
echo ========================================
echo  Web Hosting Panel - Development Mode
echo ========================================
echo.

echo Checking if .env file exists...
if not exist .env (
    echo ERROR: .env file not found
    echo Please run setup-windows.bat first
    pause
    exit /b 1
)

echo Starting development servers...
echo.
echo Backend will run on: http://localhost:5000
echo Frontend will run on: http://localhost:3000
echo.
echo Press Ctrl+C to stop both servers
echo.

REM Start backend and frontend concurrently
start "Backend Server" cmd /k "cd backend && npm run dev"
timeout /t 3 /nobreak >nul
start "Frontend Server" cmd /k "cd frontend && npm run dev"

echo.
echo Development servers are starting...
echo Check the opened terminal windows for logs
echo.
echo ========================================
echo  Available URLs:
echo ========================================
echo Frontend: http://localhost:3000
echo Backend API: http://localhost:5000
echo API Health: http://localhost:5000/api/health
echo.
echo Default Login Credentials:
echo Admin - Username: admin, Password: admin123
echo Member - Username: member, Password: member123
echo.
echo ========================================
pause
