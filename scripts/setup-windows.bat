@echo off
echo ========================================
echo  Web Hosting Panel - Windows Setup
echo ========================================
echo.

echo [1/6] Checking Node.js installation...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js is not installed or not in PATH
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)
echo Node.js is installed

echo.
echo [2/6] Checking npm installation...
npm --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: npm is not installed or not in PATH
    pause
    exit /b 1
)
echo npm is available

echo.
echo [3/6] Creating environment file...
if not exist .env (
    copy .env.example .env
    echo Environment file created from template
    echo Please edit .env file with your configuration
) else (
    echo Environment file already exists
)

echo.
echo [4/6] Installing backend dependencies (Windows compatible)...
cd backend
if exist package-windows.json (
    copy package-windows.json package.json
    echo Using Windows-compatible package.json
)
call npm install --no-optional
if %errorlevel% neq 0 (
    echo WARNING: Some backend dependencies failed to install
    echo This might be due to missing Visual Studio Build Tools
    echo The application will still work with limited functionality
)
cd ..

echo.
echo [5/6] Installing frontend dependencies...
cd frontend
call npm install
if %errorlevel% neq 0 (
    echo ERROR: Failed to install frontend dependencies
    cd ..
    pause
    exit /b 1
)

echo Installing additional Tailwind plugins...
call npm install @tailwindcss/forms @tailwindcss/typography
cd ..

echo.
echo [6/6] Setup completed!
echo.
echo ========================================
echo  Next Steps:
echo ========================================
echo 1. Edit .env file with your configuration
echo 2. Install Docker Desktop (optional, for container features)
echo 3. Run: npm run dev (to start development servers)
echo.
echo For Docker features, install Docker Desktop from:
echo https://www.docker.com/products/docker-desktop
echo.
echo ========================================
pause
